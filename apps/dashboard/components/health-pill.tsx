'use client';

import { useEffect, useState } from 'react';
import { api, ApiError, type HealthDeep } from '@/lib/api-client';

/**
 * Admin-only health snapshot: polls /v1/health/deep every 15s and renders a
 * coloured pill (ok / degraded / down) with per-dep latencies in the tooltip.
 * A 401/403 (non-admin dashboard session) silently renders nothing so we
 * don't nag viewers who legitimately can't see the endpoint.
 */
export function HealthPill() {
  const [state, setState] = useState<{ data: HealthDeep | null; hidden: boolean; error: string | null }>({
    data: null,
    hidden: false,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        const data = await api.getHealthDeep();
        if (!cancelled) setState({ data, hidden: false, error: null });
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
          setState({ data: null, hidden: true, error: null });
          return;
        }
        setState({ data: null, hidden: false, error: err instanceof Error ? err.message : String(err) });
      }
    }
    void tick();
    const id = window.setInterval(tick, 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  if (state.hidden) return null;

  const { data, error } = state;
  const overall: 'ok' | 'degraded' | 'down' | 'loading' | 'error' = error
    ? 'error'
    : !data
      ? 'loading'
      : overallStatus(data);

  const color =
    overall === 'ok'
      ? 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30 dark:text-emerald-400'
      : overall === 'degraded'
        ? 'bg-amber-500/15 text-amber-600 border-amber-500/30 dark:text-amber-400'
        : overall === 'down' || overall === 'error'
          ? 'bg-red-500/15 text-red-600 border-red-500/30 dark:text-red-400'
          : 'bg-muted/40 text-muted-foreground border-border';

  const label =
    overall === 'ok'
      ? 'Healthy'
      : overall === 'degraded'
        ? 'Degraded'
        : overall === 'down'
          ? 'Down'
          : overall === 'error'
            ? 'Error'
            : '…';

  const title = data
    ? Object.entries(data.dependencies)
        .filter(([, v]) => v)
        .map(([k, v]) => `${k}: ${v!.status} (${v!.latencyMs}ms)${v!.message ? ` — ${v!.message}` : ''}`)
        .join('\n')
    : error ?? 'checking…';

  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${color}`}
    >
      <span
        aria-hidden
        className={`h-1.5 w-1.5 rounded-full ${
          overall === 'ok'
            ? 'bg-emerald-500'
            : overall === 'degraded'
              ? 'bg-amber-500'
              : overall === 'down' || overall === 'error'
                ? 'bg-red-500'
                : 'bg-muted-foreground'
        }`}
      />
      {label}
    </span>
  );
}

function overallStatus(h: HealthDeep): 'ok' | 'degraded' | 'down' {
  const deps = Object.values(h.dependencies).filter((v): v is NonNullable<typeof v> => Boolean(v));
  if (deps.some((d) => d.status === 'down')) return 'down';
  if (deps.some((d) => d.status === 'slow')) return 'degraded';
  if (!h.ok) return 'degraded';
  return 'ok';
}
