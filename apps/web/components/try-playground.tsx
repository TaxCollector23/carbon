'use client';

import { useMemo, useState } from 'react';
import { Camera, Check, ChevronDown, Play, RotateCcw, Server, Trash2, Undo2 } from 'lucide-react';
import { cn } from '@carbon/ui';
import {
  createInitialState,
  executeRequest,
  restoreSnapshot,
  takeSnapshot,
  type Method,
  type ReplicaResponse,
  type ReplicaState,
} from '@/lib/try-replica';

type HistoryEntry = {
  id: number;
  method: Method;
  path: string;
  status: number;
  response: unknown;
  durationMs: number;
};

const EXAMPLES: ReadonlyArray<{ method: Method; path: string; label: string; body?: string }> = [
  { method: 'GET', path: '/pets', label: 'List pets' },
  {
    method: 'POST',
    path: '/pets',
    label: 'Create a pet',
    body: '{\n  "name": "Mochi",\n  "status": "available"\n}',
  },
  { method: 'GET', path: '/pets/{id}', label: 'Read one pet' },
  { method: 'DELETE', path: '/pets/{id}', label: 'Delete a pet' },
];

function responseError(response: ReplicaResponse): string | null {
  const body = response.body as { error?: unknown };
  return typeof body.error === 'string' ? body.error : null;
}

