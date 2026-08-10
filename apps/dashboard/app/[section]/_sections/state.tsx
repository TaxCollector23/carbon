'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { EmptyState, ErrorBanner, Skeleton } from '@/components/ui';
import { api } from '@/lib/hooks/api';
import { useAsync } from '@/lib/hooks/use-async';
import { getSectionCopy } from '@/lib/empty-data';
import type { EmulatorRecord } from '@/lib/api-client';

/**
 * "State" as a section is really the union of every running emulator's
 * in-memory records. When one emulator is selected we open a WebSocket to
 * `/__carbon/state/stream` and render a live-updating mutation timeline.
 * If the WS is unavailable (proxy, mixed-content, older runtime) we fall
 * back to polling `/__carbon/state/history` every 3s.
 */
export default function StateSection() {
  const emulators = useAsync(() => api.listEmulators(), []);
  const copy = getSectionCopy('state')!;
  const [selected, setSelected] = useState<string | null>(null);

  if (emulators.loading)
    return (
      <div className="space-y-2">
        <Skeleton className="h-10" />
        <Skeleton className="h-10" />
      </div>
    );
  if (emulators.error) return <ErrorBanner error={emulators.error} onRetry={emulators.refetch} />;

  const rows = emulators.data?.data ?? [];
  if (rows.length === 0) {
    return <EmptyState title={copy.emptyTitle} description={copy.description} />;
  }

  const active = rows.find((r) => r.id === selected) ?? rows[0]!;

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm">
        Live mutation timeline for the selected emulator. Falls back to polling on disconnect.
      </p>
      <ul className="border-border divide-border rounded-md border text-sm">
        {rows.map((e) => (
          <li key={e.id} className="flex items-center justify-between px-4 py-2.5">
            <button
              type="button"
              onClick={() => setSelected(e.id)}
              className={`font-mono text-xs ${e.id === active.id ? 'text-foreground' : 'text-muted-foreground'}`}
            >
              {e.id}
            </button>
            <span className="text-muted-foreground text-xs">{e.projectSlug}</span>
          </li>
        ))}
      </ul>
      <StateStream emulator={active} />
    </div>
  );
}

interface StreamEntry {
  seq: number;
  at: number;
  op: 'create' | 'update' | 'replace' | 'delete';
  resource: string;
  id: string;
}

function runtimeUrlOf(emulator: EmulatorRecord): string | null {
  if (typeof emulator.url === 'string' && emulator.url) return emulator.url.replace(/\/+$/, '');
  if (emulator.host && emulator.port) {
    const host = emulator.host === '0.0.0.0' ? 'localhost' : emulator.host;
    return `http://${host}:${emulator.port}`;
  }
  return null;
}

function StateStream({ emulator }: { emulator: EmulatorRecord }) {
  const runtime = useMemo(() => runtimeUrlOf(emulator), [emulator]);
  const [entries, setEntries] = useState<StreamEntry[]>([]);
  const [status, setStatus] = useState<'connecting' | 'live' | 'polling' | 'error'>('connecting');
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    setEntries([]);
    if (!runtime) {
      setStatus('error');
      return;
    }
    if (typeof window === 'undefined' || typeof window.WebSocket === 'undefined') {
      // No WS in this environment — poll instead.
      return startPolling(runtime, setEntries, setStatus);
    }
    const wsUrl = runtime.replace(/^http/, 'ws') + '/__carbon/state/stream';
    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl);
    } catch {
      return startPolling(runtime, setEntries, setStatus);
    }
    wsRef.current = ws;

    let fellBack = false;
    const fallback = (): (() => void) | undefined => {
      if (fellBack) return;
      fellBack = true;
      return startPolling(runtime, setEntries, setStatus);
    };

    ws.onopen = () => setStatus('live');
    ws.onmessage = (ev) => {
      try {
        const frame = JSON.parse(ev.data) as
          | { type: 'snapshot'; entries: StreamEntry[] }
          | { type: 'mutation'; entry: StreamEntry }
          | { type: 'ping' };
        if (frame.type === 'snapshot') {
          setEntries(frame.entries.slice(-200));
        } else if (frame.type === 'mutation') {
          setEntries((prev) => [...prev.slice(-199), frame.entry]);
        }
      } catch {
        // ignore malformed frames
      }
    };
    let stopPolling: (() => void) | undefined;
    ws.onerror = () => {
      setStatus('error');
      stopPolling = fallback();
    };
    ws.onclose = () => {
      if (status !== 'error') setStatus('polling');
      stopPolling = fallback();
    };

    return () => {
      wsRef.current = null;
      try {
        ws.close();
      } catch {
        /* noop */
      }
      stopPolling?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runtime]);

  return (
    <div className="border-border rounded-md border">
      <div className="border-border flex items-center justify-between border-b px-4 py-2 text-xs">
        <span className="font-mono">{runtime ?? '(no runtime url)'}</span>
        <span className="text-muted-foreground">{status}</span>
      </div>
      {entries.length === 0 ? (
        <p className="text-muted-foreground px-4 py-6 text-sm">
          Waiting for mutations. Hit an endpoint on this emulator and watch it land here.
        </p>
      ) : (
        <ul className="divide-border divide-y text-xs">
          {entries
            .slice()
            .reverse()
            .map((entry) => (
              <li key={entry.seq} className="flex items-center gap-3 px-4 py-2 font-mono">
                <span className="text-muted-foreground w-24">
                  {new Date(entry.at).toISOString().slice(11, 19)}
                </span>
                <span className="text-muted-foreground w-10">#{entry.seq}</span>
                <span className="w-16 uppercase">{entry.op}</span>
                <span className="flex-1">{entry.resource}</span>
                <span className="text-muted-foreground truncate">{entry.id}</span>
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}

function startPolling(
  runtime: string,
  setEntries: (fn: (prev: StreamEntry[]) => StreamEntry[]) => void,
  setStatus: (s: 'connecting' | 'live' | 'polling' | 'error') => void,
): () => void {
  setStatus('polling');
  let cancelled = false;
  const tick = async (): Promise<void> => {
    try {
      const res = await fetch(`${runtime}/__carbon/state/history`);
      if (!res.ok) throw new Error(`history responded ${res.status}`);
      const body = (await res.json()) as { entries: StreamEntry[] };
      if (cancelled) return;
      setEntries(() => body.entries.slice(-200));
    } catch {
      if (!cancelled) setStatus('error');
    }
  };
  void tick();
  const id = window.setInterval(() => void tick(), 3000);
  return () => {
    cancelled = true;
    window.clearInterval(id);
  };
}
