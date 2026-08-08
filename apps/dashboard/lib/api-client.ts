/**
 * Typed browser client for the Carbon control-plane API (`apps/api`).
 *
 * Every method forwards the browser session cookie (Better Auth) via
 * `credentials: 'include'`, and — when the user has stored a CLI-style API
 * key under `localStorage['carbon.apiKey']` — also sends it as
 * `Authorization: Bearer <key>`. Either credential is accepted by the API's
 * `api-key`/`session-auth` plugins.
 *
 * Endpoints not yet on the server (events / organizations / billing) are
 * called defensively: callers should try/catch on `ApiError` and treat a
 * 404/501 as "feature not deployed yet".
 */

export type Scope = 'read' | 'write' | 'admin';

export interface ApiErrorPayload {
  status: number;
  code: string;
  message: string;
  details?: unknown;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;
  constructor(payload: ApiErrorPayload) {
    super(payload.message);
    this.name = 'ApiError';
    this.status = payload.status;
    this.code = payload.code;
    this.details = payload.details;
  }
}

// -----------------------------------------------------------------------------
// Shapes returned by apps/api. Kept intentionally loose (all fields typed
// against the on-the-wire response); we treat unknown extras as forward
// compat.
// -----------------------------------------------------------------------------

export interface Project {
  id: string;
  orgId: string;
  slug: string;
  name: string;
  createdAt?: string | number | null;
}

export interface ListResponse<T> {
  data: T[];
  nextCursor?: string | null;
  hasMore?: boolean;
  total?: number | null;
  limit?: number;
  truncated?: boolean;
}

export interface SnapshotSummary {
  name: string;
  size: number;
  modifiedAt: number;
}

export interface ArtifactSummary {
  kind: 'ir' | 'graph';
  id: string;
  size: number;
  modifiedAt: number;
}

export interface EmulatorRecord {
  id: string;
  projectSlug: string;
  host: string;
  port: number;
  status?: string;
  url?: string;
  startedAt?: number | string;
  [key: string]: unknown;
}

export interface ApiKeyRow {
  id: string;
  orgId: string;
  name: string;
  prefix: string;
  scopes: Scope[];
  projectIds: string[] | null;
  lastUsedAt: string | null;
  createdAt: string;
  expiresAt: string | null;
  rotatedFromId: string | null;
}

export interface CreatedApiKey {
  id: string;
  secret: string;
  prefix: string;
  scopes: Scope[];
  projectIds: string[] | null;
  expiresAt: string | null;
}

export type EventActorType = 'user' | 'api_key' | 'system';

