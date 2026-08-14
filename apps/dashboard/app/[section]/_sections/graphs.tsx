'use client';

import { EmptyState, ErrorBanner, Skeleton, Table, Td, Th } from '@/components/ui';
import { useArtifacts, useProjects } from '@/lib/hooks/api';
import { useSelectedProjectSlug } from '@/lib/hooks/use-project-slug';
import { ApiError } from '@/lib/api-client';
import { getSectionCopy } from '@/lib/empty-data';
import { ProjectPicker } from './snapshots';

/**
 * Graphs are stored as artifacts with kind='graph'. We read the artifact
 * listing and filter — no dedicated /graphs route exists.
 */
export default function GraphsSection() {
  const projects = useProjects();
  const slugs = projects.data?.data?.map((p) => p.slug) ?? [];
  const { slug, setSlug } = useSelectedProjectSlug(slugs);
  const artifacts = useArtifacts(slug);

  const notDeployed =
    artifacts.error instanceof ApiError &&
    (artifacts.error.status === 404 || artifacts.error.status === 501);

  const graphs = (artifacts.data?.data ?? []).filter((a) => a.kind === 'graph');

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
        <EmptyState title="Select a project" description="Graphs are stored per project." />
      ) : artifacts.loading ? (
        <div className="space-y-2">
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
      ) : notDeployed ? (
        <EmptyState
          badge="Connect storage"
          title={getSectionCopy('graphs')!.emptyTitle}
          description={getSectionCopy('graphs')!.description}
        />
      ) : artifacts.error ? (
        <ErrorBanner error={artifacts.error} onRetry={artifacts.refetch} />
      ) : graphs.length === 0 ? (
        <EmptyState
          title={getSectionCopy('graphs')!.emptyTitle}
          description={getSectionCopy('graphs')!.description}
        />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Graph ID</Th>
              <Th>Size</Th>
              <Th>Modified</Th>
            </tr>
          </thead>
          <tbody>
            {graphs.map((g) => (
              <tr key={g.id}>
                <Td className="font-mono text-xs">{g.id}</Td>
                <Td>{g.size} B</Td>
                <Td>{new Date(g.modifiedAt).toLocaleString()}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
