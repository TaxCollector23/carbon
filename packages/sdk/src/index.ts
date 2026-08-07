import { createLogger, type Logger } from '@carbon/core';
import { BehaviorGraphBuilder } from '@carbon/graph';
import { createDefaultParserRegistry, createParserContext, type ParserInput } from '@carbon/parser';
import { createRuntime, type Runtime } from '@carbon/runtime';
import { InMemoryStateEngine, type StateEngine, type StateSnapshot } from '@carbon/state';

export interface EmulateOptions {
  /** API source path/URL, recorded traffic, or preloaded ParserInput. */
  readonly from: ParserInput | string;
  readonly port?: number;
  readonly host?: string;
  readonly snapshot?: StateSnapshot | null;
  readonly logger?: Logger;
}

export interface Replica {
  readonly url: string;
  readonly state: {
    reset(): Promise<void>;
    engine: StateEngine;
  };
  readonly snapshot: {
    save(name: string): Promise<StateSnapshot>;
    restore(snapshot: StateSnapshot): Promise<void>;
  };
  close(): Promise<void>;
  readonly runtime: Runtime;
}

/**
 * The programmatic entry point. Composes parser → graph → runtime into a
 * single Replica object suitable for test suites and dev servers.
 */
export const carbon = {
  async emulate(opts: EmulateOptions): Promise<Replica> {
    const logger = opts.logger ?? createLogger({ level: 'info', pretty: true, name: 'sdk' });

    const parsers = createDefaultParserRegistry();

    const input: ParserInput =
      typeof opts.from === 'string' ? await loadInput(opts.from) : opts.from;
    const ctx = createParserContext(logger);
    const ir = await parsers.parse(input, ctx);
    const graph = new BehaviorGraphBuilder().build(ir);
    const state = new InMemoryStateEngine();
    if (opts.snapshot) await state.restore(opts.snapshot);

    const runtime = await createRuntime({ ir, graph, state, logger });
    const url = await runtime.listen(opts.port ?? 8787, opts.host ?? '127.0.0.1');

    return {
      url,
      runtime,
      state: {
        engine: state,
        reset: () => state.reset(),
      },
      snapshot: {
        save: async () => state.snapshot(),
        restore: (snap) => state.restore(snap),
      },
      close: () => runtime.close(),
    };
  },
};

async function loadInput(source: string): Promise<ParserInput> {
  if (source.startsWith('http://') || source.startsWith('https://')) {
    const res = await fetch(source);
    const text = await res.text();
    return { kind: 'text', content: text };
  }
  const { readFile } = await import('node:fs/promises');
  const text = await readFile(source, 'utf8');
  try {
    return { kind: 'json', content: JSON.parse(text) };
  } catch {
    return { kind: 'text', content: text };
  }
}
