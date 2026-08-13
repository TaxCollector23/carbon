'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { Button, Input } from '@carbon/ui';
import { EmptyState, ErrorBanner, Modal, Skeleton, Table, Td, Th } from '@/components/ui';
import { api, useSsoProviders } from '@/lib/hooks/api';
import { useAsync } from '@/lib/hooks/use-async';
import {
  ApiError,
  type MemberRole,
  type Organization,
  type Quota,
  type SlackInstallation,
  type SlackSubscription,
  type SsoProvider,
  type SsoProviderInput,
} from '@/lib/api-client';
import { getSectionCopy } from '@/lib/empty-data';

const ORG_STORAGE_KEY = 'carbon.orgId';

export default function SettingsSection() {
  // Try /v1/organizations/current first; fall back to a stored orgId hint
  // (so operators can point the dashboard at their org before the session
  // helper endpoint lands). Everything is guarded against 404/501 from
  // routes still being written by another agent.
  const [manualOrgId, setManualOrgId] = useState<string | null>(null);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    setManualOrgId(window.localStorage.getItem(ORG_STORAGE_KEY));
  }, []);

  const org = useAsync(async (): Promise<Organization | null> => {
    try {
      return await api.getCurrentOrganization();
    } catch (err) {
      if (err instanceof ApiError && (err.status === 404 || err.status === 501)) {
        if (manualOrgId) return api.getOrganization(manualOrgId);
        return null;
      }
      throw err;
    }
  }, [manualOrgId]);

  const orgId = org.data?.id ?? null;
  const members = useAsync(async () => {
    if (!orgId) return null;
    try {
      return await api.listMembers(orgId);
    } catch (err) {
      if (err instanceof ApiError && (err.status === 404 || err.status === 501)) return null;
      throw err;
    }
  }, [orgId]);

  const notDeployed =
    org.error instanceof ApiError && (org.error.status === 404 || org.error.status === 501);

  return (
    <div className="space-y-8">
      <UsageLimitsCard />
      {org.loading ? (
        <Skeleton className="h-24" />
      ) : notDeployed || (!org.data && !org.error) ? (
        <OrgIdPrompt current={manualOrgId} onSet={(id) => {
          window.localStorage.setItem(ORG_STORAGE_KEY, id);
          setManualOrgId(id);
        }} />
      ) : org.error ? (
        <ErrorBanner error={org.error} onRetry={org.refetch} />
      ) : org.data ? (
        <OrgForm org={org.data} onSaved={() => void org.refetch()} />
      ) : null}

      {orgId && org.data ? (
        <>
          <section className="space-y-3">
            <h3 className="text-base font-medium">Members</h3>
            <MembersPanel orgId={orgId} members={members} />
          </section>
          <section className="space-y-3">
            <h3 className="text-base font-medium">Integrations</h3>
            <IntegrationsPanel org={org.data} onSaved={() => void org.refetch()} />
          </section>
        </>
      ) : orgId ? (
        <section className="space-y-3">
          <h3 className="text-base font-medium">Members</h3>
          <MembersPanel orgId={orgId} members={members} />
        </section>
      ) : (
        <EmptyState
          title={getSectionCopy('settings')!.emptyTitle}
          description={getSectionCopy('settings')!.description}
          badge={notDeployed ? 'Not available yet' : undefined}
        />
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// "Usage & limits" card — surfaces per-org plan ceilings + current counters
// from `GET /v1/quota`. Rendered at the top of Settings so operators can
// eyeball where they stand before hunting for the raw numbers on the billing
// page. Silently no-ops when /v1/quota isn't deployed (older API).
// -----------------------------------------------------------------------------

function UsageLimitsCard() {
  const quota = useAsync(async (): Promise<Quota | null> => {
    try {
      return await api.getQuota();
    } catch (err) {
      if (err instanceof ApiError && (err.status === 404 || err.status === 501)) return null;
      throw err;
    }
  }, []);

  if (quota.loading) return <Skeleton className="h-32" />;
  if (quota.data === null) return null; // route not deployed — hide the card
  if (quota.error)
    return <ErrorBanner error={quota.error} onRetry={quota.refetch} />;
  if (!quota.data) return null;

  const q = quota.data;
  return (
    <section className="border-border max-w-3xl space-y-4 rounded-md border p-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-medium">Usage &amp; limits</h3>
          <p className="text-muted-foreground mt-1 text-xs">
            Current consumption against your plan ceilings.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <PlanBadge plan={q.plan} />
          {q.plan === 'developer' ? (
            <a
              href="/contact"
              className="border-border rounded-md border px-2.5 py-1 text-xs hover:bg-muted/30"
            >
              Upgrade
            </a>
          ) : null}
        </div>
      </div>
      <div className="space-y-3">
        <QuotaBar label="Concurrent emulators" current={q.current.emulators} max={q.limits.emulatorsMax} />
        <QuotaBar
          label="Requests / minute"
          current={q.current.requestsLast1m}
          max={q.limits.requestsPerMinute}
        />
        <QuotaBar
          label="AI ingests this month"
          current={q.current.aiIngestsThisMonth}
          max={q.limits.aiIngestsPerMonth}
        />
      </div>
    </section>
  );
}

function PlanBadge({ plan }: { plan: Quota['plan'] }) {
  const label = plan.charAt(0).toUpperCase() + plan.slice(1);
  const tone =
    plan === 'enterprise'
      ? 'bg-primary/10 text-primary border-primary/40'
      : plan === 'team'
        ? 'border-border bg-muted/40 text-foreground'
        : 'border-border text-muted-foreground';
  return (
    <span className={`rounded-full border px-2 py-0.5 text-xs ${tone}`}>{label}</span>
  );
}

function QuotaBar({
  label,
  current,
  max,
}: {
  label: string;
  /** null → the API can't compute the current value in this deployment. */
  current: number | null;
  /** null → unlimited on this plan. */
  max: number | null;
}) {
  const unlimited = max === null;
  const currentText = current === null ? '—' : String(current);
  const pct = unlimited || current === null || max === 0 ? 0 : Math.min(100, (current / max) * 100);

  // Green under 50%, amber 50–80%, red over 80% — chosen to match how the
  // rest of the dashboard signals health, not to be a semantic scale for the
  // color-blind (label + numeric value always accompany the bar).
  const barColor =
    pct >= 80
      ? 'bg-red-500'
      : pct >= 50
        ? 'bg-amber-500'
        : 'bg-emerald-500';

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        {unlimited ? (
          <span className="flex items-center gap-2">
            <span className="font-mono">{currentText}</span>
            <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
              Unlimited
            </span>
          </span>
        ) : (
          <span className="font-mono">
            {currentText} / {max}
          </span>
        )}
      </div>
      <div className="bg-muted/40 h-1.5 w-full overflow-hidden rounded-full">
        {unlimited ? (
          <div className="h-full w-full bg-emerald-500/40" />
        ) : (
          <div className={`h-full ${barColor}`} style={{ width: `${pct}%` }} />
        )}
      </div>
    </div>
  );
}

function OrgIdPrompt({
  current,
  onSet,
}: {
  current: string | null;
  onSet: (id: string) => void;
}) {
  const [value, setValue] = useState(current ?? '');
  return (
    <div className="border-border rounded-md border p-4">
      <h3 className="text-sm font-medium">Point the dashboard at an org</h3>
      <p className="text-muted-foreground mt-1 text-xs">
        The organizations endpoint is not deployed yet, or the session helper isn&apos;t
        available. Paste the org ID from your API key to load settings.
      </p>
      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (value.trim()) onSet(value.trim());
        }}
      >
        <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder="org_…" />
        <Button type="submit" size="sm">
          Load
        </Button>
      </form>
    </div>
  );
}

