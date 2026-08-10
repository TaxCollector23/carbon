'use client';

import { useState, type FormEvent } from 'react';
import { Button, Input } from '@carbon/ui';
import { EmptyState, ErrorBanner, Modal, Skeleton, Table, Td, Th } from '@/components/ui';
import { useSearchParams } from 'next/navigation';
import { api, useProjects } from '@/lib/hooks/api';
import { ApiError } from '@/lib/api-client';
import { getSectionCopy } from '@/lib/empty-data';
import { TrySampleButton } from '../_actions/try-sample';

export default function ProjectsSection() {
  const projects = useProjects({ includeTotal: true } as { limit?: number; orgId?: string });
  const [open, setOpen] = useState(false);
  const searchParams = useSearchParams();
  const sampleParam = searchParams?.get('sample') ?? null;

  return (
    <>
      <header className="flex items-center justify-between">
        <p className="text-muted-foreground text-sm">
          {projects.data?.total != null
            ? `${projects.data.total} total`
            : projects.data?.data?.length != null
              ? `${projects.data.data.length} shown`
              : ''}
        </p>
        <div className="flex items-center gap-2">
          {sampleParam ? (
            <TrySampleButton autoInstantiate={sampleParam} onDone={() => void projects.refetch()} />
          ) : (
            <TrySampleButton onDone={() => void projects.refetch()} />
          )}
          <Button size="sm" onClick={() => setOpen(true)} data-testid="new-project-button">
            New project
          </Button>
        </div>
      </header>

      {projects.loading ? (
        <div className="space-y-2">
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
      ) : projects.error ? (
        <ErrorBanner error={projects.error} onRetry={projects.refetch} />
      ) : (projects.data?.data?.length ?? 0) === 0 ? (
        <EmptyState
          title={getSectionCopy('projects')!.emptyTitle}
          description={getSectionCopy('projects')!.description}
          action={
            <Button size="sm" onClick={() => setOpen(true)}>
              Create your first project
            </Button>
          }
        />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Slug</Th>
              <Th>Org</Th>
              <Th>ID</Th>
            </tr>
          </thead>
          <tbody>
            {projects.data!.data.map((p) => (
              <tr key={p.id} className="hover:bg-muted/30">
                <Td>{p.name}</Td>
                <Td className="font-mono text-xs">{p.slug}</Td>
                <Td className="font-mono text-xs">{p.orgId}</Td>
                <Td className="text-muted-foreground font-mono text-xs">{p.id}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      <NewProjectModal
        open={open}
        onClose={() => setOpen(false)}
        onCreated={() => {
          setOpen(false);
          void projects.refetch();
        }}
      />
    </>
  );
}

function NewProjectModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [orgId, setOrgId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.createProject({
        name: name.trim(),
        slug: slug.trim(),
        orgId: orgId.trim() || undefined,
      });
      setName('');
      setSlug('');
      setOrgId('');
      onCreated();
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
      title="New project"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button form="new-project-form" type="submit" disabled={submitting}>
            {submitting ? 'Creating…' : 'Create project'}
          </Button>
        </>
      }
    >
      <form id="new-project-form" className="space-y-3" onSubmit={onSubmit}>
        <label className="block text-sm">
          <span className="text-muted-foreground text-xs">Name</span>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={120}
            data-testid="new-project-name-input"
          />
        </label>
        <label className="block text-sm">
          <span className="text-muted-foreground text-xs">Slug (lowercase, dashes)</span>
          <Input
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            required
            pattern="^[a-z][a-z0-9-]*$"
            placeholder="my-project"
            data-testid="new-project-slug-input"
          />
        </label>
        <label className="block text-sm">
          <span className="text-muted-foreground text-xs">Org ID (optional if using API key)</span>
          <Input value={orgId} onChange={(e) => setOrgId(e.target.value)} placeholder="org_…" />
        </label>
        {error ? <p className="text-destructive text-xs">{error}</p> : null}
      </form>
    </Modal>
  );
}