export interface EventRow {
  id: string;
  orgId: string;
  projectId: string | null;
  actorType: EventActorType;
  actorId: string | null;
  action: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export type MemberRole = 'owner' | 'admin' | 'member';

export interface Organization {
  id: string;
  slug: string;
  name: string;
  createdAt?: string;
}

export interface Membership {
  userId: string;
  orgId: string;
  role: MemberRole;
  email?: string;
  name?: string | null;
  createdAt?: string;
}

export interface Subscription {
  orgId: string;
  plan: 'developer' | 'team' | 'enterprise';
  status: 'active' | 'trialing' | 'past_due' | 'canceled' | 'incomplete' | 'unpaid';
  seats: number;
  currentPeriodEnd: string | null;
}

// -----------------------------------------------------------------------------

export type SessionTokenGetter = () => string | null | undefined | Promise<string | null | undefined>;

export interface ApiClientOptions {
  baseUrl?: string;
  getSessionToken?: SessionTokenGetter;
}

const DEFAULT_BASE_URL =
  (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_CARBON_API_URL) ||
  'http://localhost:3000';

const API_KEY_STORAGE_KEY = 'carbon.apiKey';

function readStoredApiKey(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(API_KEY_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function createApiClient(options: ApiClientOptions = {}) {
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');

  async function request<T>(
    method: string,
    path: string,
    body?: unknown,
    init?: RequestInit,
  ): Promise<T> {
    const headers = new Headers(init?.headers);
    headers.set('accept', 'application/json');
    if (body !== undefined && !(body instanceof FormData)) {
      headers.set('content-type', 'application/json');
    }
    const apiKey = readStoredApiKey();
    if (apiKey) headers.set('authorization', `Bearer ${apiKey}`);
    if (options.getSessionToken) {
      const token = await options.getSessionToken();
      if (token && !headers.has('authorization')) {
        headers.set('authorization', `Bearer ${token}`);
      }
    }

    let response: Response;
    try {
      response = await fetch(`${baseUrl}${path}`, {
        method,
        credentials: 'include',
        headers,
        body:
          body === undefined
            ? undefined
            : body instanceof FormData
              ? body
              : JSON.stringify(body),
        ...init,
      });
    } catch (err) {
      throw new ApiError({
        status: 0,
        code: 'CARBON_NETWORK',
        message: err instanceof Error ? err.message : 'network error',
      });
    }

    if (response.status === 204) return undefined as T;

    const text = await response.text();
    let json: unknown = null;
    if (text.length > 0) {
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
    }

    if (!response.ok) {
      const errObj = (json && typeof json === 'object' && 'error' in json ? (json as { error: unknown }).error : json) as
        | { code?: string; message?: string; details?: unknown }
        | null;
      throw new ApiError({
        status: response.status,
        code: errObj?.code ?? `HTTP_${response.status}`,
        message: errObj?.message ?? response.statusText ?? 'request failed',
        details: errObj?.details,
      });
    }
    return json as T;
  }

  return {
    baseUrl,

    // ------------------------------- projects -------------------------------
    listProjects(params: { limit?: number; orgId?: string; includeTotal?: boolean } = {}) {
      const q = toQuery(params);
      return request<ListResponse<Project>>('GET', `/v1/projects${q}`);
    },
    createProject(body: { slug: string; name: string; orgId?: string }) {
      return request<Project>('POST', '/v1/projects', body);
    },
    getProject(id: string) {
      return request<Project>('GET', `/v1/projects/${encodeURIComponent(id)}`);
    },

    // ------------------------------- snapshots ------------------------------
    listSnapshots(projectSlug: string, params: { limit?: number } = {}) {
      const q = toQuery(params);
      return request<ListResponse<SnapshotSummary>>(
        'GET',
        `/v1/projects/${encodeURIComponent(projectSlug)}/snapshots${q}`,
      );
    },
    deleteSnapshot(projectSlug: string, name: string) {
      return request<void>(
        'DELETE',
        `/v1/projects/${encodeURIComponent(projectSlug)}/snapshots/${encodeURIComponent(name)}`,
      );
    },

    // ------------------------------- artifacts ------------------------------
    listArtifacts(projectSlug: string, params: { limit?: number } = {}) {
      const q = toQuery(params);
      return request<ListResponse<ArtifactSummary>>(
        'GET',
        `/v1/projects/${encodeURIComponent(projectSlug)}/artifacts${q}`,
      );
    },

    // ------------------------------- emulators ------------------------------
    listEmulators() {
      return request<{ data: EmulatorRecord[] }>('GET', '/v1/emulators');
    },
    startEmulator(body: { projectSlug: string; irId: string; port?: number; host?: string; snapshot?: string }) {
      return request<EmulatorRecord>('POST', '/v1/emulators', body);
    },
    stopEmulator(id: string) {
      return request<void>('DELETE', `/v1/emulators/${encodeURIComponent(id)}`);
    },

    // ------------------------------- api keys -------------------------------
    listApiKeys(params: { limit?: number } = {}) {
      const q = toQuery(params);
      return request<ListResponse<ApiKeyRow>>('GET', `/v1/api-keys${q}`);
    },
    createApiKey(body: {
      orgId?: string;
      name: string;
      scopes: Scope[];
      projectIds?: string[] | null;
      expiresInSeconds?: number;
    }) {
      return request<CreatedApiKey>('POST', '/v1/api-keys', body);
    },
    revokeApiKey(id: string) {
      return request<void>('DELETE', `/v1/api-keys/${encodeURIComponent(id)}`);
    },

    // ------------------------------- events ---------------------------------
    listEvents(params: { limit?: number; projectId?: string; action?: string; cursor?: string } = {}) {
      const q = toQuery(params);
      return request<ListResponse<EventRow>>('GET', `/v1/events${q}`);
    },

    // ---------------------------- organizations -----------------------------
    getOrganization(id: string) {
      return request<Organization>('GET', `/v1/organizations/${encodeURIComponent(id)}`);
    },
    updateOrganization(id: string, body: { name?: string; slug?: string }) {
      return request<Organization>('PATCH', `/v1/organizations/${encodeURIComponent(id)}`, body);
    },
    getCurrentOrganization() {
      return request<Organization>('GET', '/v1/organizations/current');
    },
    listMembers(orgId: string) {
      return request<ListResponse<Membership>>(
        'GET',
        `/v1/organizations/${encodeURIComponent(orgId)}/members`,
      );
    },
    inviteMember(orgId: string, body: { email: string; role: MemberRole }) {
      return request<Membership>(
        'POST',
        `/v1/organizations/${encodeURIComponent(orgId)}/members`,
        body,
      );
    },
    changeMemberRole(orgId: string, userId: string, body: { role: MemberRole }) {
      return request<Membership>(
        'PATCH',
        `/v1/organizations/${encodeURIComponent(orgId)}/members/${encodeURIComponent(userId)}`,
        body,
      );
    },
    removeMember(orgId: string, userId: string) {
      return request<void>(
        'DELETE',
        `/v1/organizations/${encodeURIComponent(orgId)}/members/${encodeURIComponent(userId)}`,
      );
    },

    // -------------------------------- billing -------------------------------
    getSubscription(orgId: string) {
      return request<Subscription>(
        'GET',
        `/v1/billing/subscription?orgId=${encodeURIComponent(orgId)}`,
      );
    },
    createCheckout(body: { orgId: string; plan: 'team' | 'enterprise'; seats: number }) {
      return request<{ url: string }>('POST', '/v1/billing/checkout', body);
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;

function toQuery(params: Record<string, unknown>): string {
  const pairs: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    pairs.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return pairs.length ? `?${pairs.join('&')}` : '';
}

// Shared, module-level client for simple call sites. Consumers that need
// a custom baseUrl or a specific session token should call
// `createApiClient(...)` themselves.
export const api = createApiClient();

export const ApiKeyStorage = {
  key: API_KEY_STORAGE_KEY,
  get: readStoredApiKey,
  set(value: string) {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(API_KEY_STORAGE_KEY, value);
    } catch {
      /* ignore */
    }
  },
  clear() {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.removeItem(API_KEY_STORAGE_KEY);
    } catch {
      /* ignore */
    }
  },
};
