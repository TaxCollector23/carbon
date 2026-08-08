/**
 * stateful-consistency.ts
 *
 * The "only Carbon does this" demo. Boots the runtime in-process, drives it
 * over a real HTTP loopback socket, and asserts that state survives across
 * requests: CREATE -> READ -> PATCH -> READ -> DELETE -> 404.
 *
 * We use a real port (not fastify.inject) because the point of this bench is
 * to prove behavior end-to-end. The trace of every request/response is
 * printed as JSON so the demo is self-documenting.
 */
import { performance } from 'node:perf_hooks';
import { BehaviorGraphBuilder } from '@carbon/graph';
import { createRuntime } from '@carbon/runtime';
import { InMemoryStateEngine } from '@carbon/state';
import { petsIr, round } from './lib/ir.js';

interface Step {
  step: string;
  method: string;
  path: string;
  requestBody: unknown;
  status: number;
  responseBody: unknown;
  elapsedMs: number;
  ok: boolean;
  assertion: string;
}

async function main() {
  const ir = petsIr();
  const graph = new BehaviorGraphBuilder().build(ir);
  const state = new InMemoryStateEngine();
  const runtime = await createRuntime({ ir, graph, state });
  const url = await runtime.listen(0);

  const trace: Step[] = [];
  let createdId: string | null = null;

  try {
    // 1. CREATE
    {
      const body = { name: 'Fido', species: 'dog' };
      const { status, json, elapsedMs } = await http(url, 'POST', '/pets', body);
      const id = (json as { id?: string } | null)?.id ?? null;
      createdId = id;
      trace.push({
        step: 'create',
        method: 'POST',
        path: '/pets',
        requestBody: body,
        status,
        responseBody: json,
        elapsedMs,
        ok: status === 201 && typeof id === 'string' && (json as { name?: string } | null)?.name === 'Fido',
        assertion: 'status=201 and response.id defined and response.name==="Fido"',
      });
    }
    if (!createdId) throw new Error('CREATE did not return an id — cannot continue');

    // 2. GET (readback)
    {
      const path = `/pets/${createdId}`;
      const { status, json, elapsedMs } = await http(url, 'GET', path);
      trace.push({
        step: 'read-after-create',
        method: 'GET',
        path,
        requestBody: null,
        status,
        responseBody: json,
        elapsedMs,
        ok: status === 200 && (json as { name?: string } | null)?.name === 'Fido',
        assertion: 'status=200 and response.name==="Fido" (state persisted)',
      });
    }

    // 3. PATCH
    {
      const path = `/pets/${createdId}`;
      const body = { name: 'Fido II', tricks: ['sit', 'roll'] };
      const { status, json, elapsedMs } = await http(url, 'PATCH', path, body);
      trace.push({
        step: 'update',
        method: 'PATCH',
        path,
        requestBody: body,
        status,
        responseBody: json,
        elapsedMs,
        ok: status === 200 && (json as { name?: string } | null)?.name === 'Fido II',
        assertion: 'status=200 and response.name==="Fido II" (patch merged)',
      });
    }

    // 4. GET (verify patch)
    {
      const path = `/pets/${createdId}`;
      const { status, json, elapsedMs } = await http(url, 'GET', path);
      const j = json as { name?: string; species?: string; tricks?: unknown[] } | null;
      trace.push({
        step: 'read-after-update',
        method: 'GET',
        path,
        requestBody: null,
        status,
        responseBody: json,
        elapsedMs,
        ok:
          status === 200 &&
          j?.name === 'Fido II' &&
          j?.species === 'dog' &&
          Array.isArray(j?.tricks) &&
          j?.tricks.length === 2,
        assertion: 'patch persisted, previous fields preserved (species===dog)',
      });
    }

    // 5. DELETE
    {
      const path = `/pets/${createdId}`;
      const { status, json, elapsedMs } = await http(url, 'DELETE', path);
      trace.push({
        step: 'delete',
        method: 'DELETE',
        path,
        requestBody: null,
        status,
        responseBody: json,
        elapsedMs,
        ok: status === 204,
        assertion: 'status=204',
      });
    }

    // 6. GET (expect 404)
    {
      const path = `/pets/${createdId}`;
      const { status, json, elapsedMs } = await http(url, 'GET', path);
      trace.push({
        step: 'read-after-delete',
        method: 'GET',
        path,
        requestBody: null,
        status,
        responseBody: json,
        elapsedMs,
        ok: status === 404,
        assertion: 'status=404 (delete honored)',
      });
    }
  } finally {
    await runtime.close();
  }

  const allOk = trace.every((s) => s.ok);
  const output = {
    tool: 'carbon',
    demo: 'stateful-consistency',
    generatedAt: new Date().toISOString(),
    node: process.version,
    url,
    passed: allOk,
    stepCount: trace.length,
    trace: trace.map((s) => ({ ...s, elapsedMs: round(s.elapsedMs) })),
  };
  console.log(JSON.stringify(output, null, 2));
  if (!allOk) process.exit(1);
}

async function http(
  baseUrl: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: unknown; elapsedMs: number }> {
  const start = performance.now();
  const res = await fetch(baseUrl + path, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const elapsedMs = performance.now() - start;
  let json: unknown = null;
  if (text.length > 0) {
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
  }
  return { status: res.status, json, elapsedMs };
}

void main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
