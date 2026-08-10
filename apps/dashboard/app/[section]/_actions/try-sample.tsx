'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@carbon/ui';
import { Modal } from '@/components/ui';
import { api } from '@/lib/hooks/api';
import { ApiError, type SampleSummary } from '@/lib/api-client';

/**
 * "Try a sample" — one-click flow that creates a fresh project on the API
 * from a curated OpenAPI fixture (Stripe, GitHub, etc.), runs ingest
 * synchronously, and drops the user on the new project's snapshots page.
 *
 * The `autoInstantiate` prop wires the marketing gallery's deep link
 * (`/?sample=<id>`) — the button doesn't render UI in that mode, it just
 * fires the mutation and redirects.
 */
export function TrySampleButton({
  size = 'sm',
  autoInstantiate,
  onDone,
}: {
  size?: 'sm' | 'md';
  autoInstantiate?: string | null;
  onDone?: (projectSlug: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [samples, setSamples] = useState<SampleSummary[] | null>(null);
  const [status, setStatus] = useState<
    | { kind: 'idle' }
    | { kind: 'loading' }
    | { kind: 'instantiating'; id: string }
    | { kind: 'error'; message: string }
  >({ kind: 'idle' });
  const router = useRouter();

  async function loadSamples() {
    setStatus({ kind: 'loading' });
    try {
      const res = await api.listSamples();
      setSamples(res.data);
      setStatus({ kind: 'idle' });
    } catch (err) {
      setStatus({ kind: 'error', message: err instanceof ApiError ? err.message : String(err) });
    }
  }

  async function instantiate(id: string) {
    setStatus({ kind: 'instantiating', id });
    try {
      const res = await api.instantiateSample(id);
      onDone?.(res.projectSlug);
      // Land the user on the projects section — the new row will be visible
      // there. A future revision could deep-link to the snapshots section
      // pre-scoped to the fresh project.
      router.push(`/projects?created=${encodeURIComponent(res.projectSlug)}`);
      setOpen(false);
      setStatus({ kind: 'idle' });
    } catch (err) {
      setStatus({ kind: 'error', message: err instanceof ApiError ? err.message : String(err) });
    }
  }

  // Deep-link entry: /?sample=stripe or /projects?sample=stripe
  useEffect(() => {
    if (!autoInstantiate) return;
    void instantiate(autoInstantiate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoInstantiate]);

  useEffect(() => {
    if (open && !samples) void loadSamples();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (autoInstantiate) {
    // Headless mode — no button, just the in-flight indicator so the user
    // sees something is happening after the redirect from the gallery.
    return (
      <div className="text-muted-foreground text-sm">
        {status.kind === 'instantiating'
          ? `Setting up your ${status.id} sample…`
          : status.kind === 'error'
            ? `Failed: ${status.message}`
            : 'Preparing sample…'}
      </div>
    );
  }

  return (
    <>
      <Button size={size} variant="ghost" onClick={() => setOpen(true)} data-testid="try-sample-button">
        Try a sample
      </Button>
      <Modal
        open={open}
        onClose={() => {
          if (status.kind !== 'instantiating') setOpen(false);
        }}
        title="Try a sample API"
        footer={
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={status.kind === 'instantiating'}>
            Close
          </Button>
        }
      >
        <p className="text-muted-foreground mb-4 text-sm">
          One click creates a new project, ingests the curated OpenAPI spec, and lands you
          on the projects list. Nothing leaves your workspace.
        </p>
        {status.kind === 'loading' || !samples ? (
          <p className="text-muted-foreground text-sm">Loading samples…</p>
        ) : (
          <ul className="divide-border divide-y">
            {samples.map((s) => (
              <li key={s.id} className="flex items-start justify-between gap-4 py-3">
                <div className="min-w-0">
                  <div className="text-muted-foreground text-xs uppercase tracking-wider">
                    {s.tag}
                  </div>
                  <div className="mt-0.5 text-sm font-medium">{s.name}</div>
                  <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
                    {s.description}
                  </p>
                  <p className="text-muted-foreground/80 mt-1 text-xs italic">
                    {s.annotations.highlight}
                  </p>
                </div>
                <Button
                  size="sm"
                  onClick={() => void instantiate(s.id)}
                  disabled={status.kind === 'instantiating'}
                  data-testid={`try-sample-${s.id}`}
                >
                  {status.kind === 'instantiating' && status.id === s.id ? 'Setting up…' : 'Use'}
                </Button>
              </li>
            ))}
          </ul>
        )}
        {status.kind === 'error' ? (
          <p className="text-destructive mt-3 text-xs">Failed: {status.message}</p>
        ) : null}
      </Modal>
    </>
  );
}
