'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Button, Input } from '@carbon/ui';
import { EmptyState, ErrorBanner, Modal, Skeleton, Table, Td, Th } from '@/components/ui';
import { useToast } from '@/components/toast';
import { api, useChaosPresets } from '@/lib/hooks/api';
import { useAsync } from '@/lib/hooks/use-async';
import { ApiError, type LoadTestResult } from '@/lib/api-client';
import { getSectionCopy } from '@/lib/empty-data';

const POLL_MS = 4000;

export default function EmulatorsSection() {
  const emulators = useAsync(() => api.listEmulators(), []);
  const toast = useToast();
  const [stopping, setStopping] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [chaosFor, setChaosFor] = useState<string | null>(null);
  const [loadFor, setLoadFor] = useState<string | null>(null);

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
              <Th className="w-64">Actions</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.id} className="hover:bg-muted/30" data-testid="emulator-row">
                <Td className="font-mono text-xs">{e.id}</Td>
                <Td className="font-mono text-xs">{e.projectSlug}</Td>
                <Td>{e.host}</Td>
                <Td>{e.port}</Td>
                <Td>{e.status ?? 'running'}</Td>
                <Td>
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setChaosFor(e.id)}
                      data-testid="emulator-chaos-button"
                    >
                      Chaos
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setLoadFor(e.id)}
                      data-testid="emulator-load-test-button"
                    >
                      Load test
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={stopping === e.id}
                      onClick={() => stop(e.id)}
                    >
                      {stopping === e.id ? 'Stopping…' : 'Stop'}
                    </Button>
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      <ApplyChaosModal
        emulatorId={chaosFor}
        onClose={() => setChaosFor(null)}
        onApplied={(name) => {
          setChaosFor(null);
          toast.push({ kind: 'success', message: `Applied chaos preset "${name}"` });
        }}
        onError={(msg) => toast.push({ kind: 'error', message: msg })}
      />
      <LoadTestModal
        emulatorId={loadFor}
        onClose={() => setLoadFor(null)}
        onError={(msg) => toast.push({ kind: 'error', message: msg })}
        onSuccess={(rps) =>
          toast.push({ kind: 'success', message: `Load test done — ${rps.toFixed(1)} req/s` })
        }
      />
    </>
  );
}

// -----------------------------------------------------------------------------
// Apply chaos preset modal
// -----------------------------------------------------------------------------

