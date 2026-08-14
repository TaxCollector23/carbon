import { defineCommand } from 'citty';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createLogger } from '@carbon/core';
import { HttpRecordingProxy } from '@carbon/proxy';
import type { Recording, RecordedExchange } from '@carbon/types';
import { ui } from '../ui.js';

/**
 * Always-on redactions. These are the header names that most commonly carry
 * bearer tokens or session credentials — we strip them by default from every
 * captured exchange so a recording is safe to commit without extra flags.
 */
const DEFAULT_REDACT_HEADERS = [
  'authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'proxy-authorization',
];

export const recordCommand = defineCommand({
  meta: { name: 'record', description: 'Observe live traffic against an upstream API.' },
  args: {
    target: { type: 'positional', description: 'Upstream base URL' },
    port: { type: 'string', description: 'Local proxy port', default: '8788' },
    out: {
      type: 'string',
      description: 'Where to write the recording',
      default: '.carbon/recordings',
    },
    redact: {
      type: 'string',
      description: 'Comma-separated extra headers to redact (added to the defaults).',
    },
    'redact-body': {
      type: 'string',
      description: 'Regex applied to request/response bodies; matches replaced with [redacted].',
    },
  },
  async run({ args }) {
    const logger = createLogger({ level: 'info', pretty: true, name: 'record' });

    const extraHeaders = parseHeaderList(args.redact as string | undefined);
    const redactHeaders = mergeHeaders(DEFAULT_REDACT_HEADERS, extraHeaders);
    const bodyRegex = compileBodyRegex(args['redact-body'] as string | undefined);

    const proxy = new HttpRecordingProxy();
    const handle = await proxy.start({
      target: args.target,
      port: Number(args.port),
      logger,
      // The proxy handles header redaction natively — hand our merged set in
      // so both defaults and the user's extras go through the same code path.
      redactHeaders,
      onExchange: (exchange) => {
        ui.step(
          `${exchange.request.method} ${new URL(exchange.request.url).pathname}`,
          `${exchange.response.status} · ${exchange.latencyMs}ms`,
        );
      },
    });

    ui.header('Carbon recorder');
    ui.step('Target', args.target);
    ui.step('Proxy', handle.url);
    ui.step('Recording', handle.recordingId);
    if (extraHeaders.length > 0)
      ui.step('Redact', [...DEFAULT_REDACT_HEADERS, ...extraHeaders].join(', '));
    if (bodyRegex) ui.step('Redact body', bodyRegex.source);
    ui.info('Press Ctrl+C to stop and save.');

    await new Promise<void>((resolve) => {
      process.once('SIGINT', () => resolve());
    });

    const recording = await handle.stop();
    // Body redaction is done post-capture: the proxy doesn't inspect payloads,
    // and running the regex once at save time keeps the hot path fast.
    const finalRecording = bodyRegex ? redactRecordingBodies(recording, bodyRegex) : recording;

    const path = join(args.out, `${recording.id}.json`);
    await ensureDir(args.out);
    await writeFile(path, JSON.stringify(finalRecording, null, 2), 'utf8');
    ui.success(`Saved ${finalRecording.exchanges.length} exchanges → ${ui.code(path)}`);
  },
});

async function ensureDir(dir: string): Promise<void> {
  const { mkdir } = await import('node:fs/promises');
  await mkdir(dir, { recursive: true });
}

function parseHeaderList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
}

function mergeHeaders(base: readonly string[], extra: readonly string[]): string[] {
  const set = new Set<string>();
  for (const h of base) set.add(h.toLowerCase());
  for (const h of extra) set.add(h.toLowerCase());
  return Array.from(set);
}

function compileBodyRegex(pattern: string | undefined): RegExp | null {
  if (!pattern) return null;
  try {
    return new RegExp(pattern, 'g');
  } catch (err) {
    ui.warn(`--redact-body regex invalid, ignoring: ${(err as Error).message}`);
    return null;
  }
}

function redactRecordingBodies(rec: Recording, re: RegExp): Recording {
  const scrub = (body: string | null): string | null => {
    if (body == null) return body;
    // Reset lastIndex on each call — the regex is global, and a stateful
    // instance would skip matches on the second body onward.
    re.lastIndex = 0;
    return body.replace(re, '[redacted]');
  };
  const exchanges: RecordedExchange[] = rec.exchanges.map((e) => ({
    ...e,
    request: { ...e.request, body: scrub(e.request.body) },
    response: { ...e.response, body: scrub(e.response.body) },
  }));
  return { ...rec, exchanges };
}
