'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

interface GraphResponse {
  projectId: string;
  irId?: string;
  nodes: Array<{ id: string; name: string; readers: number; writers: number }>;
  edges: Array<{ from: string; to: string; kind: string }>;
  transitions: number;
  constraints: number;
}

interface LaidOutNode {
  id: string;
  name: string;
  readers: number;
  writers: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

const WIDTH = 720;
const HEIGHT = 480;

/**
 * Interactive graph explorer. Small hand-rolled force-directed layout
 * (spring edges + repulsive nodes) rather than pulling in d3/cytoscape.
 * A few hundred nodes still settle in under 200 iterations.
 */
export function GraphsExplorer({
  projectSlug,
  apiBase = process.env.NEXT_PUBLIC_CARBON_API_BASE ?? 'http://localhost:4000',
}: {
  projectSlug: string;
  apiBase?: string;
}) {
  const [data, setData] = useState<GraphResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${apiBase}/v1/projects/${encodeURIComponent(projectSlug)}/graph`, {
      credentials: 'include',
    })
      .then(async (r) => {
        if (!r.ok) throw new Error(`${r.status}`);
        return (await r.json()) as GraphResponse;
      })
      .then((json) => {
        if (!cancelled) setData(json);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [projectSlug, apiBase]);

  const laidOut = useMemo(() => (data ? layout(data) : null), [data]);

  if (error) return <p className="text-sm text-red-600">Failed to load graph: {error}</p>;
  if (!data) return <p className="text-muted-foreground text-sm">Loading graph…</p>;
  if (data.nodes.length === 0)
    return <p className="text-muted-foreground text-sm">Graph is empty — ingest a spec first.</p>;

  return (
    <div className="border-border overflow-hidden rounded-md border">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label="Behavior graph"
        className="h-[480px] w-full bg-transparent"
      >
        {laidOut!.edges.map((e, i) => (
          <line
            key={i}
            x1={e.x1}
            y1={e.y1}
            x2={e.x2}
            y2={e.y2}
            stroke="currentColor"
            strokeOpacity={0.35}
            strokeWidth={1}
          />
        ))}
        {laidOut!.nodes.map((n) => (
          <NodeDot key={n.id} node={n} />
        ))}
      </svg>
      <div className="text-muted-foreground border-border border-t px-3 py-1.5 text-xs">
        {data.nodes.length} resources · {data.edges.length} relationships · {data.transitions}{' '}
        transitions · {data.constraints} constraints
      </div>
    </div>
  );
}

function NodeDot({ node }: { node: LaidOutNode }) {
  const ref = useRef<SVGGElement>(null);
  const r = 6 + Math.min(12, node.readers + node.writers);
  return (
    <g ref={ref} transform={`translate(${node.x}, ${node.y})`}>
      <circle r={r} fill="currentColor" fillOpacity={0.15} stroke="currentColor" />
      <text y={r + 12} textAnchor="middle" fontSize={11} fill="currentColor" fillOpacity={0.85}>
        {node.name}
      </text>
    </g>
  );
}

function layout(data: GraphResponse) {
  const nodes: LaidOutNode[] = data.nodes.map((n, i) => {
    const angle = (i / data.nodes.length) * Math.PI * 2;
    return {
      ...n,
      x: WIDTH / 2 + Math.cos(angle) * 120,
      y: HEIGHT / 2 + Math.sin(angle) * 120,
      vx: 0,
      vy: 0,
    };
  });
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edgePairs = data.edges
    .map((e) => ({ a: byId.get(e.from), b: byId.get(e.to) }))
    .filter((p): p is { a: LaidOutNode; b: LaidOutNode } => !!(p.a && p.b));

  const REPULSE = 1400;
  const SPRING = 0.02;
  const REST = 90;
  const DAMP = 0.85;
  const CENTER = 0.005;

  for (let iter = 0; iter < 180; iter++) {
    for (const n of nodes) {
      n.vx += (WIDTH / 2 - n.x) * CENTER;
      n.vy += (HEIGHT / 2 - n.y) * CENTER;
    }
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i]!;
        const b = nodes[j]!;
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const d2 = dx * dx + dy * dy + 0.01;
        const f = REPULSE / d2;
        const d = Math.sqrt(d2);
        const fx = (dx / d) * f;
        const fy = (dy / d) * f;
        a.vx += fx;
        a.vy += fy;
        b.vx -= fx;
        b.vy -= fy;
      }
    }
    for (const { a, b } of edgePairs) {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.sqrt(dx * dx + dy * dy) + 0.01;
      const f = (d - REST) * SPRING;
      const fx = (dx / d) * f;
      const fy = (dy / d) * f;
      a.vx += fx;
      a.vy += fy;
      b.vx -= fx;
      b.vy -= fy;
    }
    for (const n of nodes) {
      n.vx *= DAMP;
      n.vy *= DAMP;
      n.x += n.vx;
      n.y += n.vy;
      n.x = Math.max(20, Math.min(WIDTH - 20, n.x));
      n.y = Math.max(20, Math.min(HEIGHT - 30, n.y));
    }
  }

  const edges = edgePairs.map(({ a, b }) => ({
    x1: a.x,
    y1: a.y,
    x2: b.x,
    y2: b.y,
  }));
  return { nodes, edges };
}
