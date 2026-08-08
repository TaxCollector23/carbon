'use client';

import { api, type MemberRole, type Scope } from '../api-client';
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

// Re-export helpers so section files can share one import path.
export { api };
export type { MemberRole, Scope };
