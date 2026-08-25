'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Camera,
  Check,
  Copy,
  FlaskConical,
  Loader2,
  Play,
  RotateCcw,
  Send,
  Server,
  Square,
  Undo2,
} from 'lucide-react';
import { cn } from '@carbon/ui';
import { runBrowserMetrics, type BrowserMetrics } from '@/lib/metrics-harness';
import { track } from '@/lib/track';

const API_URL =
  (typeof process !== 'undefined' ? process.env.NEXT_PUBLIC_CARBON_API_URL : undefined) ?? '';

const SAMPLES: ReadonlyArray<{ id: string; name: string; hint: string }> = [
  { id: 'petstore', name: 'Petstore', hint: 'POST /pets → GET /pets' },
  { id: 'stripe', name: 'Stripe', hint: 'POST /v1/customers' },
  { id: 'github', name: 'GitHub', hint: 'POST /user/repos' },
  { id: 'openai', name: 'OpenAI', hint: 'POST /chat/completions' },
  { id: 'twilio', name: 'Twilio', hint: 'POST /Accounts/{AccountSid}/Messages.json' },
  { id: 'shopify', name: 'Shopify', hint: 'POST /products.json' },
];

const METHODS = ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'] as const;
type Method = (typeof METHODS)[number];

interface SandboxRecord {
  id: string;
  url: string;
  sample: string;
  spec: string;
  startedAt: number;
  lastActivityAt: number;
  requestCount: number;
}

interface ProxyResult {
  id: string;
  method: string;
  path: string;
  status: number;
  latencyMs: number;
  headers: Record<string, string>;
  body: unknown;
}

interface JournalEntry {
  seq: number;
  at: number;
  op: string;
  resource: string;
  id: string;
}

interface RequestLogEntry {
  id: number;
  method: string;
  path: string;
  status: number;
  latencyMs: number;
  body: unknown;
  requestBody?: unknown;
}

function fmtMs(n: number): string {
  if (n < 1) return `${n.toFixed(2)} ms`;
  if (n < 100) return `${n.toFixed(1)} ms`;
  return `${Math.round(n)} ms`;
}

function fmt(n: number): string {
  return new Intl.NumberFormat('en-US').format(n);
}

function pretty(body: unknown): string {
  if (typeof body === 'string') return body;
  try {
    return JSON.stringify(body, null, 2);
  } catch {
    return String(body);
  }
}

function statusColor(status: number): string {
  if (status >= 500) return 'text-destructive';
  if (status >= 400) return 'text-amber-600 dark:text-amber-400';
  return 'text-emerald-600 dark:text-emerald-400';
}