function ApplyChaosModal({
  emulatorId,
  onClose,
  onApplied,
  onError,
}: {
  emulatorId: string | null;
  onClose: () => void;
  onApplied: (name: string) => void;
  onError: (message: string) => void;
}) {
  const open = emulatorId !== null;
  const presets = useChaosPresets();
  const [applying, setApplying] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setSelected(null);
      setApplying(null);
    }
  }, [open]);

  const rows = presets.data?.data ?? [];

  async function apply() {
    if (!emulatorId || !selected) return;
    const preset = rows.find((r) => r.id === selected);
    setApplying(selected);
    try {
      const res = await api.applyChaosPreset(emulatorId, selected);
      onApplied(preset?.name ?? res.name);
    } catch (err) {
      onError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setApplying(null);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Apply chaos preset"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={applying !== null}>
            Cancel
          </Button>
          <Button
            onClick={apply}
            disabled={selected === null || applying !== null}
            data-testid="apply-chaos-preset-button"
          >
            {applying ? 'Applying…' : 'Apply preset'}
          </Button>
        </>
      }
    >
      {presets.loading ? (
        <div className="space-y-2">
          <Skeleton className="h-8" />
          <Skeleton className="h-8" />
        </div>
      ) : presets.error ? (
        <ErrorBanner error={presets.error} onRetry={presets.refetch} />
      ) : rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No chaos presets available. Create one from the “Chaos presets” page first.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((p) => (
            <li key={p.id}>
              <label
                className={
                  'border-border hover:bg-muted/30 flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2'
                }
              >
                <input
                  type="radio"
                  name="chaos-preset"
                  value={p.id}
                  checked={selected === p.id}
                  onChange={() => setSelected(p.id)}
                  className="mt-1"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{p.name}</span>
                    {p.builtIn ? (
                      <span className="border-border text-muted-foreground rounded-full border px-1.5 text-[10px] uppercase">
                        built-in
                      </span>
                    ) : null}
                  </div>
                  {p.description ? (
                    <p className="text-muted-foreground mt-0.5 text-xs">{p.description}</p>
                  ) : null}
                  <p className="text-muted-foreground mt-0.5 text-xs">
                    {p.rules.length} rule{p.rules.length === 1 ? '' : 's'}
                  </p>
                </div>
              </label>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

// -----------------------------------------------------------------------------
// Load test modal
// -----------------------------------------------------------------------------

function LoadTestModal({
  emulatorId,
  onClose,
  onError,
  onSuccess,
}: {
  emulatorId: string | null;
  onClose: () => void;
  onError: (message: string) => void;
  onSuccess: (rps: number) => void;
}) {
  const open = emulatorId !== null;
  const [concurrency, setConcurrency] = useState(10);
  const [durationMs, setDurationMs] = useState(3000);
  const [path, setPath] = useState('/');
  const [method, setMethod] = useState('GET');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<LoadTestResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setResult(null);
      setError(null);
      setSubmitting(false);
    }
  }, [open]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!emulatorId) return;
    const cc = Math.max(1, Math.min(1000, Math.floor(concurrency)));
    const dur = Math.max(1, Math.min(60000, Math.floor(durationMs)));
    setSubmitting(true);
    setError(null);
    setResult(null);
    try {
      const r = await api.loadTestEmulator(emulatorId, {
        concurrency: cc,
        durationMs: dur,
        path: path.trim() || '/',
        method: method || 'GET',
      });
      setResult(r);
      onSuccess(r.rps);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : String(err);
      setError(msg);
      onError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Load test emulator"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Close
          </Button>
          <Button
            form="load-test-form"
            type="submit"
            disabled={submitting}
            data-testid="run-load-test-button"
          >
            {submitting ? 'Running…' : result ? 'Run again' : 'Run test'}
          </Button>
        </>
      }
    >
      <form id="load-test-form" className="space-y-3" onSubmit={onSubmit}>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm">
            <span className="text-muted-foreground text-xs">Concurrency (1–1000)</span>
            <Input
              type="number"
              min={1}
              max={1000}
              value={concurrency}
              onChange={(e) => setConcurrency(Number(e.target.value))}
              required
              data-testid="load-test-concurrency-input"
            />
          </label>
          <label className="block text-sm">
            <span className="text-muted-foreground text-xs">Duration ms (1–60000)</span>
            <Input
              type="number"
              min={1}
              max={60000}
              value={durationMs}
              onChange={(e) => setDurationMs(Number(e.target.value))}
              required
              data-testid="load-test-duration-input"
            />
          </label>
          <label className="block text-sm">
            <span className="text-muted-foreground text-xs">Path</span>
            <Input
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="/"
              data-testid="load-test-path-input"
            />
          </label>
          <label className="block text-sm">
            <span className="text-muted-foreground text-xs">Method</span>
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              className="border-input bg-background mt-1 block w-full rounded-md border px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              data-testid="load-test-method-input"
            >
              {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
        </div>
        {error ? <p className="text-destructive text-xs">{error}</p> : null}
      </form>

      {result ? <LoadTestResultPanel result={result} /> : null}
    </Modal>
  );
}

function LoadTestResultPanel({ result }: { result: LoadTestResult }) {
  const cells = useMemo(
    () => [
      { label: 'p50', value: `${result.p50.toFixed(1)} ms` },
      { label: 'p95', value: `${result.p95.toFixed(1)} ms` },
      { label: 'p99', value: `${result.p99.toFixed(1)} ms` },
      { label: 'rps', value: result.rps.toFixed(1) },
      { label: 'error rate', value: `${(result.errorRate * 100).toFixed(2)}%` },
      { label: 'total', value: String(result.totalRequests) },
    ],
    [result],
  );

  return (
    <div className="mt-4 space-y-3" data-testid="load-test-results">
      <div className="grid grid-cols-3 gap-2">
        {cells.map((c) => (
          <div key={c.label} className="border-border rounded-md border px-3 py-2">
            <p className="text-muted-foreground text-[10px] uppercase tracking-wide">{c.label}</p>
            <p className="mt-0.5 font-mono text-sm">{c.value}</p>
          </div>
        ))}
      </div>
      <PercentileChart p50={result.p50} p95={result.p95} p99={result.p99} />
    </div>
  );
}

function PercentileChart({ p50, p95, p99 }: { p50: number; p95: number; p99: number }) {
  const points = [
    { x: 0, label: 'p50', y: p50 },
    { x: 1, label: 'p95', y: p95 },
    { x: 2, label: 'p99', y: p99 },
  ];
  const max = Math.max(1, p50, p95, p99);
  const W = 320;
  const H = 100;
  const padX = 32;
  const padY = 16;
  const innerW = W - padX * 2;
  const innerH = H - padY * 2;
  const toX = (x: number) => padX + (x / 2) * innerW;
  const toY = (y: number) => padY + innerH - (y / max) * innerH;
  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${toX(p.x)} ${toY(p.y)}`).join(' ');

  return (
    <div className="border-border rounded-md border p-3">
      <p className="text-muted-foreground mb-1 text-[10px] uppercase tracking-wide">Latency percentiles</p>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="text-primary h-auto w-full"
        role="img"
        aria-label={`Latency percentiles chart: p50 ${p50.toFixed(1)}ms, p95 ${p95.toFixed(1)}ms, p99 ${p99.toFixed(1)}ms`}
      >
        <line
          x1={padX}
          y1={padY + innerH}
          x2={padX + innerW}
          y2={padY + innerH}
          stroke="currentColor"
          strokeOpacity="0.15"
        />
        <path d={linePath} fill="none" stroke="currentColor" strokeWidth={1.5} />
        {points.map((p) => (
          <g key={p.label}>
            <circle cx={toX(p.x)} cy={toY(p.y)} r={3} fill="currentColor" />
            <text
              x={toX(p.x)}
              y={H - 2}
              textAnchor="middle"
              className="fill-muted-foreground"
              fontSize="10"
            >
              {p.label}
            </text>
            <text
              x={toX(p.x)}
              y={toY(p.y) - 6}
              textAnchor="middle"
              className="fill-foreground"
              fontSize="10"
            >
              {p.y.toFixed(0)}ms
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