function OrgForm({ org, onSaved }: { org: Organization; onSaved: () => void }) {
  const [name, setName] = useState(org.name);
  const [slug, setSlug] = useState(org.slug);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setErr(null);
    try {
      await api.updateOrganization(org.id, { name: name.trim(), slug: slug.trim() });
      onSaved();
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : String(e2));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="border-border max-w-xl space-y-3 rounded-md border p-4" onSubmit={onSubmit}>
      <h3 className="text-base font-medium">Organization</h3>
      <label className="block text-sm">
        <span className="text-muted-foreground text-xs">Name</span>
        <Input value={name} onChange={(e) => setName(e.target.value)} required />
      </label>
      <label className="block text-sm">
        <span className="text-muted-foreground text-xs">Slug</span>
        <Input value={slug} onChange={(e) => setSlug(e.target.value)} required />
      </label>
      <p className="text-muted-foreground text-xs">ID: <code>{org.id}</code></p>
      {err ? <p className="text-destructive text-xs">{err}</p> : null}
      <Button type="submit" size="sm" disabled={saving}>
        {saving ? 'Saving…' : 'Save changes'}
      </Button>
    </form>
  );
}

function MembersPanel({
  orgId,
  members,
}: {
  orgId: string;
  members: ReturnType<typeof useAsync<{ data: Array<{ userId: string; role: MemberRole; email?: string; name?: string | null }> } | null>>;
}) {
  const [inviteOpen, setInviteOpen] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function changeRole(userId: string, role: MemberRole) {
    setBusy(userId);
    setRowError(null);
    try {
      await api.changeMemberRole(orgId, userId, { role });
      await members.refetch();
    } catch (e) {
      setRowError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function remove(userId: string) {
    if (!confirm('Remove this member?')) return;
    setBusy(userId);
    setRowError(null);
    try {
      await api.removeMember(orgId, userId);
      await members.refetch();
    } catch (e) {
      setRowError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const notDeployed = members.data === null && !members.loading && !members.error;
  const rows = members.data?.data ?? [];

  return (
    <>
      <div className="flex items-center justify-between">
        <p className="text-muted-foreground text-sm">
          {members.loading ? 'Loading…' : `${rows.length} members`}
        </p>
        <Button size="sm" onClick={() => setInviteOpen(true)} disabled={notDeployed}>
          Invite
        </Button>
      </div>
      {rowError ? <ErrorBanner error={rowError} /> : null}
      {notDeployed ? (
        <EmptyState
          badge="Not available yet"
          title="Member management is not deployed"
          description="Once /v1/organizations/:id/members is wired up on this API, invites and role edits will show up here."
        />
      ) : members.loading ? (
        <Skeleton className="h-24" />
      ) : members.error ? (
        <ErrorBanner error={members.error} onRetry={members.refetch} />
      ) : rows.length === 0 ? (
        <EmptyState title="No members yet" description="Invite a teammate to get started." />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>User</Th>
              <Th>Role</Th>
              <Th className="w-24">Actions</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.userId} className="hover:bg-muted/30">
                <Td>
                  <div className="text-sm">{m.name ?? m.email ?? m.userId}</div>
                  {m.email ? <div className="text-muted-foreground text-xs">{m.email}</div> : null}
                </Td>
                <Td>
                  <select
                    className="border-border bg-background rounded-md border px-2 py-1 text-xs"
                    value={m.role}
                    disabled={busy === m.userId}
                    onChange={(e) => void changeRole(m.userId, e.target.value as MemberRole)}
                  >
                    <option value="owner">owner</option>
                    <option value="admin">admin</option>
                    <option value="member">member</option>
                  </select>
                </Td>
                <Td>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy === m.userId}
                    onClick={() => remove(m.userId)}
                  >
                    Remove
                  </Button>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      <InviteMemberModal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        orgId={orgId}
        onInvited={() => {
          setInviteOpen(false);
          void members.refetch();
        }}
      />
    </>
  );
}

function InviteMemberModal({
  open,
  onClose,
  orgId,
  onInvited,
}: {
  open: boolean;
  onClose: () => void;
  orgId: string;
  onInvited: () => void;
}) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<MemberRole>('member');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api.inviteMember(orgId, { email: email.trim(), role });
      setEmail('');
      setRole('member');
      onInvited();
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : String(e2));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Invite member"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button form="invite-form" type="submit" disabled={busy}>
            {busy ? 'Sending…' : 'Send invite'}
          </Button>
        </>
      }
    >
      <form id="invite-form" className="space-y-3" onSubmit={onSubmit}>
        <label className="block text-sm">
          <span className="text-muted-foreground text-xs">Email</span>
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            placeholder="teammate@example.com"
          />
        </label>
        <label className="block text-sm">
          <span className="text-muted-foreground text-xs">Role</span>
          <select
            className="border-border bg-background w-full rounded-md border px-2 py-1.5 text-sm"
            value={role}
            onChange={(e) => setRole(e.target.value as MemberRole)}
          >
            <option value="owner">owner</option>
            <option value="admin">admin</option>
            <option value="member">member</option>
          </select>
        </label>
        {err ? <p className="text-destructive text-xs">{err}</p> : null}
      </form>
    </Modal>
  );
}

