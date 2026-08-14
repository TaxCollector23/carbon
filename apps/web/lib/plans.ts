/**
 * Shared plan definitions consumed by the pricing page and the compare-features
 * table below it. The docs site's `plans.mdx` duplicates this content (mdx
 * can't cheaply import a TS module across the workspace boundary) — if you
 * update tiers here, mirror the change into `apps/docs/plans.mdx`.
 *
 * Rationale for the axis: capability-gating a developer tool teaches users to
 * fork rather than pay. Every tier gets the full CLI + local runtime + 8
 * adapters + chaos + local snapshots.
 *
 * Pro gates on the day-two anxiety of a solo dev: "does my mock still match
 * reality?" — i.e. **drift detection** against the real upstream, plus
 * unlimited AI ingest, extended chaos, and a snapshot library. Team sharing
 * is a bullet on Pro, not the headline.
 *
 * Team/Business is the team-lead purchase — cloud shared state, org quota,
 * SSO, audit log. Enterprise adds self-host + regulated-scale controls.
 */
export type TierId = 'developer' | 'pro' | 'team' | 'enterprise';

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
    id: 'pro',
    name: 'Pro',
    price: '$29',
    period: 'per developer / month',
    tagline:
      "Carbon periodically replays a slice of your captured traffic against the real API and tells you when behavior diverges — so your local emulator doesn't rot silently.",
    cta: { label: 'Start Pro trial', href: dashboardUrl('/onboarding') },
    highlighted: true,
    features: [
      'Everything in Free',
      'Drift detection — scheduled replay of captured traffic against the real upstream',
      'Unlimited AI-assisted ingest (best-available model)',
      'Extended chaos presets — saved, reusable, matrix-runnable',
      'Snapshot library — versioned, tagged, shareable across your own machines',
      'Optional cloud sync when you want it (single-seat)',
      '90-day snapshot / event retention',
      'Email support (business hours)',
    ],
  },
  {
    id: 'team',
    name: 'Team / Business',
    price: '$79',
    period: 'per developer / month',
    tagline:
      'For teams already living in Carbon — shared cloud state, org quota, SSO, and an audit log.',
    cta: { label: 'Start a team trial', href: dashboardUrl('/onboarding') },
    features: [
      'Everything in Pro',
      'Shared cloud-hosted projects & snapshot sync (`carbon snapshot push/pull`)',
      'Team dashboard: projects, runs, activity feed, member roles',
      'Org-wide quota + spend controls',
      'SSO (SAML, OIDC)',
      'Audit log — 90-day view',
      'Priority email + shared Slack channel',
    ],
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    price: 'Contact us',
    period: 'annual, tailored to your footprint',
    tagline: 'Self-host, SCIM, unlimited retention, SIEM export, and BYO LLM key for regulated teams.',
    cta: { label: 'Talk to us', href: '/contact' },
    features: [
      'Everything in Team',
      'SCIM provisioning',
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
  readonly pro: string;
  readonly team: string;
  readonly enterprise: string;
}

export const COMPARE_ROWS: readonly CompareRow[] = [
  {
    label: 'CLI + local runtime, all 8 adapters',
    href: docsUrl('/concepts/spec-to-runtime'),
    developer: 'Unlimited',
    pro: 'Unlimited',
    team: 'Unlimited',
    enterprise: 'Unlimited',
  },
  {
    label: 'Local JSON snapshots',
    href: docsUrl('/concepts/state-engine'),
    developer: 'Unlimited',
    pro: 'Unlimited + versioned library',
    team: 'Unlimited + versioned library',
    enterprise: 'Unlimited + versioned library',
  },
  {
    label: 'Chaos (error + latency injection)',
    href: docsUrl('/concepts/chaos'),
    developer: 'Full',
    pro: 'Full + saved presets',
    team: 'Full + saved presets',
    enterprise: 'Full + saved presets',
  },
  {
    label: 'Drift detection against upstream',
    developer: '—',
    pro: 'Scheduled replay + email',
    team: 'Scheduled + team dashboard',
    enterprise: 'Scheduled + Slack / webhook alerts',
  },
  {
    label: 'AI-assisted resource / relationship inference',
    href: docsUrl('/concepts/ai-inference'),
    developer: '10 ingests / month',
    pro: 'Unlimited',
    team: 'Unlimited',
    enterprise: 'Unlimited + BYO LLM key',
  },
  {
    label: 'Cloud-hosted shared project & snapshot sync',
    href: docsUrl('/concepts/state-engine'),
    developer: '—',
    pro: 'Single-seat',
    team: 'Included',
    enterprise: 'Included',
  },
  {
    label: 'Dashboard, activity feed, member roles',
    developer: '—',
    pro: '—',
    team: 'Included',
    enterprise: 'Included + custom roles',
  },
  {
    label: 'Snapshot / event retention',
    developer: '7-day local cache',
    pro: '90 days',
    team: '90 days',
    enterprise: 'Configurable / unlimited',
  },
  {
    label: 'Audit log',
    developer: '—',
    pro: '—',
    team: '90-day view',
    enterprise: 'Full export + SIEM webhook',
  },
  {
    label: 'SSO',
    href: docsUrl('/enterprise/sso'),
    developer: '—',
    pro: '—',
    team: 'SAML + OIDC',
    enterprise: 'SAML + OIDC',
  },
  {
    label: 'SCIM provisioning',
    href: docsUrl('/enterprise/scim'),
    developer: '—',
    pro: '—',
    team: '—',
    enterprise: 'Included',
  },
  {
    label: 'Self-hosted control plane',
    href: docsUrl('/deployment/self-hosted'),
    developer: '—',
    pro: '—',
    team: '—',
    enterprise: 'Included',
  },
  {
    label: 'Support',
    developer: 'GitHub issues',
    pro: 'Email, business hours',
    team: 'Priority email + shared Slack',
    enterprise: 'Dedicated Slack + SLA',
  },
];
