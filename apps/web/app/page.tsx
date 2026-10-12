import Link from 'next/link';
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  CircleAlert,
  Copy,
  FileCode2,
  GitCompareArrows,
  Play,
  RotateCcw,
  Terminal,
  X,
} from 'lucide-react';
import { PageTracker } from '@/components/page-tracker';
import { Nav } from '@/components/nav';
import { Wordmark } from '@/components/logo';
import { dashboardSignInUrl } from '@/lib/urls';

const scenarioRows = [
  ['S01', 'HTTP outage', 'GET /billing', '503 · no state mutation'],
  ['S02', 'Rate limit', 'POST /sync', '429 · retry is safe'],
  ['S03', 'Timeout', 'GET /catalog?page=2', 'deadline · baseline restored'],
  ['S04', 'Duplicate webhook', 'POST /webhooks/events', 'one write · event id stable'],
  ['S05', 'Expired auth', 'GET /account', '401 · credentials absent'],
  ['S06', 'Partial sync', 'POST /sync', '503 · partial writes visible'],
];

const workflowRows = [
  ['01', 'Point it at the thing', 'An isolated app, a local runtime, or a behavior graph. Carbon never needs production traffic.'],
  ['02', 'Name the failure', 'Pick the case that matters: outage, delay, duplicate delivery, expired auth, or interrupted sync.'],
  ['03', 'Read the evidence', 'Request, response, state diff, and cleanup are recorded as one reproducible report.'],
];

function FailureLab() {
  return (
    <div className="carbon-v2-lab" aria-label="Demonstration reliability run">
      <div className="carbon-v2-lab-header">
        <div className="carbon-v2-lab-brand"><span className="carbon-v2-live-dot" /> <span>CARBON / FAILURE LAB</span></div>
        <span className="carbon-v2-lab-meta">DEMONSTRATION · LOCAL ONLY</span>
      </div>
      <div className="carbon-v2-lab-run">
        <div><span className="carbon-v2-micro">RUN</span><strong>run_demo_8f2c</strong></div>
        <span className="carbon-v2-fail-tag">FAILED</span>
      </div>
      <div className="carbon-v2-lab-scenario">
        <span className="carbon-v2-micro">SCENARIO / S04</span>
        <h2>duplicate-webhook</h2>
        <p>Replay the same event. Inspect whether the second delivery changes state.</p>
      </div>
      <div className="carbon-v2-lab-rail" aria-hidden="true">
        {['request', 'fault', 'state', 'report'].map((step, index) => <div key={step} className={index === 1 ? 'carbon-v2-rail-step carbon-v2-rail-fault' : 'carbon-v2-rail-step'}><span>{String(index + 1).padStart(2, '0')}</span><b>{step}</b></div>)}
      </div>
      <div className="carbon-v2-lab-event">
        <div className="carbon-v2-event-line"><span className="carbon-v2-method">POST</span><code>/webhooks/events</code><span className="carbon-v2-event-note">same payload × 2</span></div>
        <div className="carbon-v2-event-response"><div><span className="carbon-v2-micro">EXPECTED</span><strong>1 write</strong><small>dedupe by event id</small></div><div className="carbon-v2-actual"><span className="carbon-v2-micro">ACTUAL</span><strong>2 writes</strong><small>deliveries / dlv_02 added</small></div></div>
      </div>
      <div className="carbon-v2-lab-diff"><div><span className="carbon-v2-diff-badge carbon-v2-diff-plus">+</span><code>deliveries/dlv_02</code><span>created</span></div><div><span className="carbon-v2-diff-badge carbon-v2-diff-check">✓</span><code>baseline</code><span>restored</span></div></div>
      <div className="carbon-v2-lab-footer"><span><GitCompareArrows /> 2 snapshots compared</span><span><RotateCcw /> rerunnable</span><code>carbon report run_demo_8f2c</code></div>
    </div>
  );
}

function CommandStrip() {
  return <div className="carbon-v2-command-strip"><div className="carbon-v2-command-cell"><Terminal /><span className="carbon-v2-command-prompt">$</span><code>npx carbon init</code></div><div className="carbon-v2-command-cell"><span className="carbon-v2-command-prompt">$</span><code>carbon test --scenario timeout</code></div><div className="carbon-v2-command-result"><Check /><span>report is ready to rerun</span></div><Copy className="carbon-v2-copy" /></div>;
}