// -----------------------------------------------------------------------------
// Integrations subsection: webhooks + SSO providers. All state lives under
// `organizations.settings` on the API; the PATCH merges shallowly so a
// partial update doesn't overwrite unrelated keys.
// -----------------------------------------------------------------------------

function IntegrationsPanel({ org, onSaved }: { org: Organization; onSaved: () => void }) {
  const settings = (org.settings ?? {}) as Record<string, unknown>;
  const initialSlack = typeof settings.slackWebhookUrl === 'string' ? settings.slackWebhookUrl : '';
  const initialDiscord = typeof settings.discordWebhookUrl === 'string' ? settings.discordWebhookUrl : '';

  const [slack, setSlack] = useState(initialSlack);
  const [discord, setDiscord] = useState(initialDiscord);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    setSlack(initialSlack);
    setDiscord(initialDiscord);
  }, [initialSlack, initialDiscord]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setErr(null);
    setMsg(null);
    try {
      await api.updateOrganization(org.id, {
        settings: {
          slackWebhookUrl: slack.trim() || undefined,
          discordWebhookUrl: discord.trim() || undefined,
        },
      });
      setMsg('Saved.');
      onSaved();
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : String(e2));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <form className="border-border max-w-xl space-y-3 rounded-md border p-4" onSubmit={onSubmit}>
        <h4 className="text-sm font-medium">Webhooks</h4>
        <label className="block text-sm">
          <span className="text-muted-foreground text-xs">Slack webhook URL</span>
          <Input
            type="url"
            value={slack}
            onChange={(e) => setSlack(e.target.value)}
            placeholder="https://hooks.slack.com/services/…"
          />
        </label>
        <label className="block text-sm">
          <span className="text-muted-foreground text-xs">Discord webhook URL</span>
          <Input
            type="url"
            value={discord}
            onChange={(e) => setDiscord(e.target.value)}
            placeholder="https://discord.com/api/webhooks/…"
          />
        </label>
        {err ? <p className="text-destructive text-xs">{err}</p> : null}
        {msg ? <p className="text-muted-foreground text-xs">{msg}</p> : null}
        <Button type="submit" size="sm" disabled={saving}>
          {saving ? 'Saving…' : 'Save webhooks'}
        </Button>
      </form>

      <SlackAppPanel />

      {org.isEnterprise ? (
        <SsoPanel />
      ) : (
        <div className="border-border max-w-xl rounded-md border border-dashed p-4">
          <h4 className="text-sm font-medium">SSO</h4>
          <p className="text-muted-foreground mt-1 text-xs">
            SSO providers (SAML and OIDC) are available on Enterprise plans.
          </p>
        </div>
      )}
    </div>
  );
}

