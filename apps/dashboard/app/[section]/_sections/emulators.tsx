'use client';

import { useEffect, useState } from 'react';
import { Button } from '@carbon/ui';
import { EmptyState, ErrorBanner, Skeleton, Table, Td, Th } from '@/components/ui';
import { api } from '@/lib/hooks/api';
import { useAsync } from '@/lib/hooks/use-async';
import { ApiError } from '@/lib/api-client';
import { getSectionCopy } from '@/lib/empty-data';

const POLL_MS = 4000;

export default function EmulatorsSection() {
  const emulators = useAsync(() => api.listEmulators(), []);
  const [stopping, setStopping] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Live-poll every 4s while the tab is open — cheap and mirrors what a
  // "top" style panel would show. On unmount, useAsync's generation counter
  // discards any in-flight fetch.
  useEffect(() => {
    const id = window.setInterval(() => {
      void emulators.refetch();
    }, POLL_MS);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function stop(id: string) {
    if (!confirm(`Stop emulator ${id}?`)) return;
    setStopping(id);
    setActionError(null);
    try {
      await api.stopEmulator(id);
      await emulators.refetch();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setStopping(null);
    }
  }

  const rows = emulators.data?.data ?? [];

  return (
    <>
      <header className="flex items-center justify-between">
        <p className="text-muted-foreground text-sm">
          {emulators.loading ? 'Loading…' : `${rows.length} running · polling every ${POLL_MS / 1000}s`}
        </p>
      </header>

      {actionError ? <ErrorBanner error={actionError} /> : null}

      {emulators.loading && rows.length === 0 ? (
        <div className="space-y-2">
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
      ) : emulators.error ? (
        <ErrorBanner error={emulators.error} onRetry={emulators.refetch} />
      ) : rows.length === 0 ? (
        <EmptyState
          title={getSectionCopy('emulators')!.emptyTitle}
          description={getSectionCopy('emulators')!.description}
        />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>ID</Th>
              <Th>Project</Th>
              <Th>Host</Th>
              <Th>Port</Th>
              <Th>Status</Th>
              <Th className="w-24">Actions</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.id} className="hover:bg-muted/30">
                <Td className="font-mono text-xs">{e.id}</Td>
                <Td className="font-mono text-xs">{e.projectSlug}</Td>
                <Td>{e.host}</Td>
                <Td>{e.port}</Td>
                <Td>{e.status ?? 'running'}</Td>
                <Td>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={stopping === e.id}
                    onClick={() => stop(e.id)}
                  >
                    {stopping === e.id ? 'Stopping…' : 'Stop'}
                  </Button>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
