import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { CarbonError, makeId, NotFoundError } from '@carbon/core';
import { schema } from '@carbon/database';
import type { AppContext } from '../context.js';
import { resolveCallerOrg } from '../plugins/caller-org.js';
import { requireScope } from '../plugins/scopes.js';
import { zodBody, zodResponse } from '../plugins/schema-helpers.js';
import { getActor, recordEvent } from '../services/events.js';
import { recordUsage } from '../services/usage.js';

/**
 * A "sample" is a curated, ready-to-emulate API spec bundled with Carbon so
 * a new visitor can go from zero → hitting a live stateful replica in one
 * click. Each entry names the fixture file (relative to the repo's
 * `benchmarks/fixtures/`) and a short pitch used by the dashboard modal.
 *
 * Keeping this list here — rather than pulling it from the DB — means a
 * fresh install has samples the moment the API boots; there's no seed step
 * for the sample gallery. The fixture files are the same ones the benchmark
 * harness consumes, so we're not carrying a private copy of any spec.
 */
export interface SampleAnnotation {
  readonly highlight: string;
  readonly tryThis: readonly string[];
}

export interface SampleDefinition {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly tag: string;
  readonly fixture: string;
  readonly annotations: SampleAnnotation;
}

export const SAMPLES: readonly SampleDefinition[] = [
  {
    id: 'petstore',
    name: 'Petstore',
    description: 'The canonical OpenAPI sample — five endpoints, one resource.',
    tag: 'Tutorial',
    fixture: 'petstore.openapi.json',
    annotations: {
      highlight: 'Tiny, well-known spec — good first Carbon run.',
      tryThis: ['POST /pets', 'GET /pets', 'GET /pets/{id}'],
    },
  },
  {
    id: 'stripe',
    name: 'Stripe',
    description: 'Payments — customers, payment intents, subscriptions, invoices, webhooks.',
    tag: 'Payments',
    fixture: 'stripe.openapi.json',
    annotations: {
      highlight: 'Money-mover API surface with tricky state transitions.',
      tryThis: [
        'POST /v1/customers',
        'POST /v1/payment_intents',
        'POST /v1/payment_intents/{id}/confirm',
      ],
    },
  },
  {
    id: 'github',
    name: 'GitHub',
    description: 'REST v3 — repos, issues, pull requests, workflows, search.',
    tag: 'DevTools',
    fixture: 'github.openapi.json',
    annotations: {
      highlight: 'Nested resources under owner/repo — great for cross-resource queries.',
      tryThis: [
        'POST /user/repos',
        'POST /repos/{owner}/{repo}/issues',
        'POST /repos/{owner}/{repo}/pulls',
      ],
    },
  },
  {
    id: 'shopify',
    name: 'Shopify Admin',
    description: 'Shop management — products, variants, orders, fulfillments, inventory.',
    tag: 'Commerce',
    fixture: 'shopify.openapi.json',
    annotations: {
      highlight: 'Deep relationships (products → variants → inventory).',
      tryThis: [
        'POST /products.json',
        'POST /orders.json',
        'POST /orders/{order_id}/fulfillments.json',
      ],
    },
  },
  {
    id: 'openai',
    name: 'OpenAI',
    description: 'Chat completions, embeddings, files, assistants, fine-tuning.',
    tag: 'AI',
    fixture: 'openai.openapi.json',
    annotations: {
      highlight: 'Streaming-heavy surface; great for chaos & latency experiments.',
      tryThis: ['POST /chat/completions', 'POST /embeddings', 'POST /assistants'],
    },
  },
  {
    id: 'twilio',
    name: 'Twilio Messaging',
    description: 'SMS, MMS, phone numbers, and messaging services.',
    tag: 'Communications',
    fixture: 'twilio.openapi.json',
    annotations: {
      highlight: 'Compound-key resources (Account + Message SID).',
      tryThis: [
        'POST /Accounts/{AccountSid}/Messages.json',
        'GET  /Accounts/{AccountSid}/Messages.json',
      ],
    },
  },
] as const;

const SampleById = new Map(SAMPLES.map((s) => [s.id, s] as const));

// Cache parsed specs — a hot re-instantiate should not re-read the JSON.
const specCache = new Map<string, unknown>();

/**
 * Resolve the `benchmarks/fixtures` dir. The API can run from either
 *   - source tree (`apps/api/src/routes/samples.ts` — dev, tests, tsx)
 *   - bundled dist (`apps/api/dist/index.js` — Docker prod)
 * and both layouts want the *repo-root* fixtures dir. We walk up until we
 * find a `benchmarks/fixtures` sibling — cheap and works everywhere.
 *
 * Overridable via `CARBON_SAMPLES_DIR` (used by tests and by Docker if the
 * folder is copied to a non-standard location).
 */
function fixturesDir(): string {
  const env = process.env.CARBON_SAMPLES_DIR;
  if (env) return env;
  let here = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i++) {
    try {
      const candidate = resolve(here, 'benchmarks', 'fixtures');
      readFileSync(resolve(candidate, 'petstore.openapi.json'), 'utf8');
      return candidate;
    } catch {
      /* keep walking */
    }
    const up = dirname(here);
    if (up === here) break;
    here = up;
  }
  // Last-ditch: assume we're running from repo root.
  return resolve(process.cwd(), 'benchmarks', 'fixtures');
}

export function loadSampleSpec(sampleId: string): unknown {
  const sample = SampleById.get(sampleId);
  if (!sample) throw new NotFoundError('sample', sampleId);
  const cached = specCache.get(sampleId);
  if (cached) return cached;
  const path = resolve(fixturesDir(), sample.fixture);
  const raw = readFileSync(path, 'utf8');
  const parsed = JSON.parse(raw) as unknown;
  specCache.set(sampleId, parsed);
  return parsed;
}

