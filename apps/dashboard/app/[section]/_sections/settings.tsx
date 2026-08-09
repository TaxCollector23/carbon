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
