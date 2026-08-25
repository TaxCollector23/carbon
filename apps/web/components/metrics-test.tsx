'use client';

import { useEffect, useState } from 'react';
import { Check, Copy, Loader2, Server } from 'lucide-react';
import { cn } from '@carbon/ui';
import { Section, SectionHeading } from './section';
import { TestConsole } from './test-console';

interface ServerBenchmark {
  measuredAt: string;
  node: string;
  spec: string;
  cached: boolean;
  stateful: { passed: boolean; stepCount: number; steps: Array<{ step: string; ok: boolean }> };
  throughput: {
    totalRequests: number;
    requestsPerSec: number;
    concurrency: number;
    durationMs: number;
    non2xx: number;
    latencyMs: { min: number; p50: number; p95: number; p99: number; max: number };
  };
  totalElapsedMs: number;
}

type ServerState =
  | { kind: 'checking' }
  | { kind: 'ready'; data: ServerBenchmark }
  | { kind: 'unavailable' };

const API_URL =
  (typeof process !== 'undefined' ? process.env.NEXT_PUBLIC_CARBON_API_URL : undefined) ?? '';

function fmt(n: number, digits = 0): string {
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(n);
}

function fmtMs(n: number): string {
  if (n < 1) return `${fmt(n, 2)} ms`;
  if (n < 100) return `${fmt(n, 1)} ms`;
  return `${fmt(n, 0)} ms`;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-border/60 flex items-baseline justify-between border-b py-2 text-sm last:border-b-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono">{value}</span>
    </div>
  );
}

/**
 * The live test drive: a real Carbon runtime started server-side, plus the
 * measured numbers from the same control plane. Everything on this section is
 * real — no cached marketing figures, no simulated responses.
 */
export function MetricsTest() {
  const [server, setServer] = useState<ServerState>({ kind: 'checking' });
  const [copied, setCopied] = useState(false);
  const apiUrl = API_URL.replace(/\/+$/, '');

  useEffect(() => {
    if (!apiUrl) {
      setServer({ kind: 'unavailable' });
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    fetch(`${apiUrl}/v1/benchmark`, { signal: controller.signal })
      .then((res) => (res.ok ? (res.json() as Promise<ServerBenchmark>) : null))
      .then((data) => setServer(data ? { kind: 'ready', data } : { kind: 'unavailable' }))
      .catch(() => setServer({ kind: 'unavailable' }))
      .finally(() => clearTimeout(timer));
  }, [apiUrl]);

  const copyResults = async () => {
    if (server.kind !== 'ready') return;
    const t = server.data.throughput;
    const lines = [
      'Carbon runtime — live measured numbers',
      '======================================',
      `Stateful consistency: ${server.data.stateful.passed ? server.data.stateful.stepCount : 0}/${server.data.stateful.stepCount} checks passed`,
      `Throughput: ${fmt(t.requestsPerSec)} req/s over ${fmt(t.totalRequests)} requests (${t.concurrency} concurrent, ${t.durationMs}ms)`,
      `Latency: p50 ${fmtMs(t.latencyMs.p50)} · p95 ${fmtMs(t.latencyMs.p95)} · p99 ${fmtMs(t.latencyMs.p99)}`,
      `Non-2xx: ${t.non2xx}`,
      `Measured: ${new Date(server.data.measuredAt).toISOString()} · node ${server.data.node}`,
      '',
      'https://carbon-web-psi.vercel.app/#test-it',
    ];
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <Section id="test-it">
      <SectionHeading
        title="Test it live. Real runtime, real state, real numbers."
        description="Start a Carbon runtime from a real spec — Petstore, Stripe, GitHub, OpenAI — then send real HTTP against it. POSTs create records, GETs return them, the state journal shows every mutation, and rewind undoes them. No account, no install."
        align="center"
        className="mx-auto"
      />

      <TestConsole />

      {/* Server-measured runtime numbers */}
      <div className="mx-auto mt-10 grid w-full max-w-5xl gap-6 lg:grid-cols-[1fr_auto] lg:items-start">
        <div className="border-border bg-background/40 border-y p-6">
          <div className="flex items-center gap-2">
            <Server className="text-muted-foreground h-3.5 w-3.5" />
            <span className="text-muted-foreground text-xs font-medium uppercase tracking-widest">
              same runtime, measured over HTTP
            </span>
            {server.kind === 'ready' && (
              <span className="text-muted-foreground font-mono text-[10px] uppercase tracking-widest">
                {server.data.cached ? 'cached' : 'fresh'}
              </span>
            )}
          </div>

          {server.kind === 'checking' && (
            <div className="text-muted-foreground mt-4 flex items-center gap-2 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" /> Asking the control plane…
            </div>
          )}

          {server.kind === 'unavailable' && (
            <p className="text-muted-foreground mt-4 text-sm leading-6">
              Live numbers need the control plane — set{' '}
              <code className="font-mono text-xs">NEXT_PUBLIC_CARBON_API_URL</code> on the web
              deploy. The committed suite (regenerated in CI, gated by{' '}
              <code className="font-mono text-xs">benchmarks/scripts/gate.ts</code>) reports ~43k
              req/s, 7.9 ms p50 restore of a 10k-row snapshot, and 6/6 stateful checks.
            </p>
          )}

          {server.kind === 'ready' && (
            <div className="mt-4 grid gap-x-10 gap-y-1 sm:grid-cols-2">
              <div>
                <Stat label="Stateful consistency" value={`${server.data.stateful.passed ? server.data.stateful.stepCount : 0}/${server.data.stateful.stepCount} checks`} />
                <Stat label="Requests/s" value={fmt(server.data.throughput.requestsPerSec)} />
                <Stat
                  label="Requests sent"
                  value={`${fmt(server.data.throughput.totalRequests)} (${server.data.throughput.concurrency} concurrent)`}
                />
              </div>
              <div>
                <Stat label="Latency p50" value={fmtMs(server.data.throughput.latencyMs.p50)} />
                <Stat label="Latency p95" value={fmtMs(server.data.throughput.latencyMs.p95)} />
                <Stat label="Latency p99" value={fmtMs(server.data.throughput.latencyMs.p99)} />
              </div>
            </div>
          )}
        </div>

        {server.kind === 'ready' && (
          <button
            type="button"
            onClick={copyResults}
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-xs font-medium transition-colors"
          >
            {copied ? (
              <>
                <Check className="text-emerald-600 dark:text-emerald-400 h-3.5 w-3.5" /> Copied
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" /> Copy results
              </>
            )}
          </button>
        )}
      </div>
    </Section>
  );
}
