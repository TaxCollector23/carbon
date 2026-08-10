import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import type { AppContext } from '../context.js';
import { resolveCallerOrg } from '../plugins/caller-org.js';
import { requireScope } from '../plugins/scopes.js';
import { zodQuery, zodResponse, zodResponseWithExample } from '../plugins/schema-helpers.js';

/**
 * Full-text search over the caller's org history. Backed by the generated
 * `search_tsv` columns on events/projects/artifacts (see migration
 * 0007_fulltext_search.sql) with a GIN index each. Uses the `simple`
 * dictionary — Carbon's audit stream is dominated by identifiers, and
 * English stemming would eat too many useful prefixes.
 */

const SearchScope = z.enum(['events', 'projects', 'artifacts', 'all']);

const SearchQuery = z.object({
  q: z.string().min(1).max(200),
  scope: SearchScope.default('all'),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().optional(),
  orgId: z.string().min(1).optional(),
});

const SearchResult = z.object({
  kind: z.enum(['event', 'project', 'artifact']),
  id: z.string(),
  snippet: z.string(),
  score: z.number(),
  createdAt: z.string(),
});

const SearchResponse = z.object({
  results: z.array(SearchResult),
});

interface Row {
  kind: 'event' | 'project' | 'artifact';
  id: string;
  snippet: string;
  score: number;
  createdAt: string;
}

export async function registerSearchRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get('/v1/search', {
    preHandler: requireScope('read'),
    schema: {
      summary: 'Full-text search across org history',
      description:
        'Search events, projects, and artifacts belonging to the caller\'s org. ' +
        'Uses Postgres `plainto_tsquery(\'simple\', q)` against generated ' +
        '`search_tsv` columns. `scope` narrows the search; the default `all` ' +
        'merges results across every kind sorted by ts_rank score, descending.',
      querystring: zodQuery(SearchQuery),
      response: {
        200: zodResponseWithExample(SearchResponse, {
          results: [
            {
              kind: 'project',
              id: 'prj_01HXK5H7Q9C0R3Q1S8V6M4WJZK',
              snippet: 'checkout-api — Checkout API',
              score: 0.62,
              createdAt: '2025-11-14T18:22:41.000Z',
            },
            {
              kind: 'event',
              id: 'evt_01HXK5N9Q1B7C4D3E2F1G0H9J8',
              snippet: 'project.created by usr_01HXK5H7Q9C0R3Q1S8V6M4WJZK',
              score: 0.41,
              createdAt: '2025-11-14T18:22:41.000Z',
            },
          ],
        }),
      },
    },
  }, async (req) => {
    const query = SearchQuery.parse(req.query);
    const orgId = resolveCallerOrg(req, { queryOrg: query.orgId, mode: 'return-empty' });
    if (!orgId) return { results: [] };

    const scopes: Array<'events' | 'projects' | 'artifacts'> =
      query.scope === 'all' ? ['events', 'projects', 'artifacts'] : [query.scope];

    const results: Row[] = [];
    for (const scope of scopes) {
      const rows = await runSearch(ctx, scope, orgId, query.q, query.limit);
      for (const r of rows) results.push(r);
    }
    results.sort((a, b) => b.score - a.score || b.createdAt.localeCompare(a.createdAt));
    return { results: results.slice(0, query.limit) };
  });
}

async function runSearch(
  ctx: AppContext,
  scope: 'events' | 'projects' | 'artifacts',
  orgId: string,
  q: string,
  limit: number,
): Promise<Row[]> {
  // Each branch is a hand-written SQL query rather than a Drizzle chain
  // because `plainto_tsquery` + `ts_rank` don't compose cleanly through the
  // ORM's builder, and hoisting them here keeps the SQL close to the schema
  // it exercises.
  if (scope === 'events') {
    const raw = await ctx.db.execute(sql`
      SELECT id, action, actor_id, created_at,
             ts_rank(search_tsv, plainto_tsquery('simple', ${q})) AS score
        FROM events
       WHERE org_id = ${orgId}
         AND search_tsv @@ plainto_tsquery('simple', ${q})
       ORDER BY score DESC, created_at DESC
       LIMIT ${limit}
    `);
    const rows = toRowList<{
      id: string;
      action: string;
      actor_id: string | null;
      created_at: Date | string;
      score: number | string;
    }>(raw);
    return rows.map((r) => ({
      kind: 'event' as const,
      id: r.id,
      snippet: `${r.action}${r.actor_id ? ` by ${r.actor_id}` : ''}`,
      score: Number(r.score) || 0,
      createdAt: toIso(r.created_at),
    }));
  }

  if (scope === 'projects') {
    const raw = await ctx.db.execute(sql`
      SELECT id, slug, name, created_at,
             ts_rank(search_tsv, plainto_tsquery('simple', ${q})) AS score
        FROM projects
       WHERE org_id = ${orgId}
         AND search_tsv @@ plainto_tsquery('simple', ${q})
       ORDER BY score DESC, created_at DESC
       LIMIT ${limit}
    `);
    const rows = toRowList<{
      id: string;
      slug: string;
      name: string;
      created_at: Date | string;
      score: number | string;
    }>(raw);
    return rows.map((r) => ({
      kind: 'project' as const,
      id: r.id,
      snippet: `${r.slug}${r.name && r.name !== r.slug ? ` — ${r.name}` : ''}`,
      score: Number(r.score) || 0,
      createdAt: toIso(r.created_at),
    }));
  }

  // artifacts — org filter is via join through projects.
  const raw = await ctx.db.execute(sql`
    SELECT a.id, a.kind, a.storage_key, a.created_at,
           ts_rank(a.search_tsv, plainto_tsquery('simple', ${q})) AS score
      FROM artifacts a
      JOIN projects p ON p.id = a.project_id
     WHERE p.org_id = ${orgId}
       AND a.search_tsv @@ plainto_tsquery('simple', ${q})
     ORDER BY score DESC, a.created_at DESC
     LIMIT ${limit}
  `);
  const rows = toRowList<{
    id: string;
    kind: string;
    storage_key: string;
    created_at: Date | string;
    score: number | string;
  }>(raw);
  return rows.map((r) => ({
    kind: 'artifact' as const,
    id: r.id,
    snippet: `${r.kind}: ${r.storage_key}`,
    score: Number(r.score) || 0,
    createdAt: toIso(r.created_at),
  }));
}

/**
 * drizzle's `db.execute` returns different shapes depending on the driver:
 *   - postgres.js: an array-like RowList
 *   - node-postgres: { rows }
 * Normalize both to an array before we map.
 */
function toRowList<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === 'object' && 'rows' in result) {
    return (result as { rows: T[] }).rows;
  }
  return [];
}

function toIso(v: Date | string): string {
  if (v instanceof Date) return v.toISOString();
  // Postgres already gives us an ISO-ish string for timestamptz.
  return String(v);
}

