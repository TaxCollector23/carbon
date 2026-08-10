import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { BehaviorGraphBuilder } from '@carbon/graph';
import { InMemoryStateEngine } from '@carbon/state';
import type {
  EndpointId,
  IntermediateRepresentation,
  ResourceId,
} from '@carbon/types';
import { createRuntime, type Runtime } from './runtime.js';

const customer = 'customer' as ResourceId;

function ir(): IntermediateRepresentation {
  return {
    version: 1,
    api: { name: 't', version: '0', source: { kind: 'openapi', ingestedAt: 0 } },
    servers: [],
    auth: [],
    resources: [{ id: customer, name: 'Customer', primaryKey: 'id', schema: { kind: 'unknown' } }],
    endpoints: [
      {
        id: 'POST:/customers' as EndpointId,
        method: 'POST',
        path: '/customers',
        operation: 'create',
        resource: customer,
        params: [],
        requestBody: null,
        responses: [],
        auth: [],
        meta: {},
      },
    ],
    relationships: [],
    examples: [],
    meta: {},
  };
}

async function boot(): Promise<Runtime> {
  const spec = ir();
  const graph = new BehaviorGraphBuilder().build(spec);
  const state = new InMemoryStateEngine();
  const rt = await createRuntime({ ir: spec, graph, state });
  await rt.listen(0);
  return rt;
}

describe('runtime state stream (websocket)', () => {
  let rt: Runtime | null = null;
  afterEach(async () => {
    if (rt) await rt.close();
    rt = null;
  });

  it('sends a snapshot then a mutation frame when a resource is created', async () => {
    rt = await boot();
    const wsUrl = rt.url.replace(/^http/, 'ws') + '/__carbon/state/stream';
    const ws = new WebSocket(wsUrl);

    const frames: Array<Record<string, unknown>> = [];
    const gotMutation = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout waiting for mutation frame')), 500);
      ws.on('message', (buf: WebSocket.RawData) => {
        const msg = JSON.parse(buf.toString()) as Record<string, unknown>;
        frames.push(msg);
        if (msg.type === 'mutation') {
          clearTimeout(timer);
          resolve();
        }
      });
      ws.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });

    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
    });

    // Issue an HTTP POST via injection — it drives the same request path.
    const created = await rt.app.inject({
      method: 'POST',
      url: '/customers',
      payload: { name: 'Ada' },
    });
    expect(created.statusCode).toBe(201);

    await gotMutation;
    ws.close();

    expect(frames[0]).toMatchObject({ type: 'snapshot' });
    const mutation = frames.find((f) => f.type === 'mutation') as
      | { type: 'mutation'; entry: { op: string; resource: string; id: string } }
      | undefined;
    expect(mutation).toBeDefined();
    expect(mutation!.entry.op).toBe('create');
    expect(mutation!.entry.resource).toBe('customer');
  });
});
