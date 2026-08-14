import { defineCommand } from 'citty';
import { readFile, stat } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import pc from 'picocolors';
import { ui } from '../ui.js';
import {
  EXIT_ASSERTION_FAILED,
  EXIT_CONNECTIVITY,
  EXIT_GENERIC,
  EXIT_INTERNAL,
} from '../lib/exit-codes.js';

interface ReplayRequest {
  method: string;
  path: string;
  headers?: Record<string, string>;
  body?: string | null;
  expectedStatus?: number;
  expectedBody?: string | null;
}

interface RecordedExchangeLike {
  request?: {
    method?: string;
    url?: string;
    headers?: Record<string, string>;
    body?: string | null;
  };
  response?: {
    status?: number;
    headers?: Record<string, string>;
    body?: string | null;
  };
}

interface RecordingFile {
  requests?: ReplayRequest[];
  exchanges?: RecordedExchangeLike[];
}

// Headers that should not be forwarded from the recording — they either belong
// to the transport or would confuse the target.
const STRIPPED_HEADERS = new Set([
  'host',
  'connection',
  'content-length',
  'accept-encoding',
  'transfer-encoding',
]);

export const replayCommand = defineCommand({
  meta: {
    name: 'replay',
    description: 'Replay a recording against a running runtime and compare responses.',
  },
  args: {
    recording: {
      type: 'positional',
      description: 'Recording id or path to a recording .json file',
      required: true,
    },
    target: {
      type: 'string',
      description: 'Base URL of the runtime to replay against',
      default: 'http://localhost:8787',
    },
    mode: {
      type: 'string',
      description: 'strict (status + body) or loose (status only)',
      default: 'strict',
    },
  },
  async run({ args }) {
    const mode = (args.mode as string) === 'loose' ? 'loose' : 'strict';
    const target = (args.target as string).replace(/\/+$/, '');
    const recordingArg = args.recording as string;

    const path = await resolveRecordingPath(recordingArg);
    if (!path) {
      const tried = candidatePaths(recordingArg).join('\n  ');
      ui.error(`Recording not found. Looked in:\n  ${tried}`);
      ui.event('replay', { result: 'not_found', target }, 'error');
      process.exitCode = EXIT_GENERIC;
      return;
    }

    let recording: RecordingFile;
    try {
      recording = JSON.parse(await readFile(path, 'utf8')) as RecordingFile;
    } catch (err) {
      ui.error(`Failed to parse ${path}: ${(err as Error).message}`);
      ui.event('replay', { result: 'parse_error', target }, 'error');
      process.exitCode = EXIT_INTERNAL;
      return;
    }

    const plan = normalizeRecording(recording);
    if (plan.length === 0) {
      ui.warn(`Recording ${ui.code(path)} contains no requests.`);
      return;
    }

    ui.header(`Replay ${path}`);
    ui.step('Target', target);
    ui.step('Mode', mode);
    ui.step('Requests', String(plan.length));

    let pass = 0;
    let assertionFail = 0;
    let connectivityFail = 0;
    let internalFail = 0;

    for (const req of plan) {
      const label = `${req.method} ${req.path}`;
      try {
        const url = target + (req.path.startsWith('/') ? req.path : `/${req.path}`);
        const res = await fetch(url, {
          method: req.method,
          headers: sanitizeHeaders(req.headers),
          body: req.body ?? undefined,
        });
        const text = await res.text();

        const statusOk = req.expectedStatus === undefined || req.expectedStatus === res.status;
        const bodyOk =
          mode === 'loose' ||
          req.expectedBody === undefined ||
          req.expectedBody === null ||
          req.expectedBody === text;

        if (statusOk && bodyOk) {
          pass += 1;
          process.stdout.write(`${pc.green('✓')} ${label} ${pc.dim(`→ ${res.status}`)}\n`);
        } else {
          assertionFail += 1;
          const parts: string[] = [];
          if (!statusOk) parts.push(`status ${res.status} != ${req.expectedStatus}`);
          if (!bodyOk) parts.push('body mismatch');
          process.stdout.write(
            `${pc.red('✗')} ${label} ${pc.dim(`→ ${res.status}`)} ${pc.red(parts.join('; '))}\n`,
          );
        }
      } catch (err) {
        // fetch() surfaces connectivity problems as TypeError with a `cause`
        // that carries the underlying node error (ECONNREFUSED, ETIMEDOUT,
        // ENOTFOUND, UND_ERR_CONNECT_TIMEOUT). Anything else we treat as an
        // unexpected internal failure — a distinct exit code so CI can tell
        // "server not up" apart from a real bug in the replay path.
        if (isConnectivityError(err)) {
          connectivityFail += 1;
          process.stdout.write(
            `${pc.red('✗')} ${label} ${pc.red(`connectivity: ${(err as Error).message}`)}\n`,
          );
        } else {
          internalFail += 1;
          process.stdout.write(`${pc.red('✗')} ${label} ${pc.red((err as Error).message)}\n`);
        }
      }
    }

    const fail = assertionFail + connectivityFail + internalFail;
    const total = pass + fail;
    const summary = `${pass}/${total} passed`;

    // Machine-parseable result line — printed even in human mode so scripts
    // wrapping `carbon replay` can grep for one stable token instead of
    // parsing the summary line.
    if (fail === 0) {
      ui.event('replay', { result: 'ok', target, passed: pass, total });
      ui.success(summary);
      return;
    }
    if (connectivityFail > 0 && assertionFail === 0 && internalFail === 0) {
      ui.event(
        'replay',
        { result: 'connectivity_error', target, failed: connectivityFail },
        'error',
      );
      ui.error(`${summary} — could not reach runtime at ${target}`);
      process.exitCode = EXIT_CONNECTIVITY;
      return;
    }
    if (internalFail > 0 && assertionFail === 0) {
      ui.event('replay', { result: 'internal_error', target, failed: internalFail }, 'error');
      ui.error(`${summary} — internal error`);
      process.exitCode = EXIT_INTERNAL;
      return;
    }
    ui.event(
      'replay',
      {
        result: 'assertion_failed',
        target,
        failed: assertionFail,
        connectivity: connectivityFail,
        internal: internalFail,
      },
      'error',
    );
    ui.error(`${summary} — ${fail} failed`);
    process.exitCode = EXIT_ASSERTION_FAILED;
  },
});