export function TryPlayground() {
  const [state, setState] = useState<ReplicaState>(createInitialState);
  const [method, setMethod] = useState<Method>('GET');
  const [path, setPath] = useState('/pets');
  const [body, setBody] = useState('');
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [lastResponse, setLastResponse] = useState<HistoryEntry | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedExample = useMemo(
    () => EXAMPLES.find((example) => example.method === method && example.path === path),
    [method, path],
  );

  function chooseExample(example: (typeof EXAMPLES)[number]) {
    setMethod(example.method);
    setPath(example.path);
    setBody(example.body ?? '');
    setError(null);
  }

  function dispatch() {
    const started = performance.now();
    setError(null);

    const { state: next, response } = executeRequest(state, { method, path, body });
    setState(next);

    const entry: HistoryEntry = {
      id: Date.now(),
      method,
      path,
      status: response.status,
      response: response.body,
      durationMs: Math.max(1, Math.round(performance.now() - started)),
    };
    setLastResponse(entry);
    setHistory((entries) => [entry, ...entries].slice(0, 8));
    if (response.status >= 400) setError(responseError(response) ?? 'Request failed');
  }

  function snapshot() {
    setState(takeSnapshot(state));
    setError(null);
  }

  function restore() {
    setState(restoreSnapshot(state));
    setError(state.snapshot === null ? 'Take a snapshot first, then mutate the store.' : null);
  }

  function reset() {
    setState(createInitialState());
    setHistory([]);
    setLastResponse(null);
    setError(null);
  }

  const hasSnapshot = state.snapshot !== null;

  return (
    <div className="border-border grid overflow-hidden rounded-xl border lg:grid-cols-[0.9fr_1.1fr]">
      <aside className="bg-subtle border-border border-b p-5 sm:p-7 lg:border-b-0 lg:border-r">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-muted-foreground flex items-center gap-2 text-xs font-medium uppercase tracking-widest">
              <Server className="h-3.5 w-3.5" />
              local sandbox
            </div>
            <h2 className="mt-2 text-xl font-medium">Petstore replica</h2>
          </div>
          <button
            type="button"
            onClick={reset}
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs transition-colors"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset
          </button>
        </div>
        <p className="text-muted-foreground mt-3 text-sm leading-6">
          This is a safe browser-only replica. Mutations are real to this session, but nothing is
          sent to a third party or saved to an account.
        </p>

        <div className="mt-7 space-y-2">
          <label className="text-muted-foreground text-xs font-medium uppercase tracking-wider">
            Example request
          </label>
          <div className="relative">
            <select
              aria-label="Example request"
              value={selectedExample ? `${selectedExample.method} ${selectedExample.path}` : ''}
              onChange={(event) => {
                const example = EXAMPLES.find(
                  (item) => `${item.method} ${item.path}` === event.target.value,
                );
                if (example) chooseExample(example);
              }}
              className="bg-background border-input text-foreground w-full appearance-none rounded-md border px-3 py-2.5 pr-9 font-mono text-sm"
            >
              <option value="">Custom route</option>
              {EXAMPLES.map((example) => (
                <option
                  key={`${example.method}-${example.path}`}
                  value={`${example.method} ${example.path}`}
                >
                  {example.label} · {example.method} {example.path}
                </option>
              ))}
            </select>
            <ChevronDown className="text-muted-foreground pointer-events-none absolute right-3 top-3 h-4 w-4" />
          </div>
        </div>

        <div className="mt-5 grid grid-cols-[auto_1fr] gap-2">
          <select
            aria-label="HTTP method"
            value={method}
            onChange={(event) => setMethod(event.target.value as Method)}
            className="bg-background border-input text-foreground rounded-md border px-3 py-2.5 font-mono text-sm"
          >
            <option>GET</option>
            <option>POST</option>
            <option>DELETE</option>
          </select>
          <input
            aria-label="Request path"
            value={path}
            onChange={(event) => setPath(event.target.value)}
            className="bg-background border-input text-foreground min-w-0 rounded-md border px-3 py-2.5 font-mono text-sm"
          />
        </div>

        {method === 'POST' && (
          <textarea
            aria-label="JSON request body"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={5}
            spellCheck={false}
            className="bg-background border-input text-foreground mt-2 w-full resize-y rounded-md border px-3 py-2.5 font-mono text-xs leading-5"
            placeholder={'{\n  "name": "Mochi"\n}'}
          />
        )}

        <button
          type="button"
          onClick={dispatch}
          className="bg-foreground text-background mt-3 inline-flex w-full items-center justify-center gap-2 rounded-md px-4 py-2.5 text-sm font-medium transition-opacity hover:opacity-90"
        >
          <Play className="h-4 w-4 fill-current" />
          Send request
        </button>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={snapshot}
            className="border-input text-foreground hover:bg-muted inline-flex items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-xs font-medium transition-colors"
          >
            <Camera className="h-3.5 w-3.5" />
            Snapshot
          </button>
          <button
            type="button"
            onClick={restore}
            disabled={!hasSnapshot}
            className="border-input text-foreground hover:bg-muted inline-flex items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Undo2 className="h-3.5 w-3.5" />
            Restore
          </button>
        </div>

        {error && <p className="text-destructive mt-3 text-xs leading-5">{error}</p>}

        <div className="border-border mt-8 border-t pt-5">
          <div className="text-muted-foreground mb-3 flex items-center justify-between text-xs font-medium uppercase tracking-widest">
            <span>
              State · {state.pets.length} pet{state.pets.length === 1 ? '' : 's'}
            </span>
            {hasSnapshot && (
              <span className="text-emerald-600 dark:text-emerald-400">
                snapshot · {state.snapshot!.length}
              </span>
            )}
          </div>
          <div className="space-y-2">
            {state.pets.map((pet) => (
              <div
                key={pet.id}
                className="bg-background flex items-center justify-between rounded-md border px-3 py-2 text-xs"
              >
                <span className="font-mono">{pet.id}</span>
                <span className="text-muted-foreground">{pet.name}</span>
              </div>
            ))}
          </div>
        </div>
      </aside>

      <section className="min-h-[520px] p-5 sm:p-7">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-muted-foreground text-xs font-medium uppercase tracking-widest">
              response
            </div>
            <h2 className="mt-2 text-xl font-medium">State changes are visible</h2>
          </div>
          {lastResponse && (
            <div
              className={cn(
                'font-mono text-sm',
                lastResponse.status >= 400
                  ? 'text-destructive'
                  : 'text-emerald-600 dark:text-emerald-400',
              )}
            >
              {lastResponse.status} · {lastResponse.durationMs} ms
            </div>
          )}
        </div>

        <div className="bg-subtle mt-6 min-h-44 rounded-lg border p-4">
          {lastResponse ? (
            <pre className="text-foreground overflow-x-auto whitespace-pre-wrap font-mono text-xs leading-6">
              {JSON.stringify(lastResponse.response, null, 2)}
            </pre>
          ) : (
            <div className="text-muted-foreground flex min-h-36 items-center justify-center text-center text-sm">
              Choose an example and send it. Start with POST /pets, then GET /pets.
            </div>
          )}
        </div>

        <div className="mt-8 flex items-center justify-between">
          <div className="text-muted-foreground text-xs font-medium uppercase tracking-widest">
            request history
          </div>
          {history.length > 0 && (
            <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          )}
        </div>
        <div className="mt-3 divide-y rounded-lg border">
          {history.length === 0 ? (
            <div className="text-muted-foreground p-4 text-sm">No requests yet.</div>
          ) : (
            history.map((entry) => (
              <button
                type="button"
                key={entry.id}
                onClick={() => setLastResponse(entry)}
                className="hover:bg-subtle flex w-full items-center gap-3 p-3 text-left text-xs transition-colors"
              >
                <span
                  className={cn(
                    'w-14 font-mono font-medium',
                    entry.status >= 400
                      ? 'text-destructive'
                      : 'text-emerald-600 dark:text-emerald-400',
                  )}
                >
                  {entry.status}
                </span>
                <span className="w-14 font-mono">{entry.method}</span>
                <span className="text-muted-foreground min-w-0 flex-1 truncate font-mono">
                  {entry.path}
                </span>
                {entry.method === 'DELETE' && (
                  <Trash2 className="text-muted-foreground h-3.5 w-3.5" />
                )}
                <span className="text-muted-foreground font-mono">{entry.durationMs}ms</span>
              </button>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