// Test-only: reset the parsed-spec cache. Exported so a unit test that
// mocks fs can force a re-read between assertions.
export function _resetSampleSpecCache(): void {
  specCache.clear();
}

const InstantiateBody = z.object({
  sampleId: z.string().min(1).max(64),
  /** Optional custom slug prefix — defaults to `sample-<id>-<rand>`. */
  slugPrefix: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]*$/)
    .max(40)
    .optional(),
});

const SampleSummary = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  tag: z.string(),
  annotations: z.object({
    highlight: z.string(),
    tryThis: z.array(z.string()),
  }),
});

const InstantiateResponse = z.object({
  projectSlug: z.string(),
  projectId: z.string(),
  orgId: z.string(),
  sample: SampleSummary,
  sampleAnnotations: z.object({
    highlight: z.string(),
    tryThis: z.array(z.string()),
  }),
  ingestResult: z
    .object({
      irId: z.string(),
      graphId: z.string(),
      endpoints: z.number().int(),
      resources: z.number().int(),
    })
    .passthrough(),
});

const ListResponse = z.object({ data: z.array(SampleSummary) });

function summarize(sample: SampleDefinition) {
  return {
    id: sample.id,
    name: sample.name,
    description: sample.description,
    tag: sample.tag,
    annotations: {
      highlight: sample.annotations.highlight,
      tryThis: [...sample.annotations.tryThis],
    },
  };
}

/** Short random suffix — kept URL-safe and slug-safe. */
function randomSlugSuffix(): string {
  return Math.random().toString(36).slice(2, 8);
}

export async function registerSampleRoutes(
  app: FastifyInstance,
  ctx: AppContext,
): Promise<void> {
  app.get('/v1/samples', {
    preHandler: requireScope('read'),
    schema: {
      summary: 'List curated samples',
      description:
        'Return every sample that can be instantiated into a fresh project via ' +
        '`POST /v1/samples/instantiate`. Content is static per deploy.',
      response: { 200: zodResponse(ListResponse) },
    },
  }, async () => {
    return { data: SAMPLES.map(summarize) };
  });

  app.post('/v1/samples/instantiate', {
    preHandler: requireScope('admin'),
    schema: {
      summary: 'Instantiate a curated sample into a fresh project',
      description:
        'Admin-scope one-click: create a new project, ingest the bundled OpenAPI spec ' +
        'for the named sample, and return the fresh project slug plus the ingest summary. ' +
        'Slug shape is `<slugPrefix|sample-{id}>-<random>`. Unknown `sampleId` → 404.',
      body: zodBody(InstantiateBody),
      response: {
        201: zodResponse(InstantiateResponse),
      },
    },
  }, async (req, reply) => {
    const body = InstantiateBody.parse(req.body ?? {});
    const sample = SampleById.get(body.sampleId);
    if (!sample) throw new NotFoundError('sample', body.sampleId);

    // Callers must be authenticated to a real org — we cannot create a
    // sample project in dev-mode "no org" mode because ingest persists to
    // storage keyed by org id, and the dashboard's redirect target is
    // per-org too.
    const orgId = resolveCallerOrg(req, {
      mode: 'throw',
      message: 'orgId is required to instantiate a sample — attach a session or API key',
    });

    const slugBase = body.slugPrefix ?? `sample-${sample.id}`;
    const slug = `${slugBase}-${randomSlugSuffix()}`;
    const projectId = makeId('prj');

    try {
      await ctx.db.insert(schema.projects).values({
        id: projectId,
        orgId,
        slug,
        name: `${sample.name} sample`,
      });
    } catch (err) {
      // Astronomically unlikely (6 base36 chars per suffix) but a duplicate
      // slug is the only expected failure mode here — surface it precisely
      // instead of a bare 500.
      if (err instanceof Error && /duplicate|unique/i.test(err.message)) {
        throw new CarbonError({
          code: 'CARBON_CONFLICT',
          message: `Sample slug collision on ${slug} — retry.`,
          expose: true,
        });
      }
      throw err;
    }

    const spec = loadSampleSpec(sample.id);
    const storageSlug = `${orgId}/${slug}`;
    const result = await ctx.ingestion.ingest({
      projectSlug: storageSlug,
      input: { kind: 'json', content: spec, hint: 'openapi' } as never,
      origin: `sample:${sample.id}`,
      enrich: false,
      context: { orgId },
    });

    const actor = getActor(req);
    await recordEvent(ctx, {
      orgId,
      projectId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      action: 'sample.instantiated',
      metadata: {
        sampleId: sample.id,
        projectSlug: slug,
        irId: result.irId,
        graphId: result.graphId,
        endpoints: result.ir.endpoints.length,
      },
    });
    await recordUsage(ctx, {
      orgId,
      kind: 'ingest',
      amount: 1,
      metadata: {
        projectSlug: slug,
        specKind: 'json',
        source: 'sample',
        sampleId: sample.id,
      },
    });

    reply.status(201);
    return {
      projectSlug: slug,
      projectId,
      orgId,
      sample: summarize(sample),
      sampleAnnotations: {
        highlight: sample.annotations.highlight,
        tryThis: [...sample.annotations.tryThis],
      },
      ingestResult: {
        irId: result.irId,
        graphId: result.graphId,
        endpoints: result.ir.endpoints.length,
        resources: result.ir.resources.length,
      },
    };
  });
}
