import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { and, eq, gte, inArray, lt, type SQL } from 'drizzle-orm';
import { CarbonError } from '@carbon/core';
import { schema } from '@carbon/database';
import type { AppContext } from '../context.js';
import type { AuthenticatedRequest } from '../plugins/api-key.js';
import type { SessionAuthenticatedRequest } from '../plugins/session-auth.js';
import { requireScope } from '../plugins/scopes.js';
import { zodBody } from '../plugins/schema-helpers.js';

/**
 * Compliance export — the Enterprise-tier "give me everything about my
 * account" deliverable. Emits a bundle across the org-scoped tables so an
 * auditor can review projects, snapshots (metadata), api-key lifecycle,
 * members, usage, AI-quality history, and the append-only audit log in one
 * artifact.
 *
 * Secrets never leave the process: api-key `hash` and session tokens are
 * omitted from every include path.
 */

const IncludeEnum = z.enum([
  'events',
  'projects',
  'snapshots',
  'api_keys',
  'members',
  'ai_quality',
  'usage',
  'audit',
]);
type Include = z.infer<typeof IncludeEnum>;

const DEFAULT_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;

const ExportBody = z.object({
  include: z.array(IncludeEnum).min(1).optional(),
  since: z.string().datetime().optional(),
  until: z.string().datetime().optional(),
  format: z.enum(['json', 'zip']).default('json'),
});

const ALL_INCLUDES: readonly Include[] = [
  'events',
  'projects',
  'snapshots',
  'api_keys',
  'members',
  'ai_quality',
  'usage',
  'audit',
];

export async function registerExportRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.post('/v1/export', {
    preHandler: requireScope('admin'),
    schema: {
      summary: 'Export org data',
      description:
        'Admin-only compliance export. Emits a bundle across the requested include categories (`events`, `projects`, `snapshots`, `api_keys`, `members`, `ai_quality`, `usage`, `audit`). Returns JSON by default; pass `format: "zip"` for a downloadable archive (binary content-type `application/zip`; not covered by the response schema).',
      body: zodBody(ExportBody),
    },
  }, async (req, reply) => {
    const body = ExportBody.parse(req.body ?? {});
    const orgId = requireCallerOrg(req);
    const until = body.until ? new Date(body.until) : new Date();
    const since = body.since ? new Date(body.since) : new Date(until.getTime() - DEFAULT_WINDOW_MS);
    const include: readonly Include[] = body.include && body.include.length > 0
      ? body.include
      : ALL_INCLUDES;

    const bundle: Record<string, unknown[]> = {};
    for (const key of include) {
      bundle[key] = await collect(ctx, key, orgId, since, until);
    }

    const generatedAt = new Date().toISOString();
    const ranges = { since: since.toISOString(), until: until.toISOString() };

    if (body.format === 'zip') {
      const files: ZipEntry[] = [
        {
          name: 'manifest.json',
          data: Buffer.from(
            JSON.stringify(
              { orgId, generatedAt, ranges, include, counts: countAll(bundle) },
              null,
              2,
            ),
          ),
        },
      ];
      for (const key of include) {
        files.push({
          name: `${key}.json`,
          data: Buffer.from(JSON.stringify(bundle[key] ?? [], null, 2)),
        });
      }
      const zip = buildStoredZip(files);
      const filename = `carbon-export-${orgId}-${Date.now()}.zip`;
      reply.header('content-type', 'application/zip');
      reply.header('content-disposition', `attachment; filename="${filename}"`);
      reply.header('content-length', String(zip.length));
      return reply.send(zip);
    }

    const filename = `carbon-export-${orgId}-${Date.now()}.json`;
    reply.header('content-type', 'application/json; charset=utf-8');
    reply.header('content-disposition', `attachment; filename="${filename}"`);
    return { orgId, generatedAt, ranges, bundle };
  });
}

function countAll(bundle: Record<string, unknown[]>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(bundle)) out[k] = v.length;
  return out;
}

