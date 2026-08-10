/**
 * Shared plan definitions consumed by the pricing page and the compare-features
 * table below it. The docs site's `plans.mdx` duplicates this content (mdx
 * can't cheaply import a TS module across the workspace boundary) — if you
 * update tiers here, mirror the change into `apps/docs/plans.mdx`.
 *
 * Rationale for the axis: capability-gating a developer tool teaches users to
 * fork rather than pay. Every tier gets the full CLI + local runtime + 8
 * adapters + chaos + local snapshots. Paid tiers gate strictly on *cloud
 * collaboration, compliance, and scale* — the moment two humans need to look
 * at the same replica or a company needs to prove who did what.
 */
export type TierId = 'developer' | 'team' | 'enterprise';

export interface Tier {
  readonly id: TierId;
  readonly name: string;
  readonly price: string;
  readonly period: string;
  readonly tagline: string;
  readonly cta: { label: string; href: string };
  readonly highlighted?: boolean;
  readonly features: readonly string[];
}

/**
 * Docs URL for deep-links. Falls back to the public docs host so links still
 * resolve when someone opens the marketing site out of a preview deploy.
 */
export function docsUrl(path: string): string {
  const base =
    (process.env.NEXT_PUBLIC_DOCS_URL && process.env.NEXT_PUBLIC_DOCS_URL.replace(/\/+$/, '')) ||
    'https://docs.carbon.dev';
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${base}${p}`;
}

export function dashboardUrl(next = '/'): string {
  const base =
    (process.env.NEXT_PUBLIC_DASHBOARD_URL &&
      process.env.NEXT_PUBLIC_DASHBOARD_URL.replace(/\/+$/, '')) ||
    'http://localhost:3001';
  return `${base}/sign-up?next=${encodeURIComponent(next)}`;
}

export const TIERS: readonly Tier[] = [
  {
    id: 'developer',
    name: 'Free / Developer',
    price: '$0',
    period: 'forever, for one developer',
    tagline: 'The full CLI, every adapter, local snapshots, and chaos — free forever.',
    cta: { label: 'Install the CLI', href: '/#cli' },
    features: [
      'CLI + local runtime — unlimited',
      'All 8 adapters: OpenAPI, AsyncAPI, gRPC, protobuf, GraphQL, HAR, Postman, traffic',
      'Local snapshots (`.carbon/snapshots`) — unlimited',
      'Chaos plugins: latency + error injection',
      'AI-assisted inference — capped at 10 ingests / month',
      'Community support (GitHub issues)',
    ],
  },
  {
    id: 'team',
    name: 'Pro / Team',
    price: '$29',
    period: 'per developer / month',
    tagline: 'Cloud sync, dashboard, drift detection — the moment two humans need to share state.',
    cta: { label: 'Start a team trial', href: dashboardUrl('/onboarding') },
    highlighted: true,
    features: [
      'Everything in Free',
      'Cloud-hosted project & snapshot sync (`carbon snapshot push/pull`)',
      'Team dashboard: projects, runs, activity, member roles',
      'AI-assisted inference — unlimited, best-available model',
      'Drift detection against the real upstream API',
      'Audit log — 30-day view',
      '90-day snapshot / event retention',
      'Email support (business hours)',
    ],
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    price: 'Contact sales',
    period: 'starts at $30k / year',
    tagline: 'SSO, SCIM, self-host, audit export, and unlimited retention for regulated teams.',
    cta: { label: 'Talk to us', href: '/contact' },
    features: [
      'Everything in Team',
      'SSO (SAML, OIDC) and SCIM provisioning',
      'Full audit log + SIEM webhook + compliance export',
      'Configurable / unlimited retention',
      'Self-hosted control plane',
      'Bring-your-own LLM key for AI inference',
      'AI-quality report artifact for compliance sign-off',
      'Dedicated Slack + SLA',
    ],
  },
];

/**
 * Row-by-row feature comparison rendered under the tier cards. Each row is
 * deep-linked to the docs concept that explains what the capability actually
 * does — so a buyer can drill into "what is drift detection" without leaving
 * the funnel.
 */
export interface CompareRow {
  readonly label: string;
  readonly href?: string;
  readonly developer: string;
  readonly team: string;
  readonly enterprise: string;
}

export const COMPARE_ROWS: readonly CompareRow[] = [
  {
    label: 'CLI + local runtime, all 8 adapters',
    href: docsUrl('/concepts/spec-to-runtime'),
    developer: 'Unlimited',
    team: 'Unlimited',
    enterprise: 'Unlimited',
  },
  {
    label: 'Local JSON snapshots',
    href: docsUrl('/concepts/state-engine'),
    developer: 'Unlimited',
    team: 'Unlimited',
    enterprise: 'Unlimited',
  },
  {
    label: 'Chaos (error + latency injection)',
    href: docsUrl('/concepts/chaos'),
    developer: 'Full',
    team: 'Full',
    enterprise: 'Full + saved presets',
  },
  {
    label: 'Cloud-hosted project & snapshot sync',
    href: docsUrl('/concepts/state-engine'),
    developer: '—',
    team: 'Included',
    enterprise: 'Included',
  },
  {
    label: 'Dashboard, activity feed, member roles',
    developer: '—',
    team: 'Included',
    enterprise: 'Included + custom roles',
  },
  {
    label: 'AI-assisted resource / relationship inference',
    href: docsUrl('/concepts/ai-inference'),
    developer: '10 ingests / month',
    team: 'Unlimited',
    enterprise: 'Unlimited + BYO LLM key',
  },
  {
    label: 'Drift detection against upstream',
    developer: '—',
    team: 'Included',
    enterprise: 'Included + Slack / webhook alerts',
  },
  {
    label: 'Snapshot / event retention',
    developer: '7-day local cache',
    team: '90 days',
    enterprise: 'Configurable / unlimited',
  },
  {
    label: 'Audit log',
    developer: '—',
    team: '30-day view',
    enterprise: 'Full export + SIEM webhook',
  },
  {
    label: 'SSO',
    href: docsUrl('/enterprise/sso'),
    developer: '—',
    team: '—',
    enterprise: 'SAML + OIDC',
  },
  {
    label: 'SCIM provisioning',
    href: docsUrl('/enterprise/scim'),
    developer: '—',
    team: '—',
    enterprise: 'Included',
  },
  {
    label: 'Self-hosted control plane',
    href: docsUrl('/deployment/self-hosted'),
    developer: '—',
    team: '—',
    enterprise: 'Included',
  },
  {
    label: 'Support',
    developer: 'GitHub issues',
    team: 'Email, business hours',
    enterprise: 'Dedicated Slack + SLA',
  },
];
