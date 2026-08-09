/**
 * Webview HTML for the "Inspect behavior graph" panel. A small three-pane
 * layout — resource list on the left, force-directed SVG in the middle,
 * JSON dump along the bottom. The layout algorithm is copied from
 * apps/dashboard/app/[section]/_sections/graphs-explorer.tsx so the
 * extension has no cross-package UI dependency.
 */

export interface GraphPanelData {
  resources: Array<{ id: string; name: string }>;
  nodes: Array<{ id: string; name: string; readers: number; writers: number }>;
  edges: Array<{ from: string; to: string; kind: string }>;
  transitions: number;
  constraints: number;
  raw: unknown;
}

export function renderGraphHtml(data: GraphPanelData): string {
  const payload = JSON.stringify(data).replace(/</g, '\\u003c');
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  :root { color-scheme: light dark; }
  body { font-family: var(--vscode-font-family, sans-serif); margin: 0; padding: 0; height: 100vh; display: grid; grid-template-columns: 220px 1fr; grid-template-rows: 1fr 200px; }
  #resources { grid-column: 1; grid-row: 1; overflow-y: auto; border-right: 1px solid var(--vscode-panel-border, #4443); padding: 8px; font-size: 12px; }
  #resources h3 { margin: 0 0 6px; font-size: 12px; text-transform: uppercase; opacity: 0.7; }
  #resources ul { list-style: none; margin: 0; padding: 0; }
  #resources li { padding: 3px 4px; cursor: pointer; border-radius: 3px; }
  #resources li:hover, #resources li.active { background: var(--vscode-list-hoverBackground, #8882); }
  #graph { grid-column: 2; grid-row: 1; overflow: hidden; position: relative; }
  #graph svg { width: 100%; height: 100%; display: block; }
  #json { grid-column: 1 / span 2; grid-row: 2; overflow: auto; border-top: 1px solid var(--vscode-panel-border, #4443); padding: 8px; font-family: var(--vscode-editor-font-family, monospace); font-size: 11px; white-space: pre; }
  .node circle { fill: currentColor; fill-opacity: 0.15; stroke: currentColor; stroke-width: 1; }
  .node text { fill: currentColor; font-size: 11px; }
  .edge { stroke: currentColor; stroke-opacity: 0.35; stroke-width: 1; }
  .node.selected circle { fill-opacity: 0.5; }
  #summary { position: absolute; bottom: 4px; right: 8px; font-size: 11px; opacity: 0.7; }
</style>
</head>
<body>
  <div id="resources"><h3>Resources</h3><ul id="reslist"></ul></div>
  <div id="graph"><svg id="svg" viewBox="0 0 720 480"></svg><div id="summary"></div></div>
  <div id="json"></div>
<script>
(function () {
  const data = ${payload};
  const WIDTH = 720, HEIGHT = 480;

  const reslist = document.getElementById('reslist');
  for (const r of data.resources) {
    const li = document.createElement('li');
    li.textContent = r.name;
    li.dataset.id = r.id;
    li.addEventListener('click', () => selectNode(r.id));
    reslist.appendChild(li);
  }

  const nodes = data.nodes.map((n, i) => {
    const angle = (i / Math.max(1, data.nodes.length)) * Math.PI * 2;
    return { ...n, x: WIDTH/2 + Math.cos(angle)*140, y: HEIGHT/2 + Math.sin(angle)*140, vx: 0, vy: 0 };
  });
  const byId = new Map(nodes.map(n => [n.id, n]));
  const edgePairs = data.edges
    .map(e => ({ a: byId.get(e.from), b: byId.get(e.to), kind: e.kind }))
    .filter(p => p.a && p.b);

  const REPULSE=1400, SPRING=0.02, REST=90, DAMP=0.85, CENTER=0.005;
  for (let iter=0; iter<180; iter++) {
    for (const n of nodes) { n.vx += (WIDTH/2 - n.x)*CENTER; n.vy += (HEIGHT/2 - n.y)*CENTER; }
    for (let i=0;i<nodes.length;i++) for (let j=i+1;j<nodes.length;j++) {
      const a=nodes[i], b=nodes[j];
      const dx=a.x-b.x, dy=a.y-b.y, d2=dx*dx+dy*dy+0.01, f=REPULSE/d2, d=Math.sqrt(d2);
      const fx=(dx/d)*f, fy=(dy/d)*f;
      a.vx+=fx; a.vy+=fy; b.vx-=fx; b.vy-=fy;
    }
    for (const {a,b} of edgePairs) {
      const dx=b.x-a.x, dy=b.y-a.y, d=Math.sqrt(dx*dx+dy*dy)+0.01, f=(d-REST)*SPRING;
      const fx=(dx/d)*f, fy=(dy/d)*f;
      a.vx+=fx; a.vy+=fy; b.vx-=fx; b.vy-=fy;
    }
    for (const n of nodes) {
      n.vx*=DAMP; n.vy*=DAMP; n.x+=n.vx; n.y+=n.vy;
      n.x = Math.max(20, Math.min(WIDTH-20, n.x));
      n.y = Math.max(20, Math.min(HEIGHT-30, n.y));
    }
  }

  const svg = document.getElementById('svg');
  const svgns = 'http://www.w3.org/2000/svg';
  for (const {a,b} of edgePairs) {
    const line = document.createElementNS(svgns, 'line');
    line.setAttribute('x1', a.x); line.setAttribute('y1', a.y);
    line.setAttribute('x2', b.x); line.setAttribute('y2', b.y);
    line.setAttribute('class', 'edge');
    svg.appendChild(line);
  }
  const nodeEls = new Map();
  for (const n of nodes) {
    const g = document.createElementNS(svgns, 'g');
    g.setAttribute('class', 'node');
    g.setAttribute('transform', 'translate(' + n.x + ',' + n.y + ')');
    g.dataset.id = n.id;
    const r = 6 + Math.min(12, n.readers + n.writers);
    const c = document.createElementNS(svgns, 'circle');
    c.setAttribute('r', r);
    const t = document.createElementNS(svgns, 'text');
    t.setAttribute('y', r + 12);
    t.setAttribute('text-anchor', 'middle');
    t.textContent = n.name;
    g.appendChild(c); g.appendChild(t);
    g.addEventListener('click', () => selectNode(n.id));
    svg.appendChild(g);
    nodeEls.set(n.id, g);
  }

  document.getElementById('summary').textContent =
    data.nodes.length + ' resources · ' + data.edges.length + ' relationships · ' +
    data.transitions + ' transitions · ' + data.constraints + ' constraints';

  document.getElementById('json').textContent = JSON.stringify(data.raw, null, 2);

  let selected = null;
  function selectNode(id) {
    if (selected) {
      const prev = nodeEls.get(selected);
      if (prev) prev.classList.remove('selected');
      const li = reslist.querySelector('li[data-id="' + cssEscape(selected) + '"]');
      if (li) li.classList.remove('active');
    }
    selected = id;
    const el = nodeEls.get(id);
    if (el) el.classList.add('selected');
    const li = reslist.querySelector('li[data-id="' + cssEscape(id) + '"]');
    if (li) li.classList.add('active');
  }
  function cssEscape(s) { return String(s).replace(/["\\\\]/g, '\\\\$&'); }
})();
</script>
</body>
</html>`;
}
