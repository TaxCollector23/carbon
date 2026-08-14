'use client';

import { useCallback, useState } from 'react';
import { Button } from '@carbon/ui';
import { EmptyState, ErrorBanner, Skeleton, Table, Td, Th } from '@/components/ui';
import { useToast } from '@/components/toast';
import { useAsync } from '@/lib/hooks/use-async';
import { api } from '@/lib/hooks/api';
import { ApiError, type FeatureFlag } from '@/lib/api-client';
import { getSectionCopy } from '@/lib/empty-data';

/**
 * Feature-flag override UI. Lists every flag definition returned by the API
 * along with its org-effective value; the toggle upserts a per-org override.
 * User- and plan-scope overrides are surfaced read-only in the description
 * column so an admin can see why a flag is on/off before flipping it.
 */
export default function FeatureFlagsSection() {
  const org = useAsync(async () => {
    try {
      return await api.getCurrentOrganization();
    } catch (err) {
      if (err instanceof ApiError && (err.status === 404 || err.status === 501)) return null;
      throw err;
    }
  }, []);
  const orgId = org.data?.id ?? null;

  const flags = useAsync(async () => {
    try {
      return await api.listFeatureFlags();
    } catch (err) {
      if (err instanceof ApiError && (err.status === 404 || err.status === 501)) return null;
      throw err;
    }
  }, []);

  const toast = useToast();
  const [pending, setPending] = useState<string | null>(null);

  const onToggle = useCallback(
    async (flag: FeatureFlag, next: boolean) => {
      if (!orgId) {
        toast.push({
          kind: 'error',
          message: 'Cannot flip a flag before the current organization is resolved.',
        });
        return;
      }
      setPending(flag.key);
      try {
        await api.setFeatureFlag(flag.key, {
          scope: 'org',
          scopeId: orgId,
          value: next,
        });
        toast.push({
          kind: 'success',
          message: `${flag.key} set to ${String(next)} for this org.`,
        });
        await flags.refetch();
      } catch (err) {
        toast.push({
          kind: 'error',
          message: err instanceof ApiError ? err.message : String(err),
        });
      } finally {
        setPending(null);
      }
    },
    [orgId, toast, flags],
  );

  const rows = flags.data?.data ?? [];
  const notDeployed = flags.data === null && !flags.loading && !flags.error;

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between">
        <p className="text-muted-foreground text-sm">
          {flags.loading ? 'Loading…' : `${rows.length} flag${rows.length === 1 ? '' : 's'}`}
        </p>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void flags.refetch()}
          disabled={flags.loading}
        >
          Refresh
        </Button>
      </header>

      {notDeployed ? (
        <EmptyState
          badge="Optional"
          title="No feature flag service configured"
          description="When this API exposes feature flag definitions, org-level toggles will appear here."
        />
      ) : flags.loading ? (
        <Skeleton className="h-24" />
      ) : flags.error ? (
        <ErrorBanner error={flags.error} onRetry={flags.refetch} />
      ) : rows.length === 0 ? (
        <EmptyState
          title={getSectionCopy('feature-flags')!.emptyTitle}
          description={getSectionCopy('feature-flags')!.description}
        />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Flag</Th>
              <Th>Description</Th>
              <Th className="w-32">Default</Th>
              <Th className="w-32">Effective</Th>
              <Th className="w-24">Org override</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((f) => {
              const orgOverride = f.overrides.find((o) => o.scope === 'org');
              const busy = pending === f.key;
              return (
                <tr key={f.key} className="hover:bg-muted/30">
                  <Td>
                    <code className="text-xs">{f.key}</code>
                  </Td>
                  <Td>
                    <div className="text-sm">{f.description ?? '—'}</div>
                    {f.overrides.length > 0 ? (
                      <div className="text-muted-foreground mt-1 text-xs">
                        {f.overrides
                          .map((o) => `${o.scope}:${o.scopeId}=${String(o.value)}`)
                          .join(', ')}
                      </div>
                    ) : null}
                  </Td>
                  <Td>{String(f.defaultValue)}</Td>
                  <Td>{String(f.effective)}</Td>
                  <Td>
                    <label className="inline-flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        disabled={busy || !orgId}
                        checked={orgOverride ? orgOverride.value : f.effective}
                        onChange={(e) => void onToggle(f, e.target.checked)}
                      />
                      {busy ? 'Saving…' : orgOverride ? 'override' : 'inherit'}
                    </label>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </div>
  );
}
