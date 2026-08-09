'use client';

import { useState, type FormEvent } from 'react';
import { Copy } from 'lucide-react';
import { Button, Input } from '@carbon/ui';
import { EmptyState, ErrorBanner, Modal, Skeleton, Table, Td, Th } from '@/components/ui';
import { api, useApiKeys, type Scope } from '@/lib/hooks/api';
import { ApiError, type CreatedApiKey } from '@/lib/api-client';
import { getSectionCopy } from '@/lib/empty-data';

export default function KeysSection() {
  const keys = useApiKeys();
  const [openCreate, setOpenCreate] = useState(false);
  const [freshKey, setFreshKey] = useState<CreatedApiKey | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function revoke(id: string, name: string) {
    if (!confirm(`Revoke API key "${name}"? Callers using it will start getting 401s.`)) return;
    setRevoking(id);
    setError(null);
    try {
      await api.revokeApiKey(id);
      await keys.refetch();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setRevoking(null);
    }
  }

  const rows = keys.data?.data ?? [];

  return (
    <>
      <header className="flex items-center justify-between">
        <p className="text-muted-foreground text-sm">{keys.loading ? 'Loading…' : `${rows.length} active`}</p>
        <Button size="sm" onClick={() => setOpenCreate(true)} data-testid="new-api-key-button">
          New API key
        </Button>
      </header>

      {error ? <ErrorBanner error={error} /> : null}

      {keys.loading ? (
        <div className="space-y-2">
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
      ) : keys.error ? (
        <ErrorBanner error={keys.error} onRetry={keys.refetch} />
      ) : rows.length === 0 ? (
        <EmptyState
          title={getSectionCopy('keys')!.emptyTitle}
          description={getSectionCopy('keys')!.description}
          action={
            <Button size="sm" onClick={() => setOpenCreate(true)}>
              Create key
            </Button>
          }
        />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Prefix</Th>
              <Th>Scopes</Th>
              <Th>Last used</Th>
              <Th>Expires</Th>
              <Th className="w-24">Actions</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((k) => (
              <tr key={k.id} className="hover:bg-muted/30">
                <Td>{k.name}</Td>
                <Td className="font-mono text-xs">{k.prefix}…</Td>
                <Td className="text-xs">{k.scopes.join(', ')}</Td>
                <Td className="text-xs">
                  {k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : '—'}
                </Td>
                <Td className="text-xs">
                  {k.expiresAt ? new Date(k.expiresAt).toLocaleString() : 'never'}
                </Td>
                <Td>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={revoking === k.id}
                    onClick={() => revoke(k.id, k.name)}
                  >
                    {revoking === k.id ? 'Revoking…' : 'Revoke'}
                  </Button>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      <CreateKeyModal
        open={openCreate}
        onClose={() => setOpenCreate(false)}
        onCreated={(k) => {
          setOpenCreate(false);
          setFreshKey(k);
          void keys.refetch();
        }}
      />
      <ShowSecretModal fresh={freshKey} onClose={() => setFreshKey(null)} />
    </>
  );
}

function CreateKeyModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (k: CreatedApiKey) => void;
}) {
  const [name, setName] = useState('');
  const [orgId, setOrgId] = useState('');
  const [scopes, setScopes] = useState<Record<Scope, boolean>>({
    read: true,
    write: false,
    admin: false,
  });
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const chosen = (Object.keys(scopes) as Scope[]).filter((s) => scopes[s]);
    if (chosen.length === 0) {
      setErr('Pick at least one scope');
      return;
    }
    setSubmitting(true);
    setErr(null);
    try {
      const key = await api.createApiKey({
        name: name.trim(),
        orgId: orgId.trim() || undefined,
        scopes: chosen,
        projectIds: null,
      });
      setName('');
      setOrgId('');
      setScopes({ read: true, write: false, admin: false });
      onCreated(key);
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : String(e2));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New API key"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button form="new-key-form" type="submit" disabled={submitting}>
            {submitting ? 'Creating…' : 'Create key'}
          </Button>
        </>
      }
    >
      <form id="new-key-form" className="space-y-3" onSubmit={onSubmit}>
        <label className="block text-sm">
          <span className="text-muted-foreground text-xs">Name</span>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={80}
            data-testid="new-api-key-name-input"
          />
        </label>
        <label className="block text-sm">
          <span className="text-muted-foreground text-xs">Org ID (optional if session has org)</span>
          <Input value={orgId} onChange={(e) => setOrgId(e.target.value)} placeholder="org_…" />
        </label>
        <fieldset className="space-y-1.5">
          <legend className="text-muted-foreground text-xs">Scopes</legend>
          {(['read', 'write', 'admin'] as Scope[]).map((s) => (
            <label key={s} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={scopes[s]}
                onChange={(e) => setScopes((cur) => ({ ...cur, [s]: e.target.checked }))}
              />
              <span className="font-mono text-xs">{s}</span>
              <span className="text-muted-foreground text-xs">
                {s === 'read'
                  ? '— GETs on projects/artifacts/snapshots'
                  : s === 'write'
                    ? '— create/mutate resources'
                    : '— manage API keys (dangerous)'}
              </span>
            </label>
          ))}
        </fieldset>
        {err ? <p className="text-destructive text-xs">{err}</p> : null}
      </form>
    </Modal>
  );
}

function ShowSecretModal({ fresh, onClose }: { fresh: CreatedApiKey | null; onClose: () => void }) {
  return (
    <Modal
      open={fresh !== null}
      onClose={onClose}
      title="Copy your key now"
      footer={
        <Button onClick={onClose} variant="primary">
          I&apos;ve stored it — close
        </Button>
      }
    >
      {fresh ? (
        <div className="space-y-3">
          <div className="border-destructive/50 bg-destructive/5 text-destructive rounded-md border px-3 py-2 text-xs leading-5">
            This is the <strong>only time</strong> the full key will be shown. Store it in a
            secret manager now — after this dialog closes we only keep the prefix.
          </div>
          <div className="border-border flex items-center gap-2 rounded-md border px-3 py-2 font-mono text-xs">
            <span className="min-w-0 flex-1 break-all">{fresh.secret}</span>
            <button
              type="button"
              aria-label="Copy to clipboard"
              className="text-muted-foreground hover:text-foreground shrink-0"
              onClick={() => {
                void navigator.clipboard.writeText(fresh.secret);
              }}
            >
              <Copy className="h-4 w-4" />
            </button>
          </div>
          <p className="text-muted-foreground text-xs">
            Prefix: <code>{fresh.prefix}</code> · scopes: {fresh.scopes.join(', ')}
          </p>
        </div>
      ) : null}
    </Modal>
  );
}
