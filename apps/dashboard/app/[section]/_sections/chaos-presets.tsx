'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { Button, Input } from '@carbon/ui';
import { EmptyState, ErrorBanner, Modal, Skeleton, Table, Td, Th } from '@/components/ui';
import { useToast } from '@/components/toast';
import { api, useChaosPresets } from '@/lib/hooks/api';
import { ApiError, type ChaosRule } from '@/lib/api-client';
import { getSectionCopy } from '@/lib/empty-data';

export default function ChaosPresetsSection() {
  const presets = useChaosPresets();
  const toast = useToast();
  const [openCreate, setOpenCreate] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  async function onDelete(id: string, name: string) {
    if (!confirm(`Delete chaos preset "${name}"?`)) return;
    setDeleting(id);
    try {
      await api.deleteChaosPreset(id);
      toast.push({ kind: 'success', message: `Deleted preset "${name}"` });
      await presets.refetch();
    } catch (err) {
      toast.push({
        kind: 'error',
        message: err instanceof ApiError ? err.message : String(err),
      });
    } finally {
      setDeleting(null);
    }
  }

  const rows = presets.data?.data ?? [];

  return (
    <>
      <header className="flex items-center justify-between">
        <p className="text-muted-foreground text-sm">
          {presets.loading ? 'Loading…' : `${rows.length} preset${rows.length === 1 ? '' : 's'}`}
        </p>
        <Button size="sm" onClick={() => setOpenCreate(true)} data-testid="new-chaos-preset-button">
          New preset
        </Button>
      </header>

      {presets.loading ? (
        <div className="space-y-2">
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
      ) : presets.error ? (
        <ErrorBanner error={presets.error} onRetry={presets.refetch} />
      ) : rows.length === 0 ? (
        <EmptyState
          title={getSectionCopy('chaos-presets')!.emptyTitle}
          description={getSectionCopy('chaos-presets')!.description}
          action={
            <Button size="sm" onClick={() => setOpenCreate(true)}>
              Create your first preset
            </Button>
          }
        />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Description</Th>
              <Th>Rules</Th>
              <Th>Type</Th>
              <Th className="w-24">Actions</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id} className="hover:bg-muted/30" data-testid="chaos-preset-row">
                <Td className="font-medium">{p.name}</Td>
                <Td className="text-muted-foreground text-xs">{p.description ?? '—'}</Td>
                <Td className="text-xs">{p.rules.length}</Td>
                <Td>
                  {p.builtIn ? (
                    <span className="border-border text-muted-foreground rounded-full border px-2 py-0.5 text-xs">
                      built-in
                    </span>
                  ) : (
                    <span className="text-xs">custom</span>
                  )}
                </Td>
                <Td>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={p.builtIn || deleting === p.id}
                    onClick={() => onDelete(p.id, p.name)}
                  >
                    {deleting === p.id ? 'Deleting…' : 'Delete'}
                  </Button>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      <CreatePresetModal
        open={openCreate}
        onClose={() => setOpenCreate(false)}
        onCreated={(name) => {
          setOpenCreate(false);
          toast.push({ kind: 'success', message: `Created preset "${name}"` });
          void presets.refetch();
        }}
      />
    </>
  );
}

const DEFAULT_RULES_JSON = JSON.stringify(
  [
    { kind: 'latency', floorMs: 250, jitterMs: 100 },
    { kind: 'error', probability: 0.1, status: 500 },
  ] satisfies ChaosRule[],
  null,
  2,
);

function CreatePresetModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (name: string) => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [rulesText, setRulesText] = useState(DEFAULT_RULES_JSON);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parseResult = useMemo(() => {
    try {
      const parsed = JSON.parse(rulesText);
      if (!Array.isArray(parsed))
        return { ok: false as const, message: 'rules must be a JSON array' };
      return { ok: true as const, value: parsed as ChaosRule[] };
    } catch (e) {
      return { ok: false as const, message: e instanceof Error ? e.message : 'invalid JSON' };
    }
  }, [rulesText]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!parseResult.ok) {
      setError(parseResult.message);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await api.createChaosPreset({
        name: name.trim(),
        description: description.trim() || undefined,
        rules: parseResult.value,
      });
      setName('');
      setDescription('');
      setRulesText(DEFAULT_RULES_JSON);
      onCreated(name.trim());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New chaos preset"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            form="new-chaos-preset-form"
            type="submit"
            disabled={submitting || !parseResult.ok || name.trim().length === 0}
          >
            {submitting ? 'Creating…' : 'Create preset'}
          </Button>
        </>
      }
    >
      <form id="new-chaos-preset-form" className="space-y-3" onSubmit={onSubmit}>
        <label className="block text-sm">
          <span className="text-muted-foreground text-xs">Name</span>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={80}
            data-testid="chaos-preset-name-input"
          />
        </label>
        <label className="block text-sm">
          <span className="text-muted-foreground text-xs">Description (optional)</span>
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={240}
          />
        </label>
        <label className="block text-sm">
          <span className="text-muted-foreground text-xs">Rules (JSON array)</span>
          <textarea
            value={rulesText}
            onChange={(e) => setRulesText(e.target.value)}
            spellCheck={false}
            rows={10}
            className="border-input bg-background focus-visible:ring-ring mt-1 block w-full rounded-md border px-3 py-2 font-mono text-xs shadow-sm focus-visible:outline-none focus-visible:ring-2"
            data-testid="chaos-preset-rules-input"
          />
          {parseResult.ok ? (
            <p className="text-muted-foreground mt-1 text-xs">
              {parseResult.value.length} rule{parseResult.value.length === 1 ? '' : 's'} parsed
            </p>
          ) : (
            <p className="text-destructive mt-1 text-xs">Invalid JSON: {parseResult.message}</p>
          )}
        </label>
        {error ? <p className="text-destructive text-xs">{error}</p> : null}
      </form>
    </Modal>
  );
}