function SsoPanel() {
  const providers = useSsoProviders(true);
  const [adding, setAdding] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);

  async function remove(id: string) {
    if (!confirm('Remove this SSO provider?')) return;
    setRowError(null);
    try {
      await api.deleteSsoProvider(id);
      await providers.refetch();
    } catch (e) {
      setRowError(e instanceof ApiError ? e.message : String(e));
    }
  }

  const rows = providers.data?.data ?? [];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium">SSO providers</h4>
        <Button size="sm" onClick={() => setAdding(true)}>
          Add provider
        </Button>
      </div>
      {rowError ? <ErrorBanner error={rowError} /> : null}
      {providers.loading ? (
        <Skeleton className="h-16" />
      ) : providers.error ? (
        <ErrorBanner error={providers.error} onRetry={providers.refetch} />
      ) : rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">No providers configured.</p>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Type</Th>
              <Th>Domain</Th>
              <Th className="w-24">Actions</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p: SsoProvider) => (
              <tr key={p.id} className="hover:bg-muted/30">
                <Td>{p.name}</Td>
                <Td className="uppercase">{p.type}</Td>
                <Td>{p.emailDomain ?? '—'}</Td>
                <Td>
                  <Button size="sm" variant="ghost" onClick={() => remove(p.id)}>
                    Remove
                  </Button>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      <AddSsoModal
        open={adding}
        onClose={() => setAdding(false)}
        onAdded={() => {
          setAdding(false);
          void providers.refetch();
        }}
      />
    </div>
  );
}

