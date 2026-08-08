'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { Button, Input } from '@carbon/ui';
import { EmptyState, ErrorBanner, Modal, Skeleton, Table, Td, Th } from '@/components/ui';
import { api } from '@/lib/hooks/api';
import { useAsync } from '@/lib/hooks/use-async';
import { ApiError, type MemberRole, type Organization } from '@/lib/api-client';
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

      {orgId ? (
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
