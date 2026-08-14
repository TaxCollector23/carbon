/**
 * Data for the /vs/[competitor] comparison pages.
 *
 * Rows are intentionally honest — where a competitor has partial support for a
 * capability, we say "partial" and add nuance in `note` so we don't look like
 * we're running a hit piece. Where we're unsure of a capability, we prefer
 * "partial" with a "check docs" note over guessing.
 */

export type Cell = 'yes' | 'no' | 'partial';

export interface CapabilityRow {
  label: string;
  carbon: Cell;
  competitor: Cell;
  note?: string;
}

export interface Competitor {
  slug: string;
  name: string;
  tagline: string;
  lede: string;
  rows: CapabilityRow[];
  whenPickCompetitor: string[];
  whenPickCarbon: string[];
}

const sharedCarbonWins: Pick<CapabilityRow, 'label' | 'carbon'>[] = [
  { label: 'State persistence across requests', carbon: 'yes' },
  { label: 'Snapshots / rewind (state journal)', carbon: 'yes' },
  { label: 'Chaos / failure injection', carbon: 'yes' },
  { label: 'Multi-format ingest (OpenAPI, GraphQL, HAR, Postman, gRPC)', carbon: 'yes' },
  { label: 'Local-first (runs on your laptop)', carbon: 'yes' },
  { label: 'No hosted-service dependency', carbon: 'yes' },
  { label: 'Framework glue (vitest, jest, playwright)', carbon: 'yes' },
  { label: 'Drift detection vs real API', carbon: 'yes' },
];

/**
 * All keys below have been double-checked against public docs at time of
 * writing. When in doubt we mark "partial" and use `note` to point readers at
 * the source of truth rather than pretending to be authoritative.
 */