function AddSsoModal({
  open,
  onClose,
  onAdded,
}: {
  open: boolean;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [type, setType] = useState<'saml' | 'oidc'>('saml');
  const [name, setName] = useState('');
  const [emailDomain, setEmailDomain] = useState('');
  // SAML fields
  const [entityId, setEntityId] = useState('');
  const [ssoUrl, setSsoUrl] = useState('');
  const [certificate, setCertificate] = useState('');
  // OIDC fields
  const [issuer, setIssuer] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const input: SsoProviderInput =
        type === 'saml'
          ? {
              type: 'saml',
              name: name.trim(),
              entityId: entityId.trim(),
              ssoUrl: ssoUrl.trim(),
              certificate: certificate.trim(),
              emailDomain: emailDomain.trim() || undefined,
            }
          : {
              type: 'oidc',
              name: name.trim(),
              issuer: issuer.trim(),
              clientId: clientId.trim(),
              clientSecret: clientSecret.trim(),
              emailDomain: emailDomain.trim() || undefined,
            };
      await api.createSsoProvider(input);
      onAdded();
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : String(e2));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add SSO provider"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button form="sso-form" type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Add provider'}
          </Button>
        </>
      }
    >
      <form id="sso-form" className="space-y-3" onSubmit={onSubmit}>
        <label className="block text-sm">
          <span className="text-muted-foreground text-xs">Type</span>
          <select
            className="border-border bg-background w-full rounded-md border px-2 py-1.5 text-sm"
            value={type}
            onChange={(e) => setType(e.target.value as 'saml' | 'oidc')}
          >
            <option value="saml">SAML</option>
            <option value="oidc">OIDC</option>
          </select>
        </label>
        <label className="block text-sm">
          <span className="text-muted-foreground text-xs">Display name</span>
          <Input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label className="block text-sm">
          <span className="text-muted-foreground text-xs">Email domain (optional)</span>
          <Input value={emailDomain} onChange={(e) => setEmailDomain(e.target.value)} placeholder="example.com" />
        </label>
        {type === 'saml' ? (
          <>
            <label className="block text-sm">
              <span className="text-muted-foreground text-xs">Entity ID</span>
              <Input value={entityId} onChange={(e) => setEntityId(e.target.value)} required />
            </label>
            <label className="block text-sm">
              <span className="text-muted-foreground text-xs">SSO URL</span>
              <Input type="url" value={ssoUrl} onChange={(e) => setSsoUrl(e.target.value)} required />
            </label>
            <label className="block text-sm">
              <span className="text-muted-foreground text-xs">X.509 certificate</span>
              <textarea
                className="border-border bg-background mt-1 h-24 w-full rounded-md border px-2 py-1.5 font-mono text-xs"
                value={certificate}
                onChange={(e) => setCertificate(e.target.value)}
                required
              />
            </label>
          </>
        ) : (
          <>
            <label className="block text-sm">
              <span className="text-muted-foreground text-xs">Issuer</span>
              <Input type="url" value={issuer} onChange={(e) => setIssuer(e.target.value)} required />
            </label>
            <label className="block text-sm">
              <span className="text-muted-foreground text-xs">Client ID</span>
              <Input value={clientId} onChange={(e) => setClientId(e.target.value)} required />
            </label>
            <label className="block text-sm">
              <span className="text-muted-foreground text-xs">Client secret</span>
              <Input
                type="password"
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
                required
              />
            </label>
          </>
        )}
        {err ? <p className="text-destructive text-xs">{err}</p> : null}
      </form>
    </Modal>
  );
}

// -----------------------------------------------------------------------------
// Slack app (round 13): real OAuth-installed workspace integration.
// Coexists with the Slack Incoming Webhook URL under Webhooks above — a workspace
// installation is per-org and can subscribe any channel to any subset of events.
// -----------------------------------------------------------------------------

const KNOWN_SLACK_EVENTS: readonly string[] = [
  'snapshot.overwritten',
  'drift.detected',
  'emulator.crashed',
  'sso_provider.created',
  'sso_provider.deleted',
  'slack_installation.created',
];