function isConnectivityError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as {
    code?: string;
    cause?: { code?: string; name?: string };
    name?: string;
    message?: string;
  };
  const code = e.code ?? e.cause?.code;
  if (
    code === 'ECONNREFUSED' ||
    code === 'ETIMEDOUT' ||
    code === 'ENOTFOUND' ||
    code === 'ECONNRESET'
  ) {
    return true;
  }
  const name = e.cause?.name ?? e.name;
  if (name === 'ConnectTimeoutError' || name === 'AbortError') return true;
  const msg = (e.message ?? '').toLowerCase();
  return msg.includes('fetch failed') || msg.includes('timeout') || msg.includes('econnrefused');
}

function normalizeRecording(rec: RecordingFile): ReplayRequest[] {
  if (Array.isArray(rec.requests) && rec.requests.length > 0) {
    return rec.requests.map((r) => ({
      method: (r.method ?? 'GET').toUpperCase(),
      path: r.path ?? '/',
      headers: r.headers,
      body: r.body ?? null,
      expectedStatus: r.expectedStatus,
      expectedBody: r.expectedBody ?? null,
    }));
  }
  if (Array.isArray(rec.exchanges)) {
    return rec.exchanges
      .filter((e) => e.request?.url && e.request?.method)
      .map((e) => {
        const raw = e.request!.url!;
        let pathAndQuery = raw;
        try {
          const u = new URL(raw);
          pathAndQuery = `${u.pathname}${u.search}`;
        } catch {
          // Recording captured a relative URL — use it verbatim.
        }
        return {
          method: e.request!.method!.toUpperCase(),
          path: pathAndQuery,
          headers: e.request?.headers,
          body: e.request?.body ?? null,
          expectedStatus: e.response?.status,
          expectedBody: e.response?.body ?? null,
        };
      });
  }
  return [];
}

function sanitizeHeaders(
  headers: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!headers) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (STRIPPED_HEADERS.has(k.toLowerCase())) continue;
    out[k] = v;
  }
  return out;
}

function candidatePaths(arg: string): string[] {
  if (isAbsolute(arg)) return [arg];
  const cwd = process.cwd();
  const withJson = arg.endsWith('.json') ? arg : `${arg}.json`;
  return [resolve(cwd, arg), resolve(cwd, withJson), join(cwd, '.carbon', 'recordings', withJson)];
}

async function resolveRecordingPath(arg: string): Promise<string | null> {
  for (const p of candidatePaths(arg)) {
    try {
      const s = await stat(p);
      if (s.isFile()) return p;
    } catch {
      // try next
    }
  }
  return null;
}
