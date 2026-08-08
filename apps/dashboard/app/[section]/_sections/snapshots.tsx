'use client';

import { useState } from 'react';
import { Button } from '@carbon/ui';
import { EmptyState, ErrorBanner, Skeleton, Table, Td, Th } from '@/components/ui';
import { api, useProjects, useSnapshots } from '@/lib/hooks/api';
import { ApiError } from '@/lib/api-client';
import { useSelectedProjectSlug } from '@/lib/hooks/use-project-slug';
import { getSectionCopy } from '@/lib/empty-data';

export default function SnapshotsSection() {
  const projects = useProjects();
  const slugs = projects.data?.data?.map((p) => p.slug) ?? [];
  const { slug, setSlug } = useSelectedProjectSlug(slugs);
  const snapshots = useSnapshots(slug);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onDelete(name: string) {
    if (!slug) return;
    if (!confirm(`Delete snapshot "${name}"? This cannot be undone.`)) return;
    setDeleting(name);
    setError(null);
    try {
      await api.deleteSnapshot(slug, name);
      await snapshots.refetch();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setDeleting(null);
    }
  }

  return (
    <>
      <ProjectPicker
        loading={projects.loading}
        error={projects.error}
        slugs={slugs}
        selected={slug}
        onChange={setSlug}
      />

      {!slug ? (
        <EmptyState
          title="Select a project"
          description="Snapshots are stored per project. Create or choose a project above to see its snapshots."
        />
      ) : snapshots.loading ? (
        <div className="space-y-2">
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
      ) : snapshots.error ? (
        <ErrorBanner error={snapshots.error} onRetry={snapshots.refetch} />
      ) : (snapshots.data?.data?.length ?? 0) === 0 ? (
        <EmptyState
          title={getSectionCopy('snapshots')!.emptyTitle}
          description={getSectionCopy('snapshots')!.description}
        />
      ) : (
        <>
          {error ? <ErrorBanner error={error} /> : null}
          <Table>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Size</Th>
                <Th>Modified</Th>
                <Th className="w-32">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {snapshots.data!.data.map((s) => (
                <tr key={s.name} className="hover:bg-muted/30">
                  <Td className="font-mono text-xs">{s.name}</Td>
                  <Td>{formatBytes(s.size)}</Td>
                  <Td>{new Date(s.modifiedAt).toLocaleString()}</Td>
                  <Td>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={deleting === s.name}
                      onClick={() => onDelete(s.name)}
                    >
                      {deleting === s.name ? 'Deleting…' : 'Delete'}
                    </Button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </>
      )}
    </>
  );
}

export function ProjectPicker({
  loading,
  error,
  slugs,
  selected,
  onChange,
}: {
  loading: boolean;
  error: Error | null;
  slugs: string[];
  selected: string | null;
  onChange: (slug: string) => void;
}) {
  if (loading) return <Skeleton className="h-9 w-64" />;
  if (error)
    return (
      <p className="text-destructive text-sm">Could not load projects: {error.message}</p>
    );
  if (slugs.length === 0)
    return (
      <p className="text-muted-foreground text-sm">
        No projects yet — create one on the Projects page first.
      </p>
    );
  return (
    <label className="text-muted-foreground flex items-center gap-2 text-xs">
      Project
      <select
        className="border-border bg-background rounded-md border px-2 py-1 text-sm"
        value={selected ?? ''}
        onChange={(e) => onChange(e.target.value)}
      >
        {slugs.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
    </label>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}