function SlackAppPanel() {
  const installs = useAsync(async () => {
    try {
      return await api.listSlackInstallations();
    } catch (err) {
      if (err instanceof ApiError && (err.status === 404 || err.status === 501)) return null;
      throw err;
    }
  }, []);
  const subs = useAsync(async () => {
    try {
      return await api.listSlackSubscriptions();
    } catch (err) {
      if (err instanceof ApiError && (err.status === 404 || err.status === 501)) return null;
      throw err;
    }
  }, []);
  const [rowError, setRowError] = useState<string | null>(null);

  const apiBase =
    (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_CARBON_API_URL) ||
    'http://localhost:4000';
  const installUrl = `${String(apiBase).replace(/\/$/, '')}/v1/slack/install`;

  async function removeInstall(id: string) {
    if (!confirm('Uninstall this Slack workspace? All channel subscriptions will be removed.')) return;
    setRowError(null);
    try {
      await api.deleteSlackInstallation(id);
      await installs.refetch();
      await subs.refetch();
    } catch (e) {
      setRowError(e instanceof ApiError ? e.message : String(e));
    }
  }
  async function removeSub(id: string) {
    setRowError(null);
    try {
      await api.deleteSlackSubscription(id);
      await subs.refetch();
    } catch (e) {
      setRowError(e instanceof ApiError ? e.message : String(e));
    }
  }

  const notDeployed = installs.data === null && !installs.loading && !installs.error;
  const rows = installs.data?.data ?? [];
  const subRows = subs.data?.data ?? [];

  return (
    <div className="border-border max-w-3xl space-y-4 rounded-md border p-4">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-sm font-medium">Slack app</h4>
          <p className="text-muted-foreground mt-1 text-xs">
            Install Carbon into a Slack workspace via OAuth and subscribe any channel to org
            events. Requires <code>SLACK_CLIENT_ID</code> to be configured on the API.
          </p>
        </div>
        {!notDeployed ? (
          <a
            href={installUrl}
            className="border-border rounded-md border px-3 py-1.5 text-xs hover:bg-muted/30"
          >
            Connect Slack
          </a>
        ) : null}
      </div>

      {rowError ? <ErrorBanner error={rowError} /> : null}

      {notDeployed ? (
        <EmptyState
          badge="Not available yet"
          title="Slack integration is not deployed"
          description="Once /v1/slack/* is wired up on this API, connected workspaces will show here."
        />
      ) : installs.loading ? (
        <Skeleton className="h-16" />
      ) : installs.error ? (
        <ErrorBanner error={installs.error} onRetry={installs.refetch} />
      ) : rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No workspaces connected yet. Click <strong>Connect Slack</strong> to install.
        </p>
      ) : (
        <div className="space-y-6">
          {rows.map((inst: SlackInstallation) => {
            const forInstall = subRows.filter((s) => s.installationId === inst.id);
            return (
              <div key={inst.id} className="border-border rounded-md border p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium">{inst.teamName}</div>
                    <div className="text-muted-foreground text-xs">
                      team {inst.teamId} · installed {inst.installedAt.slice(0, 10)}
                    </div>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => removeInstall(inst.id)}>
                    Uninstall
                  </Button>
                </div>
                <div className="mt-3">
                  <SlackSubscriptionEditor
                    installationId={inst.id}
                    subs={forInstall}
                    onChanged={async () => {
                      await subs.refetch();
                    }}
                    onRemove={removeSub}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SlackSubscriptionEditor({
  installationId,
  subs,
  onChanged,
  onRemove,
}: {
  installationId: string;
  subs: SlackSubscription[];
  onChanged: () => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}) {
  const [channelId, setChannelId] = useState('');
  const [channelName, setChannelName] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function toggle(evt: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(evt)) next.delete(evt);
      else next.add(evt);
      return next;
    });
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api.createSlackSubscription({
        installationId,
        channelId: channelId.trim(),
        channelName: channelName.trim(),
        events: [...picked],
      });
      setChannelId('');
      setChannelName('');
      setPicked(new Set());
      await onChanged();
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : String(e2));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      {subs.length > 0 ? (
        <ul className="space-y-2">
          {subs.map((s) => (
            <li
              key={s.id}
              className="flex items-center justify-between rounded-md bg-muted/30 px-2 py-1.5 text-xs"
            >
              <div>
                <span className="font-medium">#{s.channelName}</span>{' '}
                <span className="text-muted-foreground">→ {s.events.join(', ')}</span>
              </div>
              <Button size="sm" variant="ghost" onClick={() => void onRemove(s.id)}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground text-xs">No channel subscriptions yet.</p>
      )}
      <form onSubmit={submit} className="space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <Input
            value={channelId}
            onChange={(e) => setChannelId(e.target.value)}
            placeholder="C0123456789"
            required
          />
          <Input
            value={channelName}
            onChange={(e) => setChannelName(e.target.value)}
            placeholder="eng-alerts"
            required
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {KNOWN_SLACK_EVENTS.map((evt) => {
            const on = picked.has(evt);
            return (
              <button
                key={evt}
                type="button"
                onClick={() => toggle(evt)}
                className={
                  'rounded-full border px-2 py-0.5 text-xs ' +
                  (on
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border text-muted-foreground hover:bg-muted/30')
                }
              >
                {evt}
              </button>
            );
          })}
        </div>
        {err ? <p className="text-destructive text-xs">{err}</p> : null}
        <Button size="sm" type="submit" disabled={busy || picked.size === 0}>
          {busy ? 'Adding…' : 'Add subscription'}
        </Button>
      </form>
    </div>
  );
}
