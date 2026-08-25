/**
 * track.ts — anonymous funnel events for the marketing site.
 *
 * Fires one POST to the control plane's public `/v1/track` endpoint,
 * fire-and-forget with `keepalive` so the event survives navigation/closing
 * the tab. No-op when `NEXT_PUBLIC_CARBON_API_URL` is unset (static previews,
 * local builds without the API) — the site must work with zero tracking
 * infrastructure.
 */

const API_URL =
  (typeof process !== 'undefined' ? process.env.NEXT_PUBLIC_CARBON_API_URL : undefined) ?? '';

let enabled = true;

export function track(
  action: string,
  metadata?: Record<string, unknown>,
  path?: string,
): void {
  if (!enabled || !API_URL) return;
  const url = `${API_URL.replace(/\/+$/, '')}/v1/track`;
  const body = JSON.stringify({
    action,
    path:
      path ??
      (typeof window !== 'undefined'
        ? `${window.location.pathname}${window.location.hash}`
        : undefined),
    metadata,
  });
  try {
    void fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {
      /* tracking must never break the site */
    });
  } catch {
    /* fetch unavailable — no-op */
  }
}

/** Test hook: disable tracking for a session (e.g. screenshot tooling). */
export function _setTrackingEnabled(value: boolean): void {
  enabled = value;
}