export function TestConsole() {
  const apiUrl = API_URL.replace(/\/+$/, '');
  const offline = apiUrl.length === 0;

  const [sandbox, setSandbox] = useState<SandboxRecord | null>(null);
  const [sample, setSample] = useState('petstore');
  const [method, setMethod] = useState<Method>('GET');
  const [path, setPath] = useState('/pets');
  const [body, setBody] = useState('');
  const [response, setResponse] = useState<ProxyResult | null>(null);
  const [requestLog, setRequestLog] = useState<RequestLogEntry[]>([]);
  const [history, setHistory] = useState<JournalEntry[]>([]);
  const [busy, setBusy] = useState<'start' | 'send' | 'state' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [browser, setBrowser] = useState<BrowserMetrics | null>(null);

  const refreshState = useCallback(
    async (id: string) => {
      const res = await fetch(`${apiUrl}/v1/sandbox/${id}/__carbon/state/history`);
      if (!res.ok) return;
      const wrapped = (await res.json()) as ProxyResult;
      const entries = (wrapped.body as { entries?: JournalEntry[] } | null)?.entries;
      if (Array.isArray(entries)) setHistory(entries);
    },
    [apiUrl],
  );

  const start = useCallback(async () => {
    if (offline) return;
    setBusy('start');
    setError(null);
    try {
      const res = await fetch(`${apiUrl}/v1/sandbox`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sample }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw new Error(err?.error?.message ?? `HTTP ${res.status}`);
      }
      const record = (await res.json()) as SandboxRecord;
      setSandbox(record);
      setResponse(null);
      setRequestLog([]);
      setHistory([]);
      track('test.start', { sample: record.sample, spec: record.spec });
      await refreshState(record.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }, [apiUrl, offline, sample, refreshState]);

  const stop = useCallback(async () => {
    if (!sandbox) return;
    try {
      await fetch(`${apiUrl}/v1/sandbox/${sandbox.id}`, { method: 'DELETE' });
    } catch {
      /* the sandbox TTL will reclaim it */
    }
    setSandbox(null);
    setResponse(null);
    setHistory([]);
    setError(null);
    track('test.stop', { sample });
  }, [apiUrl, sandbox, sample]);

  const send = useCallback(async () => {
    if (!sandbox) return;
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    if (cleanPath === '/') {
      setError('Pick a path — try POST /pets first.');
      return;
    }
    setBusy('send');
    setError(null);
    try {
      const res = await fetch(`${apiUrl}/v1/sandbox/${sandbox.id}${cleanPath}`, {
        method,
        headers: { 'content-type': 'application/json' },
        body: ['GET', 'DELETE'].includes(method) ? undefined : body,
      });
      const wrapped = (await res.json().catch(() => null)) as ProxyResult | null;
      if (!wrapped) throw new Error(`HTTP ${res.status}`);
      setResponse(wrapped);
      let requestBody: unknown;
      if (body.trim()) {
        try {
          requestBody = JSON.parse(body);
        } catch {
          requestBody = body;
        }
      }
      setRequestLog((log) =>
        [
          {
            id: Date.now(),
            method,
            path: cleanPath,
            status: wrapped.status,
            latencyMs: wrapped.latencyMs,
            body: wrapped.body,
            requestBody,
          },
          ...log,
        ].slice(0, 12),
      );
      track('test.send', { method, path: cleanPath, status: wrapped.status });
      await refreshState(sandbox.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }, [apiUrl, sandbox, method, path, body, refreshState]);

  const stateAction = useCallback(
    async (action: 'reset' | 'snapshot' | 'rewind', seq?: number) => {
      if (!sandbox) return;
      setBusy('state');
      setError(null);
      try {
        const res = await fetch(`${apiUrl}/v1/sandbox/${sandbox.id}/__carbon/state/${action}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: action === 'rewind' ? JSON.stringify({ seq }) : undefined,
        });
        if (!res.ok) {
          const wrapped = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
          throw new Error(wrapped?.error?.message ?? `HTTP ${res.status}`);
        }
        await refreshState(sandbox.id);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(null);
      }
    },
    [apiUrl, sandbox, refreshState],
  );

  const copyCurl = useCallback(async () => {
    if (!sandbox) return;
    const last = requestLog[0];
    if (!last) return;
    const url = `${apiUrl}/v1/sandbox/${sandbox.id}${last.path}`;
    const requestBody =
      last.requestBody !== undefined ? JSON.stringify(last.requestBody) : null;
    const curl = `curl -X ${last.method} '${url}'${requestBody ? ` \\\n  -H 'content-type: application/json' \\\n  -d '${requestBody.replace(/'/g, "'\\''")}'` : ''}`;
    try {
      await navigator.clipboard.writeText(curl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable */
    }
  }, [apiUrl, sandbox, requestLog]);

  const runBrowser = useCallback(() => {
    setBrowser(runBrowserMetrics());
  }, []);

  const live = sandbox !== null;

  return (
    <div className="border-border bg-background/40 mt-14 overflow-hidden rounded-xl border">
      {/* Toolbar */}
      <div className="border-border bg-subtle flex flex-wrap items-center gap-3 border-b px-4 py-3 sm:px-5">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'inline-flex h-2 w-2 rounded-full',
              live ? 'bg-emerald-500' : offline ? 'bg-muted-foreground/50' : 'bg-amber-500',
            )}
          />
          <span className="text-muted-foreground text-xs font-medium uppercase tracking-widest">
            {live ? 'live' : offline ? 'offline' : 'stopped'}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <select
            aria-label="Sample API"
            value={sample}
            onChange={(event) => setSample(event.target.value)}
            disabled={live}
            className="border-input bg-background text-foreground rounded-md border px-2.5 py-1.5 font-mono text-xs disabled:cursor-not-allowed disabled:opacity-50"
          >
            {SAMPLES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          {live ? (
            <button
              type="button"
              onClick={stop}
              className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors"
            >
              <Square className="h-3 w-3" /> Stop
            </button>
          ) : (
            <button
              type="button"
              onClick={start}
              disabled={offline || busy === 'start'}
              className="bg-foreground text-background inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy === 'start' ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" /> Booting…
                </>
              ) : (
                <>
                  <FlaskConical className="h-3 w-3" /> Start a real runtime
                </>
              )}
            </button>
          )}
        </div>

        {live && sandbox && (
          <span className="text-muted-foreground ml-auto hidden font-mono text-xs sm:inline">
            {sandbox.spec} · {fmt(sandbox.requestCount)} requests
          </span>
        )}
      </div>

      {offline ? (
        <div className="p-6 sm:p-8">
          <div className="border-border bg-subtle rounded-lg border p-5 text-sm leading-6">
            <div className="font-medium">Live testing needs the control plane</div>
            <p className="text-muted-foreground mt-1">
              Set <code className="font-mono text-xs">NEXT_PUBLIC_CARBON_API_URL</code> on the web
              deploy and this console boots a real Carbon runtime server-side — every request you
              send is real HTTP against a real state engine.
            </p>
            <button
              type="button"
              onClick={runBrowser}
              className="text-muted-foreground hover:text-foreground mt-4 inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-xs font-medium transition-colors"
            >
              <Play className="h-3.5 w-3.5" /> Until then, run the engine in your browser
            </button>
          </div>
          {browser && (
            <div className="mt-5 grid gap-3 text-sm sm:grid-cols-3">
              {[
                [
                  'Stateful checks',
                  `${browser.stateful.passed ? browser.stateful.stepCount : 0}/${browser.stateful.stepCount} passed`,
                  browser.stateful.passed ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive',
                ],
                [
                  'Executions/s',
                  fmt(browser.burst.executionsPerSec),
                  'text-foreground font-mono',
                ],
                [
                  'p95 latency',
                  fmtMs(browser.burst.latencyMs.p95),
                  'text-foreground font-mono',
                ],
              ].map(([label, value, cls]) => (
                <div key={label} className="border-border bg-subtle rounded-lg border p-4">
                  <div className="text-muted-foreground text-xs uppercase tracking-wider">
                    {label}
                  </div>
                  <div className={cn('mt-1 font-medium', cls)}>{value}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="grid lg:grid-cols-[1.55fr_1fr]">
          {/* Request builder + response */}
          <div className="border-border border-b p-5 sm:p-6 lg:border-b-0 lg:border-r">
            <div className="flex items-center gap-2">
              <Send className="text-muted-foreground h-3.5 w-3.5" />
              <span className="text-muted-foreground text-xs font-medium uppercase tracking-widest">
                request builder
              </span>
            </div>

            <div className="mt-4 grid grid-cols-[auto_1fr] gap-2">
              <select
                aria-label="HTTP method"
                value={method}
                onChange={(event) => setMethod(event.target.value as Method)}
                disabled={!live}
                className="border-input bg-background text-foreground rounded-md border px-3 py-2 font-mono text-sm disabled:opacity-50"
              >
                {METHODS.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
              <input
                aria-label="Request path"
                value={path}
                onChange={(event) => setPath(event.target.value)}
                disabled={!live}
                placeholder="/pets"
                className="border-input bg-background text-foreground min-w-0 rounded-md border px-3 py-2 font-mono text-sm disabled:opacity-50"
              />
            </div>

            {method === 'POST' || method === 'PATCH' || method === 'PUT' ? (
              <textarea
                aria-label="JSON request body"
                value={body}
                onChange={(event) => setBody(event.target.value)}
                disabled={!live}
                rows={4}
                spellCheck={false}
                placeholder={'{\n  "name": "Fido"\n}'}
                className="border-input bg-background text-foreground mt-2 w-full resize-y rounded-md border px-3 py-2 font-mono text-xs leading-5 disabled:opacity-50"
              />
            ) : null}

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={send}
                disabled={!live || busy === 'send'}
                className="bg-foreground text-background inline-flex items-center gap-1.5 rounded-md px-3.5 py-2 text-xs font-medium transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy === 'send' ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Sending…
                  </>
                ) : (
                  <>
                    <Play className="h-3.5 w-3.5 fill-current" /> Send
                  </>
                )}
              </button>
              {live && (
                <button
                  type="button"
                  onClick={copyCurl}
                  className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 rounded-md border px-2.5 py-2 text-xs transition-colors"
                >
                  {copied ? (
                    <>
                      <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" /> Copied
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" /> Copy curl
                    </>
                  )}
                </button>
              )}
            </div>

            {error && <p className="text-destructive mt-3 text-xs leading-5">{error}</p>}

            <div className="mt-6">
              <div className="text-muted-foreground flex items-center justify-between text-xs font-medium uppercase tracking-widest">
                <span>response</span>
                {response && (
                  <span className={cn('font-mono text-sm', statusColor(response.status))}>
                    {response.status} · {fmtMs(response.latencyMs)}
                  </span>
                )}
              </div>
              <div className="bg-subtle border-border mt-3 min-h-44 overflow-auto rounded-lg border p-4">
                {response ? (
                  <pre className="text-foreground whitespace-pre-wrap font-mono text-xs leading-6">
                    {pretty(response.body)}
                  </pre>
                ) : (
                  <div className="text-muted-foreground flex min-h-36 items-center justify-center text-center text-sm">
                    {live
                      ? `Send a request — try ${SAMPLES.find((s) => s.id === sample)?.hint ?? 'POST /pets'}.`
                      : 'Start a runtime to send real HTTP.'}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* State + request log */}
          <div className="flex flex-col p-5 sm:p-6">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Activity className="text-muted-foreground h-3.5 w-3.5" />
                <span className="text-muted-foreground text-xs font-medium uppercase tracking-widest">
                  state journal
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => stateAction('reset')}
                  disabled={!live || busy === 'state'}
                  title="Reset state"
                  className="text-muted-foreground hover:text-foreground rounded-md border p-1.5 transition-colors disabled:opacity-40"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => stateAction('snapshot')}
                  disabled={!live || busy === 'state'}
                  title="Snapshot state"
                  className="text-muted-foreground hover:text-foreground rounded-md border p-1.5 transition-colors disabled:opacity-40"
                >
                  <Camera className="h-3.5 w-3.5" />
                </button>
                {busy === 'state' && <Loader2 className="text-muted-foreground h-3.5 w-3.5 animate-spin" />}
              </div>
            </div>

            <div className="border-border mt-3 max-h-44 divide-y overflow-y-auto rounded-lg border">
              {history.length === 0 ? (
                <div className="text-muted-foreground p-3 text-xs">
                  No mutations yet — POST something.
                </div>
              ) : (
                history.map((entry) => (
                  <div
                    key={entry.seq}
                    className="hover:bg-subtle flex items-center gap-2 px-3 py-1.5 text-xs transition-colors"
                  >
                    <span className="text-muted-foreground w-6 font-mono">#{entry.seq}</span>
                    <span className="w-16 font-mono">{entry.op}</span>
                    <span className="text-muted-foreground min-w-0 flex-1 truncate font-mono">
                      {entry.resource}:{entry.id}
                    </span>
                    <button
                      type="button"
                      onClick={() => stateAction('rewind', entry.seq)}
                      disabled={busy === 'state'}
                      title={`Rewind to seq ${entry.seq}`}
                      className="text-muted-foreground hover:text-foreground rounded p-1 transition-colors disabled:opacity-40"
                    >
                      <Undo2 className="h-3 w-3" />
                    </button>
                  </div>
                ))
              )}
            </div>

            <div className="mt-6 flex items-center gap-2">
              <Server className="text-muted-foreground h-3.5 w-3.5" />
              <span className="text-muted-foreground text-xs font-medium uppercase tracking-widest">
                request log
              </span>
            </div>
            <div className="border-border mt-3 max-h-44 divide-y overflow-y-auto rounded-lg border">
              {requestLog.length === 0 ? (
                <div className="text-muted-foreground p-3 text-xs">No requests yet.</div>
              ) : (
                requestLog.map((entry) => (
                  <div
                    key={entry.id}
                    className="hover:bg-subtle flex items-center gap-2 px-3 py-1.5 text-xs transition-colors"
                  >
                    <span className={cn('w-8 font-mono font-medium', statusColor(entry.status))}>
                      {entry.status}
                    </span>
                    <span className="w-14 font-mono">{entry.method}</span>
                    <span className="text-muted-foreground min-w-0 flex-1 truncate font-mono">
                      {entry.path}
                    </span>
                    <span className="text-muted-foreground font-mono">{fmtMs(entry.latencyMs)}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export { SAMPLES };