async function collect(
  ctx: AppContext,
  key: Include,
  orgId: string,
  since: Date,
  until: Date,
): Promise<unknown[]> {
  switch (key) {
    case 'events':
      return ctx.db
        .select()
        .from(schema.events)
        .where(
          and(
            eq(schema.events.orgId, orgId),
            gte(schema.events.createdAt, since),
            lt(schema.events.createdAt, until),
          ),
        );
    case 'audit':
      // Same source table, but the ops framing of an audit review wants the
      // full window unbounded by 90 days on the trailing edge — surface it
      // as a distinct include so the manifest matches what the auditor asked
      // for. Still bounded by [since, until) to respect the caller's range.
      return ctx.db
        .select()
        .from(schema.events)
        .where(
          and(
            eq(schema.events.orgId, orgId),
            gte(schema.events.createdAt, since),
            lt(schema.events.createdAt, until),
          ),
        );
    case 'projects':
      return ctx.db
        .select()
        .from(schema.projects)
        .where(eq(schema.projects.orgId, orgId));
    case 'api_keys': {
      // Never emit the `hash` column — that's the offline-attack material.
      // Explicitly whitelist columns rather than deleting after the fact so
      // a future schema addition doesn't accidentally leak.
      const rows = await ctx.db
        .select({
          id: schema.apiKeys.id,
          orgId: schema.apiKeys.orgId,
          name: schema.apiKeys.name,
          prefix: schema.apiKeys.prefix,
          scopes: schema.apiKeys.scopes,
          projectIds: schema.apiKeys.projectIds,
          lastUsedAt: schema.apiKeys.lastUsedAt,
          createdAt: schema.apiKeys.createdAt,
          revokedAt: schema.apiKeys.revokedAt,
          expiresAt: schema.apiKeys.expiresAt,
          rotatedFromId: schema.apiKeys.rotatedFromId,
        })
        .from(schema.apiKeys)
        .where(eq(schema.apiKeys.orgId, orgId));
      return rows;
    }
    case 'members':
      return ctx.db
        .select()
        .from(schema.memberships)
        .where(eq(schema.memberships.orgId, orgId));
    case 'usage': {
      const conds: SQL[] = [
        eq(schema.usageEvents.orgId, orgId),
        gte(schema.usageEvents.occurredAt, since),
        lt(schema.usageEvents.occurredAt, until),
      ];
      return ctx.db
        .select()
        .from(schema.usageEvents)
        .where(and(...conds));
    }
    case 'snapshots': {
      // Artifacts are project-scoped; resolve the org's project ids first
      // so the second query can `inArray` them without a join.
      const projects = await ctx.db
        .select({ id: schema.projects.id })
        .from(schema.projects)
        .where(eq(schema.projects.orgId, orgId));
      const ids = projects.map((r) => r.id);
      if (ids.length === 0) return [];
      return ctx.db
        .select()
        .from(schema.artifacts)
        .where(
          and(
            inArray(schema.artifacts.projectId, ids),
            eq(schema.artifacts.kind, 'snapshot'),
            gte(schema.artifacts.createdAt, since),
            lt(schema.artifacts.createdAt, until),
          ),
        );
    }
    case 'ai_quality': {
      const projects = await ctx.db
        .select({ id: schema.projects.id })
        .from(schema.projects)
        .where(eq(schema.projects.orgId, orgId));
      const ids = projects.map((r) => r.id);
      if (ids.length === 0) return [];
      return ctx.db
        .select()
        .from(schema.aiQualityReports)
        .where(
          and(
            inArray(schema.aiQualityReports.projectId, ids),
            gte(schema.aiQualityReports.createdAt, since),
            lt(schema.aiQualityReports.createdAt, until),
          ),
        );
    }
  }
}

function requireCallerOrg(req: FastifyRequest): string {
  const apiKey = (req as AuthenticatedRequest).apiKey;
  const session = (req as SessionAuthenticatedRequest).sessionUser;
  const orgId = apiKey?.orgId ?? session?.orgId;
  if (!orgId) {
    throw new CarbonError({
      code: 'CARBON_INVALID_INPUT',
      message: 'export is org-scoped — attach an API key or authenticated session',
      expose: true,
    });
  }
  return orgId;
}

// ---------------------------------------------------------------------------
// Minimal STORE-only ZIP writer.
//
// Enterprise auditors want a real .zip they can open in Explorer / Finder,
// but pulling in adm-zip / archiver for one endpoint bloats the API image and
// forces a lockfile churn. The stored (uncompressed) subset of the zip spec
// is tiny — local file header + central directory + EOCD — and every
// mainstream unzipper accepts it. We use node:zlib for the CRC-32 required
// by the format.
// ---------------------------------------------------------------------------
import { crc32 as zlibCrc32 } from 'node:zlib';

interface ZipEntry {
  name: string;
  data: Buffer;
}

function buildStoredZip(files: readonly ZipEntry[]): Buffer {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const nameBuf = Buffer.from(f.name, 'utf8');
    const crc = crc32(f.data);
    const size = f.data.length;

    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(0x04034b50, 0); // local file header signature
    lfh.writeUInt16LE(20, 4); // version needed
    lfh.writeUInt16LE(0, 6); // general purpose flags
    lfh.writeUInt16LE(0, 8); // method: store (0)
    lfh.writeUInt16LE(0, 10); // mod time
    lfh.writeUInt16LE(0x21, 12); // mod date (1980-01-01 valid-ish)
    lfh.writeUInt32LE(crc, 14);
    lfh.writeUInt32LE(size, 18); // compressed size
    lfh.writeUInt32LE(size, 22); // uncompressed size
    lfh.writeUInt16LE(nameBuf.length, 26);
    lfh.writeUInt16LE(0, 28); // extra len
    local.push(lfh, nameBuf, f.data);

    const cdh = Buffer.alloc(46);
    cdh.writeUInt32LE(0x02014b50, 0); // central dir signature
    cdh.writeUInt16LE(20, 4); // version made by
    cdh.writeUInt16LE(20, 6); // version needed
    cdh.writeUInt16LE(0, 8);
    cdh.writeUInt16LE(0, 10);
    cdh.writeUInt16LE(0, 12);
    cdh.writeUInt16LE(0x21, 14);
    cdh.writeUInt32LE(crc, 16);
    cdh.writeUInt32LE(size, 20);
    cdh.writeUInt32LE(size, 24);
    cdh.writeUInt16LE(nameBuf.length, 28);
    cdh.writeUInt16LE(0, 30); // extra len
    cdh.writeUInt16LE(0, 32); // comment len
    cdh.writeUInt16LE(0, 34); // disk
    cdh.writeUInt16LE(0, 36); // internal
    cdh.writeUInt32LE(0, 38); // external
    cdh.writeUInt32LE(offset, 42); // local header offset
    central.push(cdh, nameBuf);

    offset += 30 + nameBuf.length + size;
  }

  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4); // disk
  eocd.writeUInt16LE(0, 6); // start disk
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20); // comment len

  return Buffer.concat([...local, centralBuf, eocd]);
}

// Node 22.2+ exposes `zlib.crc32`. Fall back to a table-based implementation
// on older runtimes so we don't lock the API to a specific minor.
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  if (typeof zlibCrc32 === 'function') return zlibCrc32(buf) >>> 0;
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buf[i]!) & 0xff]!;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
