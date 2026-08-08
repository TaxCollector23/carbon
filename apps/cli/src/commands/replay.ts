import { defineCommand } from 'citty';
import { readFile, stat } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import pc from 'picocolors';
import { ui } from '../ui.js';

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
      process.exitCode = 1;
      return;
    }

    let recording: RecordingFile;
    try {
      recording = JSON.parse(await readFile(path, 'utf8')) as RecordingFile;
    } catch (err) {
      ui.error(`Failed to parse ${path}: ${(err as Error).message}`);
      process.exitCode = 1;
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
    let fail = 0;

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

        const statusOk =
          req.expectedStatus === undefined || req.expectedStatus === res.status;
        const bodyOk =
          mode === 'loose' ||
          req.expectedBody === undefined ||
          req.expectedBody === null ||
          req.expectedBody === text;

        if (statusOk && bodyOk) {
          pass += 1;
          process.stdout.write(
            `${pc.green('✓')} ${label} ${pc.dim(`→ ${res.status}`)}\n`,
          );
        } else {
          fail += 1;
          const parts: string[] = [];
          if (!statusOk) parts.push(`status ${res.status} != ${req.expectedStatus}`);
          if (!bodyOk) parts.push('body mismatch');
          process.stdout.write(
            `${pc.red('✗')} ${label} ${pc.dim(`→ ${res.status}`)} ${pc.red(parts.join('; '))}\n`,
          );
        }
      } catch (err) {
        fail += 1;
        process.stdout.write(
          `${pc.red('✗')} ${label} ${pc.red((err as Error).message)}\n`,
        );
      }
    }

    const total = pass + fail;
    const summary = `${pass}/${total} passed`;
    if (fail === 0) {
      ui.success(summary);
    } else {
      ui.error(`${summary} — ${fail} failed`);
      process.exitCode = 1;
    }
  },
});

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
  return [
    resolve(cwd, arg),
    resolve(cwd, withJson),
    join(cwd, '.carbon', 'recordings', withJson),
  ];
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
