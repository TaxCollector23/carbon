/**
 * @carbon/vitest — ergonomic vitest glue for booting a scoped Carbon
 * emulator per test file. Thin wrapper around `@carbon/sdk`'s
 * `carbon.emulate()` — no new runtime concepts.
 */
import { createServer } from 'node:net';
import { test as vitestTest, type TestAPI } from 'vitest';
import { carbon, type Replica } from '@carbon/sdk';
import type { ParserInput } from '@carbon/parser';
import type { StateSnapshot } from '@carbon/state';

export interface WithCarbonOptions {
  /**
   * OpenAPI (or other supported) spec. Accepts a file path, http(s) URL,
   * raw text/JSON string, a Buffer, or a pre-shaped ParserInput.
   */
  readonly spec: string | Buffer | ParserInput;
  /** Bind port. Omit (or 0) to auto-pick a free one. */
  readonly port?: number;
  /** Reserved for future deterministic-seed hooks (currently unused). */
  readonly seed?: string;
  /** Extra env vars set for the duration of the emulator. */
  readonly env?: Record<string, string>;
  /** Optional readiness probe once the emulator is bound. */
  readonly ready?: (baseUrl: string) => Promise<void>;
}

export interface CarbonHandle {
  readonly baseUrl: string;
  snapshot(name?: string): Promise<StateSnapshot>;
  rewind(snapshot: StateSnapshot): Promise<void>;
  reset(): Promise<void>;
  stop(): Promise<void>;
  readonly replica: Replica;
}

/**
 * Boot a Carbon emulator. Intended for use inside `beforeAll` — pair with an
 * `afterAll(() => handle.stop())`. Registers SIGINT/SIGTERM cleanup so a
 * ctrl-c during a hung suite still releases the port.
 */
export async function withCarbon(opts: WithCarbonOptions): Promise<CarbonHandle> {
  const from = await toParserInput(opts.spec);
  const port = opts.port ?? (await pickFreePort());

  const prevEnv: Record<string, string | undefined> = {};
  if (opts.env) {
    for (const [k, v] of Object.entries(opts.env)) {
      prevEnv[k] = process.env[k];
      process.env[k] = v;
    }
  }

  const replica = await carbon.emulate({ from, port });
  if (opts.ready) await opts.ready(replica.url);

  let stopped = false;
  const cleanup = async () => {
    if (stopped) return;
    stopped = true;
    for (const [k, v] of Object.entries(prevEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    try {
      await replica.stop();
    } catch {
      /* stop is best-effort — the process is about to exit anyway */
    }
  };
  registerCleanup(cleanup);

  return {
    baseUrl: replica.url,
    replica,
    snapshot: (name = 'test') => replica.snapshot.save(name),
    rewind: (snap) => replica.snapshot.restore(snap),
    reset: () => replica.state.reset(),
    stop: cleanup,
  };
}

export interface CarbonTestContext {
  readonly baseUrl: string;
  readonly carbon: CarbonHandle;
}

/**
 * Drop-in replacement for `test()` that boots a fresh emulator per case and
 * tears it down when the test finishes. The callback receives a
 * `CarbonTestContext` with the base URL.
 */
export function carbonTest(
  name: string,
  fn: (ctx: CarbonTestContext) => void | Promise<void>,
  opts: WithCarbonOptions,
): void {
  (vitestTest as TestAPI)(name, async () => {
    const handle = await withCarbon(opts);
    try {
      await fn({ baseUrl: handle.baseUrl, carbon: handle });
    } finally {
      await handle.stop();
    }
  });
}

// --- internals ---------------------------------------------------------

async function toParserInput(spec: WithCarbonOptions['spec']): Promise<ParserInput | string> {
  if (Buffer.isBuffer(spec)) {
    const text = spec.toString('utf8');
    return coerceText(text);
  }
  if (typeof spec === 'string') {
    if (looksLikePathOrUrl(spec)) return spec; // SDK handles fetch/readFile
    return coerceText(spec);
  }
  return spec;
}

function coerceText(text: string): ParserInput {
  const trimmed = text.trimStart();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return { kind: 'json', content: JSON.parse(text) };
    } catch {
      /* fall through */
    }
  }
  return { kind: 'text', content: text };
}

function looksLikePathOrUrl(s: string): boolean {
  if (s.startsWith('http://') || s.startsWith('https://')) return true;
  if (s.includes('\n')) return false;
  if (s.startsWith('/') || s.startsWith('./') || s.startsWith('../')) return true;
  // Heuristic: no whitespace and ends with a known spec extension.
  return /^[\w./\\:-]+\.(ya?ml|json|graphql|proto)$/i.test(s);
}

async function pickFreePort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (addr && typeof addr === 'object') {
        const port = addr.port;
        srv.close(() => resolve(port));
      } else {
        srv.close(() => reject(new Error('failed to pick free port')));
      }
    });
  });
}

// Track cleanups so a single SIGINT tears down every emulator this process
// spun up, not just the last one.
const pending = new Set<() => Promise<void>>();
let signalsWired = false;

function registerCleanup(fn: () => Promise<void>): void {
  pending.add(fn);
  const wrapped = async () => {
    pending.delete(fn);
    await fn();
  };
  // Replace the tracked entry with the wrapped variant so stop() removes itself.
  pending.delete(fn);
  pending.add(wrapped);

  if (signalsWired) return;
  signalsWired = true;
  const onSignal = () => {
    void Promise.allSettled([...pending].map((f) => f())).then(() => {
      // Re-raise default behavior by exiting; tests running under vitest
      // will already be shutting down by this point.
      process.exit(130);
    });
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
}
