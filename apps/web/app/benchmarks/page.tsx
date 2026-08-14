import type { Metadata } from 'next';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Nav } from '@/components/nav';
import { Footer } from '@/components/footer';
import { Section, SectionHeading } from '@/components/section';

export const metadata: Metadata = {
  title: 'Live benchmarks — Carbon',
  description:
    'Continuously-updated p50/p95/p99 numbers for Carbon runtime, replayed from the latest benchmark suite.',
};

/**
 * Read benchmarks/results/latest.json at build time. The file lives outside
 * apps/web so we resolve it relative to the repo root; Next includes the
 * repo root in outputFileTracingRoot (see apps/web/next.config.js).
 */
function loadResults(): BenchResults {
  const path = join(process.cwd(), '..', '..', 'benchmarks', 'results', 'latest.json');
  const text = readFileSync(path, 'utf8');
  return JSON.parse(text) as BenchResults;
}

interface BenchResults {
  tool: string;
  generatedAt: string;
  node: string;
  results: {
    snapshot?: {
      totalRows: number;
      snapshotBytes: number;
      restoreMs: { min: number; p50: number; p95: number; max: number };
      samples: readonly number[];
    };
    throughput?: {
      connections: number;
      durationSeconds: number;
      requests: {
        average: number;
        total: number;
        p50: number;
        p90: number;
        p99: number;
      };
      latency: { p50: number; p90: number; p99: number };
      '2xx': number;
      non2xx: number;
    };
    memory?: {
      rowsCreated: number;
      elapsedMs: number;
      deltaBytes: { rss: number; heapUsed: number };
      perRowBytes: { rss: number; heapUsed: number };
    };
    coldStart?: unknown;
  };
}

function fmtNumber(n: number, digits = 0): string {
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(n);
}

function fmtBytes(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(1)} KB`;
  return `${bytes} B`;
}

export default function BenchmarksPage() {
  const results = loadResults();
  const throughput = results.results.throughput;
  const snapshot = results.results.snapshot;
  const memory = results.results.memory;
  return (
    <div className="bg-background text-foreground min-h-dvh">
      <Nav />
      <main id="main" className="pt-16">
        <Section id="live-benchmarks" className="py-24">
          <SectionHeading
            title="Live benchmarks"
            description={`Latest suite run ${new Date(results.generatedAt).toUTCString()} on ${results.node}.`}
            align="center"
          />
          <div className="mx-auto mt-16 grid w-full max-w-5xl gap-8 lg:grid-cols-2">
            {throughput && <ThroughputCard throughput={throughput} />}
            {snapshot && <SnapshotCard snapshot={snapshot} />}
            {memory && <MemoryCard memory={memory} />}
          </div>
        </Section>
      </main>
      <Footer />
    </div>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-border/40 flex items-baseline justify-between border-b py-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono">{value}</span>
    </div>
  );
}

function ThroughputCard({
  throughput,
}: {
  throughput: NonNullable<BenchResults['results']['throughput']>;
}) {
  return (
    <div className="border-border bg-background/40 border-y p-6">
      <h3 className="text-base font-semibold">HTTP throughput</h3>
      <p className="text-muted-foreground mt-1 text-sm">
        {throughput.connections} connections, {throughput.durationSeconds}s window.
      </p>
      <div className="mt-4">
        <StatRow label="Requests/s (mean)" value={fmtNumber(throughput.requests.average)} />
        <StatRow label="Total 2xx" value={fmtNumber(throughput['2xx'])} />
        <StatRow label="Non-2xx" value={fmtNumber(throughput.non2xx)} />
        <StatRow label="Latency p50 (ms)" value={fmtNumber(throughput.latency.p50, 2)} />
        <StatRow label="Latency p90 (ms)" value={fmtNumber(throughput.latency.p90, 2)} />
        <StatRow label="Latency p99 (ms)" value={fmtNumber(throughput.latency.p99, 2)} />
      </div>
    </div>
  );
}

function SnapshotCard({
  snapshot,
}: {
  snapshot: NonNullable<BenchResults['results']['snapshot']>;
}) {
  return (
    <div className="border-border bg-background/40 border-y p-6">
      <h3 className="text-base font-semibold">Snapshot restore</h3>
      <p className="text-muted-foreground mt-1 text-sm">
        {fmtNumber(snapshot.totalRows)} rows / {fmtBytes(snapshot.snapshotBytes)} on disk.
      </p>
      <div className="mt-4">
        <StatRow label="p50 (ms)" value={fmtNumber(snapshot.restoreMs.p50, 2)} />
        <StatRow label="p95 (ms)" value={fmtNumber(snapshot.restoreMs.p95, 2)} />
        <StatRow
          label="min / max"
          value={`${fmtNumber(snapshot.restoreMs.min, 2)} / ${fmtNumber(snapshot.restoreMs.max, 2)}`}
        />
      </div>
      <RestoreSparkline samples={snapshot.samples} />
    </div>
  );
}

function MemoryCard({ memory }: { memory: NonNullable<BenchResults['results']['memory']> }) {
  return (
    <div className="border-border bg-background/40 border-y p-6">
      <h3 className="text-base font-semibold">Memory footprint</h3>
      <p className="text-muted-foreground mt-1 text-sm">
        After creating {fmtNumber(memory.rowsCreated)} rows in {fmtNumber(memory.elapsedMs, 1)} ms.
      </p>
      <div className="mt-4">
        <StatRow label="RSS growth" value={fmtBytes(memory.deltaBytes.rss)} />
        <StatRow label="Heap growth" value={fmtBytes(memory.deltaBytes.heapUsed)} />
        <StatRow label="Per-row RSS" value={fmtBytes(memory.perRowBytes.rss)} />
        <StatRow label="Per-row heap" value={fmtBytes(memory.perRowBytes.heapUsed)} />
      </div>
    </div>
  );
}

/**
 * Minimal inline-SVG sparkline of restoreMs samples — no chart library, no
 * runtime dependency on the client. Fixed viewBox scales gracefully.
 */
function RestoreSparkline({ samples }: { samples: readonly number[] }) {
  if (samples.length < 2) return null;
  const width = 320;
  const height = 60;
  const pad = 4;
  const min = Math.min(...samples);
  const max = Math.max(...samples);
  const range = max - min || 1;
  const step = (width - pad * 2) / (samples.length - 1);
  const points = samples
    .map((s, i) => {
      const x = pad + step * i;
      const y = pad + (1 - (s - min) / range) * (height - pad * 2);
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');
  return (
    <div className="mt-4">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Snapshot restore latency samples"
        className="text-foreground/70 w-full"
        preserveAspectRatio="none"
      >
        <polyline fill="none" stroke="currentColor" strokeWidth="1.5" points={points} />
      </svg>
      <div className="text-muted-foreground mt-1 flex justify-between text-xs">
        <span>{fmtNumber(min, 2)} ms</span>
        <span>{fmtNumber(max, 2)} ms</span>
      </div>
    </div>
  );
}
