import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Section, SectionHeading } from './section';

interface BenchResults {
  generatedAt: string;
  node: string;
  results: {
    stateful?: { passed: boolean; stepCount: number };
    snapshot?: {
      totalRows: number;
      restoreMs: { p50: number; p95: number };
    };
    throughput?: {
      connections: number;
      durationSeconds: number;
      requests: { average: number; total: number };
      '2xx': number;
      non2xx: number;
    };
    memory?: {
      rowsCreated: number;
      elapsedMs: number;
      deltaBytes: { rss: number; heapUsed: number };
    };
  };
}

function loadResults(): BenchResults | null {
  try {
    const path = join(process.cwd(), '..', '..', 'benchmarks', 'results', 'latest.json');
    return JSON.parse(readFileSync(path, 'utf8')) as BenchResults;
  } catch {
    return null;
  }
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

export function Benchmarks() {
  const results = loadResults();
  const stateful = results?.results.stateful;
  const snapshot = results?.results.snapshot;
  const throughput = results?.results.throughput;
  const memory = results?.results.memory;
  const rows = [
    stateful
      ? {
          metric: 'Stateful consistency',
          value: stateful.passed
            ? `${stateful.stepCount}/${stateful.stepCount} checks`
            : 'needs review',
          note: 'create, read-after-create, update, read-after-update, delete, read-after-delete',
        }
      : null,
    snapshot
      ? {
          metric: `${fmtNumber(snapshot.totalRows)} row snapshot restore`,
          value: `${fmtNumber(snapshot.restoreMs.p50, 2)} ms p50`,
          note: `${fmtNumber(snapshot.restoreMs.p95, 2)} ms p95 from the committed snapshot harness`,
        }
      : null,
    throughput
      ? {
          metric: 'HTTP runtime throughput',
          value: `${fmtNumber(throughput.requests.average)} req/s`,
          note: `${throughput.connections} connections for ${throughput.durationSeconds}s, ${fmtNumber(throughput['2xx'])} 2xx responses, ${throughput.non2xx} non-2xx`,
        }
      : null,
    memory
      ? {
          metric: `Memory after ${fmtNumber(memory.rowsCreated)} writes`,
          value: `${fmtBytes(memory.deltaBytes.heapUsed)} heap`,
          note: `${fmtBytes(memory.deltaBytes.rss)} RSS growth in ${fmtNumber(memory.elapsedMs, 1)} ms`,
        }
      : null,
  ].filter((row): row is { metric: string; value: string; note: string } => Boolean(row));

  return (
    <Section id="benchmarks">
      <div className="grid gap-12 lg:grid-cols-[0.85fr_1.15fr] lg:items-start">
        <SectionHeading
          title="Measured proof, not comparison theater."
          description="The benchmark suite checks the thing Carbon has to get right: writes change future reads, snapshots restore quickly, and the runtime stays fast enough for CI."
        />
        <div>
          <div className="border-border overflow-x-auto border-y">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-border text-muted-foreground border-b text-left">
                  <th className="px-4 py-4 font-medium">Metric</th>
                  <th className="text-foreground px-4 py-4 text-left font-medium">Latest run</th>
                  <th className="px-4 py-4 text-left font-medium">What it means</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={row.metric} className="border-border border-b last:border-b-0">
                    <td className="px-4 py-3.5 font-medium">{row.metric}</td>
                    <td className="text-foreground px-4 py-3.5 font-mono">{row.value}</td>
                    <td className="text-muted-foreground px-4 py-3.5">{row.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-muted-foreground mt-6 text-xs leading-6">
            Harness in <code className="text-foreground font-mono">benchmarks/</code>, methodology
            committed to the repo. Latest run{' '}
            {results
              ? `${new Date(results.generatedAt).toUTCString()} on ${results.node}`
              : 'not available'}
            .
          </p>
        </div>
      </div>
    </Section>
  );
}
