'use client';

import { useMemo, useState } from 'react';
import { Button, cn } from '@carbon/ui';
import { EmptyState, ErrorBanner, LoadingRow, Table, Td, Th } from '@/components/ui';
import type {
  SnapshotDiff,
  SnapshotDiffChange,
  SnapshotDiffResourceEntry,
  SnapshotDiffRow,
} from '@/lib/api-client';

/**
 * Right-hand pane of the snapshot compare experience. Given a fetched
 * `SnapshotDiff`, renders a resource sidebar with per-resource change badges
 * and, for the selected resource, three tables (added, removed, changed) with
 * per-field highlights in the "changed" table.
 */
export function SnapshotDiffView({
  diff,
  loading,
  error,
}: {
  diff: SnapshotDiff | null;
  loading: boolean;
  error: Error | string | null;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [showUnchanged, setShowUnchanged] = useState(false);

  const resources = useMemo(() => (diff ? Object.keys(diff.resources).sort() : []), [diff]);

  const activeResource = selected ?? resources[0] ?? null;
  const entry: SnapshotDiffResourceEntry | null =
    diff && activeResource ? (diff.resources[activeResource] ?? null) : null;

  const hasAnyChange =
    !!diff &&
    Object.values(diff.resources).some(
      (r) => r.added.length + r.removed.length + r.changed.length > 0,
    );

  if (loading) return <LoadingRow label="Computing diff" />;
  if (error) return <ErrorBanner error={error} />;
  if (!diff) return null;

  if (!hasAnyChange) {
    return (
      <div
        data-testid="snapshot-diff-view"
        className="rounded-md border border-emerald-500/40 bg-emerald-500/5 px-4 py-8 text-center"
      >
        <h3 className="text-base font-medium text-emerald-500">Snapshots match</h3>
        <p className="text-muted-foreground mt-2 text-sm">
          Every row in <code className="font-mono text-xs">{diff.a.name}</code> is identical to{' '}
          <code className="font-mono text-xs">{diff.b.name}</code>.
        </p>
      </div>
    );
  }

  return (
    <div data-testid="snapshot-diff-view" className="grid gap-4 md:grid-cols-[220px_1fr]">
      <aside className="border-border overflow-hidden rounded-md border">
        <ul className="divide-border divide-y">
          {resources.map((name) => {
            const r = diff.resources[name]!;
            const isActive = name === activeResource;
            return (
              <li key={name}>
                <button
                  type="button"
                  onClick={() => setSelected(name)}
                  className={cn(
                    'flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm',
                    isActive ? 'bg-muted/60' : 'hover:bg-muted/30',
                  )}
                >
                  <span className="font-mono text-xs">{name}</span>
                  <span className="flex gap-1">
                    <CountBadge n={r.added.length} tone="added" />
                    <CountBadge n={r.removed.length} tone="removed" />
                    <CountBadge n={r.changed.length} tone="changed" />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </aside>

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-medium">
            {activeResource ? (
              <>
                Resource <code className="font-mono text-xs">{activeResource}</code>
              </>
            ) : (
              'Select a resource'
            )}
          </h4>
          <label className="text-muted-foreground flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={showUnchanged}
              onChange={(e) => setShowUnchanged(e.target.checked)}
            />
            Show unchanged
          </label>
        </div>

        {entry ? (
          <div className="space-y-4">
            <ChangeTable
              title="Added"
              tone="added"
              rows={entry.added}
              emptyHidden={!showUnchanged}
            />
            <ChangeTable
              title="Removed"
              tone="removed"
              rows={entry.removed}
              emptyHidden={!showUnchanged}
            />
            <ChangedTable changes={entry.changed} emptyHidden={!showUnchanged} />
          </div>
        ) : null}
      </section>
    </div>
  );
}

function CountBadge({ n, tone }: { n: number; tone: 'added' | 'removed' | 'changed' }) {
  if (n === 0) return null;
  const classes = {
    added: 'bg-emerald-500/15 text-emerald-500',
    removed: 'bg-red-500/15 text-red-500',
    changed: 'bg-amber-500/15 text-amber-500',
  }[tone];
  return <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-medium', classes)}>{n}</span>;
}

function ChangeTable({
  title,
  tone,
  rows,
  emptyHidden,
}: {
  title: string;
  tone: 'added' | 'removed';
  rows: readonly SnapshotDiffRow[];
  emptyHidden: boolean;
}) {
  if (rows.length === 0 && emptyHidden) return null;
  const toneClass = tone === 'added' ? 'text-emerald-500' : 'text-red-500';
  return (
    <div>
      <h5 className={cn('mb-2 text-xs font-medium uppercase tracking-wide', toneClass)}>
        {title} ({rows.length})
      </h5>
      {rows.length === 0 ? (
        <p className="text-muted-foreground text-xs">None.</p>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th className="w-40">ID</Th>
              <Th>Data</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <Td className="font-mono text-xs">{r.id}</Td>
                <Td>
                  <pre className="text-muted-foreground max-h-40 overflow-auto text-xs">
                    {JSON.stringify(r.data, null, 2)}
                  </pre>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}

function ChangedTable({
  changes,
  emptyHidden,
}: {
  changes: readonly SnapshotDiffChange[];
  emptyHidden: boolean;
}) {
  if (changes.length === 0 && emptyHidden) return null;
  return (
    <div>
      <h5 className="mb-2 text-xs font-medium uppercase tracking-wide text-amber-500">
        Changed ({changes.length})
      </h5>
      {changes.length === 0 ? (
        <p className="text-muted-foreground text-xs">None.</p>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th className="w-40">ID</Th>
              <Th className="w-40">Field</Th>
              <Th>Before</Th>
              <Th>After</Th>
            </tr>
          </thead>
          <tbody>
            {changes.flatMap((c) =>
              c.changedFields.map((f) => (
                <tr key={`${c.after.id}:${f}`}>
                  <Td className="font-mono text-xs">{c.after.id}</Td>
                  <Td className="font-mono text-xs text-amber-500">{f}</Td>
                  <Td>
                    <ValueCell value={c.before.data[f]} tone="removed" />
                  </Td>
                  <Td>
                    <ValueCell value={c.after.data[f]} tone="added" />
                  </Td>
                </tr>
              )),
            )}
          </tbody>
        </Table>
      )}
    </div>
  );
}

function ValueCell({ value, tone }: { value: unknown; tone: 'added' | 'removed' }) {
  const toneClass =
    tone === 'added' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-red-500/10 text-red-500';
  return (
    <pre className={cn('max-h-32 overflow-auto rounded px-2 py-1 text-xs', toneClass)}>
      {value === undefined ? '—' : JSON.stringify(value, null, 2)}
    </pre>
  );
}