export const competitors: readonly Competitor[] = [
  {
    slug: 'msw',
    name: 'MSW',
    tagline: 'Mock Service Worker',
    lede:
      'MSW is the de-facto request-mocking library for JavaScript apps. It intercepts fetch/XHR in the browser via a Service Worker and in Node via request-level hooks, and it is excellent for component and unit tests where you want a handful of endpoints stubbed with a couple of lines of code. Carbon plays a different role: it is a real HTTP server that models the whole API and holds state across requests, which is where MSW starts to feel hand-rolled.',
    rows: [
      { label: 'State persistence across requests', carbon: 'yes', competitor: 'partial', note: 'Possible by hand — you write the store yourself inside a handler.' },
      { label: 'Snapshots / rewind (state journal)', carbon: 'yes', competitor: 'no' },
      { label: 'Chaos / failure injection', carbon: 'yes', competitor: 'partial', note: 'You can throw or return a 500 in a handler; no first-class latency/chaos presets.' },
      { label: 'Multi-format ingest (OpenAPI, GraphQL, HAR, Postman, gRPC)', carbon: 'yes', competitor: 'partial', note: 'GraphQL and REST handlers ship in-box; other formats need adapters.' },
      { label: 'Local-first (runs on your laptop)', carbon: 'yes', competitor: 'yes' },
      { label: 'No hosted-service dependency', carbon: 'yes', competitor: 'yes' },
      { label: 'Framework glue (vitest, jest, playwright)', carbon: 'yes', competitor: 'yes' },
      { label: 'Drift detection vs real API', carbon: 'yes', competitor: 'no' },
    ],
    whenPickCompetitor: [
      'You only need to stub a few endpoints inside a browser component test.',
      'You want mocks to live inline with the JS test file, not as a separate process.',
      'Your codebase is already invested in MSW handlers and you like maintaining them by hand.',
    ],
    whenPickCarbon: [
      'You need a real server on a port so non-JS clients (curl, Postman, your Go microservice) can hit it too.',
      'You want state, snapshots, and rewind without writing the store yourself.',
      'You want chaos presets and drift detection out of the box, not as bespoke handler code.',
    ],
  },
  {
    slug: 'wiremock',
    name: 'WireMock',
    tagline: 'JVM-based HTTP mock server',
    lede:
      'WireMock is the incumbent in the JVM world — a mature HTTP mock server with stub mappings, request matching, and record/playback. It has scenarios for stateful flows, which is a step above simple response mocking. Carbon takes a different approach: instead of hand-writing stub mappings and scenario transitions, you point it at a spec and get a stateful server for free.',
    rows: [
      { label: 'State persistence across requests', carbon: 'yes', competitor: 'partial', note: 'Yes via "scenarios" — you define the states and transitions by hand.' },
      { label: 'Snapshots / rewind (state journal)', carbon: 'yes', competitor: 'no' },
      { label: 'Chaos / failure injection', carbon: 'yes', competitor: 'yes', note: 'Fault injection, fixed delays, and random delays are supported.' },
      { label: 'Multi-format ingest (OpenAPI, GraphQL, HAR, Postman, gRPC)', carbon: 'yes', competitor: 'partial', note: 'OpenAPI import exists via extensions; gRPC support is separate. Check WireMock docs.' },
      { label: 'Local-first (runs on your laptop)', carbon: 'yes', competitor: 'yes' },
      { label: 'No hosted-service dependency', carbon: 'yes', competitor: 'yes', note: 'Self-hostable; WireMock Cloud is a separate paid option.' },
      { label: 'Framework glue (vitest, jest, playwright)', carbon: 'yes', competitor: 'partial', note: 'JVM test-framework integrations are first-class; JS glue is thinner.' },
      { label: 'Drift detection vs real API', carbon: 'yes', competitor: 'no' },
    ],
    whenPickCompetitor: [
      'You are on the JVM and want JUnit-native lifecycle helpers.',
      'You already own hand-crafted stub mappings that describe exactly the traffic you want.',
      'You need WireMock-specific features like request-journal proxying against a real backend.',
    ],
    whenPickCarbon: [
      'You do not want to hand-write scenario transitions to get stateful CRUD.',
      'Your team is JS/TS-first and would rather not run a JVM in local dev.',
      'You want snapshots, rewind, and drift detection as primitives, not add-ons.',
    ],
  },
  {
    slug: 'prism',
    name: 'Prism',
    tagline: "Stoplight's OpenAPI mock server",
    lede:
      'Prism turns an OpenAPI spec into a mock server in one command. It is the fastest way to get a spec-driven mock on a port. But Prism is deliberately stateless — POST /pets returns an example, and GET /pets afterwards does not include the pet you just created. Carbon starts from the same spec and models the state so those two calls agree.',
    rows: [
      { label: 'State persistence across requests', carbon: 'yes', competitor: 'no', note: 'Prism responds from spec examples; it does not track created resources.' },
      { label: 'Snapshots / rewind (state journal)', carbon: 'yes', competitor: 'no' },
      { label: 'Chaos / failure injection', carbon: 'yes', competitor: 'partial', note: 'Can return any spec-documented status via the "Prefer" header; not a chaos preset system.' },
      { label: 'Multi-format ingest (OpenAPI, GraphQL, HAR, Postman, gRPC)', carbon: 'yes', competitor: 'partial', note: 'OpenAPI 2/3 only.' },
      { label: 'Local-first (runs on your laptop)', carbon: 'yes', competitor: 'yes' },
      { label: 'No hosted-service dependency', carbon: 'yes', competitor: 'yes' },
      { label: 'Framework glue (vitest, jest, playwright)', carbon: 'yes', competitor: 'partial', note: 'CLI is easy to boot from a test, but no first-party JS test bindings.' },
      { label: 'Drift detection vs real API', carbon: 'yes', competitor: 'partial', note: 'Prism has spec validation of live traffic; not the same as diffing shapes across runs.' },
    ],
    whenPickCompetitor: [
      'You just want to eyeball your OpenAPI spec by hitting it with curl.',
      'Your consumers only need one canned example per endpoint.',
      'You want spec-conformance validation in front of a real backend.',
    ],
    whenPickCarbon: [
      'A POST followed by a GET must return what you just created.',
      'You want to test error paths, latency, and outages without editing the spec.',
      'Your spec is not OpenAPI (GraphQL, HAR, Postman, gRPC).',
    ],
  },
  {
    slug: 'mockoon',
    name: 'Mockoon',
    tagline: 'Desktop mock server with a GUI',
    lede:
      'Mockoon is a lovely desktop app for clicking together a mock API without writing code. Great for demos, prototypes, and hand-off to non-engineers. Carbon aims at the other end of the workflow: mocks that engineers version in git, boot in CI, and drive from a real spec — which is not what a GUI-first tool is built for.',
    rows: [
      { label: 'State persistence across requests', carbon: 'yes', competitor: 'partial', note: 'Has "data buckets" and rule-based responses; full CRUD state is manual to set up.' },
      { label: 'Snapshots / rewind (state journal)', carbon: 'yes', competitor: 'no' },
      { label: 'Chaos / failure injection', carbon: 'yes', competitor: 'partial', note: 'Per-route latency and custom status codes; no unified chaos preset.' },
      { label: 'Multi-format ingest (OpenAPI, GraphQL, HAR, Postman, gRPC)', carbon: 'yes', competitor: 'partial', note: 'OpenAPI import supported; other formats: check Mockoon docs.' },
      { label: 'Local-first (runs on your laptop)', carbon: 'yes', competitor: 'yes' },
      { label: 'No hosted-service dependency', carbon: 'yes', competitor: 'yes', note: 'Mockoon Cloud is optional.' },
      { label: 'Framework glue (vitest, jest, playwright)', carbon: 'yes', competitor: 'partial', note: 'A CLI exists for CI, but there are no first-party test-framework bindings.' },
      { label: 'Drift detection vs real API', carbon: 'yes', competitor: 'no' },
    ],
    whenPickCompetitor: [
      'A designer or PM needs to build a mock without touching a terminal.',
      'You want a portable single-app UI for wiring up demo endpoints.',
      'You are prototyping and never plan to check the mock into a repo.',
    ],
    whenPickCarbon: [
      'The mock has to live in git, be code-reviewable, and boot in CI.',
      'You want the mock built from a spec, not clicked together by hand.',
      'You need snapshots and chaos as first-class primitives, not per-route toggles.',
    ],
  },
  {
    slug: 'postman-mocks',
    name: 'Postman Mocks',
    tagline: 'Hosted mocks tied to a Postman workspace',
    lede:
      'Postman Mocks let you spin up a hosted endpoint from a Postman collection in a few clicks. If your team already lives in Postman, that low-friction start is genuinely useful. Carbon is the opposite kind of tool: it runs on your laptop, has no hosted dependency, and models state instead of returning saved example responses.',
    rows: [
      { label: 'State persistence across requests', carbon: 'yes', competitor: 'no', note: 'Postman Mocks return saved example responses; there is no server-side store.' },
      { label: 'Snapshots / rewind (state journal)', carbon: 'yes', competitor: 'no' },
      { label: 'Chaos / failure injection', carbon: 'yes', competitor: 'partial', note: 'You can save error examples and match them via headers; no chaos presets.' },
      { label: 'Multi-format ingest (OpenAPI, GraphQL, HAR, Postman, gRPC)', carbon: 'yes', competitor: 'partial', note: 'Native to Postman collections; other formats via import.' },
      { label: 'Local-first (runs on your laptop)', carbon: 'yes', competitor: 'no', note: 'Mocks are served from Postman-hosted infrastructure.' },
      { label: 'No hosted-service dependency', carbon: 'yes', competitor: 'no' },
      { label: 'Framework glue (vitest, jest, playwright)', carbon: 'yes', competitor: 'no' },
      { label: 'Drift detection vs real API', carbon: 'yes', competitor: 'no' },
    ],
    whenPickCompetitor: [
      'Your entire team already works in Postman collections.',
      'You need a hosted URL that a coworker or vendor can hit without any install.',
      'You are okay with saved example responses and do not need real state.',
    ],
    whenPickCarbon: [
      'You want mocks that run offline on your laptop with no cloud dependency.',
      'You need the same POST-then-GET to reflect what was just written.',
      'You want the mock to boot inside your test process and be torn down after.',
    ],
  },
];

export function getCompetitor(slug: string): Competitor | undefined {
  return competitors.find((c) => c.slug === slug);
}

export function allCompetitorSlugs(): string[] {
  return competitors.map((c) => c.slug);
}
