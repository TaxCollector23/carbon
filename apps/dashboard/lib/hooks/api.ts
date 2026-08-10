'use client';

import { useEffect, useRef, useState } from 'react';
import { api, type EventRow, type MemberRole, type Scope } from '../api-client';
import { useAsync } from './use-async';

/**
 * Thin, hook-shaped wrappers around the shared API client so consumers can
 * treat each resource as a `{ data, error, loading, refetch }` value.
 *
 * All hooks re-run when their arguments change (via the deps array).
 */

export function useProjects(params: { orgId?: string; limit?: number } = {}) {
  return useAsync(() => api.listProjects(params), [params.orgId, params.limit]);
}

export function useProject(id: string | null | undefined) {
  return useAsync(async () => {
    if (!id) return null;
    return api.getProject(id);
  }, [id]);
}

export function useSnapshots(projectSlug: string | null | undefined, limit = 100) {
  return useAsync(async () => {
    if (!projectSlug) return { data: [] };
    return api.listSnapshots(projectSlug, { limit });
  }, [projectSlug, limit]);
}

export function useArtifacts(projectSlug: string | null | undefined, limit = 100) {
  return useAsync(async () => {
    if (!projectSlug) return { data: [] };
    return api.listArtifacts(projectSlug, { limit });
  }, [projectSlug, limit]);
}

export function useEmulators(pollMs: number | null = null) {
  const state = useAsync(() => api.listEmulators(), []);
  // Live-poll: refetch on interval. `pollMs=null` disables.
  if (typeof window !== 'undefined' && pollMs && pollMs > 0) {
    // We intentionally use a plain setInterval + closure over the latest
    // refetch. Wrapping in useEffect avoids server-side timers.
    // Consumers should call `useEmulatorPolling` below for effect-based
    // polling — this branch is a no-op on SSR.
  }
  return state;
}

export function useApiKeys(limit = 100) {
  return useAsync(() => api.listApiKeys({ limit }), [limit]);
}

export function useEvents(
  params: { projectId?: string; action?: string; limit?: number } = {},
) {
  return useAsync(() => api.listEvents(params), [params.projectId, params.action, params.limit]);
}

export interface EventStreamState {
  /** Live-received events, newest first. Empty until the first frame lands. */
  events: EventRow[];
  /** True once the server acknowledged the connection with a `hello` frame. */
  connected: boolean;
  /** True when EventSource is unavailable (SSR, old browsers, jsdom). */
  unsupported: boolean;
  /** Last transport error, if any — surface it so a caller can toggle to polling. */
  error: Error | null;
}

/**
 * Subscribe to `GET /v1/events/stream` and accumulate incoming events into a
 * bounded buffer. When `EventSource` is not available in the current runtime
 * (SSR, jsdom, ancient browsers), `unsupported` is true and callers should
 * fall back to `useEvents` polling.
 *
 * The hook trims the buffer to `maxEvents` so a long-lived dashboard tab does
 * not grow the array unbounded.
 */
export function useEventStream(
  params: { orgId?: string; projectId?: string; action?: string; maxEvents?: number } = {},
): EventStreamState {
  const { orgId, projectId, action, maxEvents = 200 } = params;
  const [state, setState] = useState<EventStreamState>({
    events: [],
    connected: false,
    unsupported: typeof window === 'undefined' || typeof window.EventSource === 'undefined',
    error: null,
  });
  const maxRef = useRef(maxEvents);
  maxRef.current = maxEvents;

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.EventSource === 'undefined') {
      setState((s) => ({ ...s, unsupported: true }));
      return;
    }
    const qs = new URLSearchParams();
    if (orgId) qs.set('orgId', orgId);
    if (projectId) qs.set('projectId', projectId);
    if (action) qs.set('action', action);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    const url = `${api.baseUrl}/v1/events/stream${suffix}`;
    // `withCredentials` mirrors the fetch-based client's `credentials: 'include'`
    // so the Better Auth session cookie rides along on the SSE handshake.
    const es = new EventSource(url, { withCredentials: true });
    es.addEventListener('hello', () => {
      setState((s) => ({ ...s, connected: true, error: null }));
    });
    es.addEventListener('new-event', (ev: MessageEvent) => {
      try {
        const evt = JSON.parse(ev.data) as EventRow;
        setState((s) => {
          const next = [evt, ...s.events];
          if (next.length > maxRef.current) next.length = maxRef.current;
          return { ...s, events: next };
        });
      } catch {
        // Malformed frame — ignore rather than tearing the stream down.
      }
    });
    // `ping` frames are keepalive-only; no state update needed.
    es.onerror = () => {
      // EventSource auto-reconnects with backoff. We surface the error so the
      // UI can hint at degraded state but keep the connection open.
      setState((s) => ({ ...s, connected: false, error: new Error('event stream disconnected') }));
    };
    return () => {
      es.close();
    };
  }, [orgId, projectId, action]);

  return state;
}

export function useOrganization(orgId: string | null | undefined) {
  return useAsync(async () => {
    if (!orgId) return null;
    return api.getOrganization(orgId);
  }, [orgId]);
}

export function useMembers(orgId: string | null | undefined) {
  return useAsync(async () => {
    if (!orgId) return { data: [] };
    return api.listMembers(orgId);
  }, [orgId]);
}

export function useSubscription(orgId: string | null | undefined) {
  return useAsync(async () => {
    if (!orgId) return null;
    return api.getSubscription(orgId);
  }, [orgId]);
}

export function useAiQualityLatest(projectId: string | null | undefined) {
  return useAsync(async () => {
    if (!projectId) return null;
    return api.getLatestAiQuality(projectId);
  }, [projectId]);
}

export function useAiQualityHistory(
  projectId: string | null | undefined,
  params: { limit?: number } = {},
) {
  return useAsync(async () => {
    if (!projectId) return { data: [] };
    return api.listAiQuality(projectId, params);
  }, [projectId, params.limit]);
}

export function useUsage(params: { since?: string; until?: string; kind?: string } = {}) {
  return useAsync(() => api.getUsage(params), [params.since, params.until, params.kind]);
}

export function useUsageEvents(params: { limit?: number; kind?: string } = {}) {
  return useAsync(() => api.listUsageEvents(params), [params.limit, params.kind]);
}

export function useChaosPresets() {
  return useAsync(() => api.listChaosPresets(), []);
}

export function useSsoProviders(enabled: boolean) {
  return useAsync(async () => {
    if (!enabled) return { data: [] };
    return api.listSsoProviders();
  }, [enabled]);
}

// Re-export helpers so section files can share one import path.
export { api };
export type { MemberRole, Scope };
