import { ui } from '../ui.js';

/**
 * Free-tier ingest cap. The paywall lives here (in the CLI, at the exact
 * moment of friction) rather than only on the marketing site — paywalls at
 * the point of friction convert far better than paywalls the user has to
 * hunt for.
 *
 * Behavior: opportunistically queries `/v1/usage` for the caller's
 * `ai_ingest` count in the last 30 days. If we're at or past the cap AND
 * the caller is on the developer tier, we print a friendly upsell and
 * return `{ blocked: true }` so the calling command can bail out with an
 * exit code the user can act on. If usage can't be fetched (offline, no
 * key, older API), we deliberately fail *open* — a paywall that breaks the
 * CLI when the control plane is down would be catastrophic to trust.
 */

export const FREE_TIER_INGEST_CAP = 10;
export const FREE_TIER_INGEST_WINDOW_DAYS = 30;

export interface QuotaCheckOptions {
  readonly apiUrl: string;
  readonly apiKey: string;
  /** Overridable in tests. Defaults to global fetch. */
  readonly fetchImpl?: typeof fetch;
  /** Overridable in tests. Defaults to `Date.now()`. */
  readonly now?: () => number;
}

export interface QuotaCheckResult {
  readonly blocked: boolean;
  readonly used: number;
  readonly cap: number;
  readonly plan: string;
  /** True when we couldn't determine usage — caller should proceed. */
  readonly softFailed?: boolean;
}

interface UsageResponse {
  totals?: Array<{ kind: string; total: number }>;
}

interface VersionResponse {
  plans?: string[];
}

interface MeResponse {
  plan?: string;
  organization?: { plan?: string };
}

/** Kinds that count toward the free-tier AI ingest cap. */
const INGEST_KINDS = new Set(['ai_ingest', 'ingest']);

/**
 * Resolve the caller's plan tier. Uses `/v1/me` when available; falls back to
 * `'developer'` if the endpoint is unauthenticated / missing. Non-developer
 * plans are exempt from the cap.
 */
async function resolvePlan(
  apiUrl: string,
  apiKey: string,
  fetchImpl: typeof fetch,
): Promise<string> {
  try {
    const res = await fetchImpl(`${apiUrl}/v1/me`, {
      headers: { 'x-carbon-key': apiKey },
    });
    if (!res.ok) return 'developer';
    const body = (await res.json().catch(() => null)) as MeResponse | null;
    return body?.plan ?? body?.organization?.plan ?? 'developer';
  } catch {
    return 'developer';
  }
}

async function fetchIngestCount(
  apiUrl: string,
  apiKey: string,
  fetchImpl: typeof fetch,
  windowDays: number,
): Promise<number | null> {
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();
  try {
    const url = `${apiUrl}/v1/usage?since=${encodeURIComponent(since)}`;
    const res = await fetchImpl(url, { headers: { 'x-carbon-key': apiKey } });
    if (!res.ok) return null;
    const body = (await res.json().catch(() => null)) as UsageResponse | null;
    if (!body?.totals) return null;
    return body.totals
      .filter((t) => INGEST_KINDS.has(t.kind))
      .reduce((sum, t) => sum + (Number(t.total) || 0), 0);
  } catch {
    return null;
  }
}

/**
 * Non-blocking usage check. Returns `blocked: true` only when the caller is
 * on the developer plan AND the /v1/usage response says they're at or past
 * the cap. On any error, returns `blocked: false, softFailed: true`.
 */
export async function checkIngestQuota(opts: QuotaCheckOptions): Promise<QuotaCheckResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const cap = FREE_TIER_INGEST_CAP;

  const plan = await resolvePlan(opts.apiUrl, opts.apiKey, fetchImpl);
  if (plan !== 'developer') {
    return { blocked: false, used: 0, cap, plan };
  }

  const used = await fetchIngestCount(
    opts.apiUrl,
    opts.apiKey,
    fetchImpl,
    FREE_TIER_INGEST_WINDOW_DAYS,
  );
  if (used === null) {
    return { blocked: false, used: 0, cap, plan, softFailed: true };
  }
  return { blocked: used >= cap, used, cap, plan };
}

/**
 * Print the friendly upsell. Kept out of `checkIngestQuota` so tests can
 * assert on the pure result without capturing stdout.
 */
export function printQuotaExceeded(result: QuotaCheckResult): void {
  ui.warn(
    `You have used ${result.used} of ${result.cap} free ingests in the last ${FREE_TIER_INGEST_WINDOW_DAYS} days.`,
  );
  ui.warn('The free / developer plan caps AI-assisted ingestion at 10 per month.');
  ui.warn('Upgrade to Team ($29 / dev / month) for unlimited ingests and cloud sync:');
  ui.warn('   → https://carbon-web-psi.vercel.app/#pricing');
  ui.warn('   → run `carbon login` after upgrading, then re-run this command.');
}

/**
 * First-run friendly notice, printed the first time a user runs ingest while
 * approaching the cap. Not blocking. Called from the command with the result
 * of `checkIngestQuota`.
 */
export function printQuotaAdvisory(result: QuotaCheckResult): void {
  if (result.softFailed) return;
  if (result.plan !== 'developer') return;
  if (result.used < Math.max(1, result.cap - 2)) return;
  ui.warn(
    `Heads up: ${result.used} / ${result.cap} free ingests used in the last ${FREE_TIER_INGEST_WINDOW_DAYS} days. Upgrade to Team for unlimited: https://carbon-web-psi.vercel.app/#pricing`,
  );
}