export default function LandingPage() {
  const dashboard = dashboardSignInUrl('/');
  return (
    <div className="carbon-v2-site">
      <PageTracker action="site.view" />
      <Nav />
      <main id="main">
        <section className="carbon-v2-hero" id="top">
          <div className="carbon-v2-shell carbon-v2-hero-grid">
            <div className="carbon-v2-index"><span>CARBON</span><span>RELIABILITY / 01</span><span>SCROLL TO INSPECT ↓</span></div>
            <div className="carbon-v2-hero-copy">
              <p className="carbon-v2-eyebrow">Reliability testing for stateful apps</p>
              <h1>Make the<br /><em>failure visible.</em></h1>
              <p className="carbon-v2-lede">Carbon runs controlled failures against the behavior your app actually has, then shows you what the request changed.</p>
              <div className="carbon-v2-actions"><Link href="/try" className="carbon-v2-button carbon-v2-button-lime" data-track="cta.try">Run the lab <Play /></Link><Link href="#workflow" className="carbon-v2-button carbon-v2-button-line">How it works <ArrowRight /></Link></div>
              <p className="carbon-v2-local-note"><span /> local-first · open source · no production traffic</p>
            </div>
            <div className="carbon-v2-hero-lab"><div className="carbon-v2-lab-caption"><span>THE PRODUCT, NOT A PROMO MOCKUP</span><span>01 — 04</span></div><FailureLab /></div>
          </div>
          <div className="carbon-v2-shell"><CommandStrip /></div>
        </section>

        <section className="carbon-v2-statement">
          <div className="carbon-v2-shell carbon-v2-statement-grid"><p className="carbon-v2-eyebrow">The problem with happy-path tests</p><div><h2>Your users don&apos;t send the request you rehearsed.</h2><p>They retry. They lose auth. They click twice. A dependency stalls halfway through a page. Carbon gives those moments a name, a controlled execution, and evidence you can fix.</p></div></div>
        </section>

        <section className="carbon-v2-scenarios" id="failure-modes">
          <div className="carbon-v2-shell"><div className="carbon-v2-section-head"><div><p className="carbon-v2-eyebrow">Failure library / v0.1</p><h2>Start with the case<br /><em>you keep postponing.</em></h2></div><p>Each scenario is a fault plus an assertion about behavior and data. Change the target, keep the question.</p></div><div className="carbon-v2-scenario-table"><div className="carbon-v2-table-head"><span>id</span><span>failure</span><span>request</span><span>what Carbon checks</span><span>status</span></div>{scenarioRows.map(([id, title, request, outcome]) => <div className="carbon-v2-table-row" key={id}><span className="carbon-v2-row-id">{id}</span><strong>{title}</strong><code>{request}</code><span>{outcome}</span><span className="carbon-v2-row-action"><CircleAlert /> break</span></div>)}</div><Link href="/docs" className="carbon-v2-under-link">Read the scenario contract <ArrowUpRight /></Link></div>
        </section>

        <section className="carbon-v2-workflow" id="workflow">
          <div className="carbon-v2-shell"><div className="carbon-v2-section-head carbon-v2-workflow-head"><div><p className="carbon-v2-eyebrow">One run / four artifacts</p><h2>Not a ping.<br /><em>A trace.</em></h2></div><p>Carbon keeps the request, failure, snapshots, comparison, and cleanup together. The report is the handoff.</p></div><div className="carbon-v2-workflow-list">{workflowRows.map(([number, title, copy]) => <div className="carbon-v2-workflow-row" key={number}><span className="carbon-v2-row-id">{number}</span><h3>{title}</h3><p>{copy}</p><span className="carbon-v2-row-arrow"><ArrowRight /></span></div>)}</div><div className="carbon-v2-evidence-bar"><div><FileCode2 /><span>request + response</span></div><div><GitCompareArrows /><span>state before / after</span></div><div><RotateCcw /><span>reproduction command</span></div><div className="carbon-v2-evidence-pass"><Check /><span>baseline restored</span></div></div></div>
        </section>

        <section className="carbon-v2-cli" id="cli">
          <div className="carbon-v2-shell carbon-v2-cli-grid"><div><p className="carbon-v2-eyebrow">Terminal first</p><h2>Keep the awkward question<br /><em>close to the code.</em></h2><p>Use Carbon from local development or CI. The dashboard reads the same reports; no screenshot or invented metric stands in for the run.</p><Link href="https://github.com/TaxCollector23/carbon" target="_blank" rel="noreferrer" className="carbon-v2-under-link">Explore the source <ArrowUpRight /></Link></div><div className="carbon-v2-code-window"><div className="carbon-v2-code-head"><span>carbon / terminal</span><span>zsh</span></div><div className="carbon-v2-code-body"><p><b>$</b> carbon init</p><p className="carbon-v2-code-dim">wrote carbon.config.ts</p><p><b>$</b> carbon test --scenario duplicate-webhook</p><p className="carbon-v2-code-ok"><Check /> state delta +2 / -0 / ~0</p><p className="carbon-v2-code-fail"><X /> reliability assertion failed</p><p className="carbon-v2-code-dim">report run_01JQ... · carbon report --id run_01JQ...</p><span className="carbon-v2-cursor" /></div></div></div>
        </section>

        <section className="carbon-v2-cta" id="start"><div className="carbon-v2-shell carbon-v2-cta-grid"><div><p className="carbon-v2-eyebrow">Build with evidence</p><h2>Ship the happy path.<br /><em>Prove the rest.</em></h2></div><div className="carbon-v2-cta-actions"><Link href={dashboard} className="carbon-v2-button carbon-v2-button-dark">Open workspace <ArrowRight /></Link><Link href="/docs" className="carbon-v2-button carbon-v2-button-outline">Read docs <ArrowUpRight /></Link></div></div></section>
      </main>
      <footer className="carbon-v2-footer"><div className="carbon-v2-shell carbon-v2-footer-row"><Wordmark /><span>reliability for the code you actually run</span><div><Link href="/docs">Docs</Link><Link href="/changelog">Changelog</Link><Link href="https://github.com/TaxCollector23/carbon" target="_blank" rel="noreferrer">GitHub ↗</Link></div></div></footer>
    </div>
  );
}
