# Carbon product plan

The gap between "an impressive repo" and "a real product" is not features —
it is **users, a funnel, and a paid loop**. Carbon's engineering is already
ahead of its product: the CLI, runtime, control plane, billing, SSO/SCIM,
and dashboard are real and tested. What does not exist yet is evidence that
people use it, a self-serve activation path that converts visitors into
weekly-active developers, and paying teams. This plan closes that gap in
stages, each with a measurable exit criterion.

## Where we are today (audited from the repo)

**Real and shipped:**
- **CLI** (`carbon-api` on npm, `npx`, standalone binaries, Homebrew, `install.sh`): 30+ commands — `ingest`, `emulate`, `test`, `ci`, `diff`, `explain`, `record`, `replay`, `snapshot`, `doctor`, `quality`, `generate-tests`, `capabilities`.
- **Engine**: 8 format adapters (OpenAPI, AsyncAPI, GraphQL, protobuf, gRPC, HAR, Postman, traffic) → IR → behavior graph → stateful HTTP runtime with snapshots, journal/rewind, chaos plugins, assertions, drift detection, and an AI inference + AI-judge pipeline.
- **Control plane** (`apps/api`, 122 route files, 315 tests): projects, snapshots, emulators, API keys, artifacts, jobs, ingest, orgs/roles, events/audit log, **Stripe billing**, **SSO**, **SCIM**, Slack, share-links, search, quota, leads.
- **Surfaces**: marketing site with live-benchmark hero stats, `/try` browser playground, **`#test-it` live test-drive console (real server-side runtime, request builder, state journal, rewind — public `/v1/sandbox` API)**, server-measured benchmark strip, docs on GitHub Pages, desktop app (Tauri), Python client, SDK, GitHub Actions CI with benchmark gates.
- **Distribution inventory**: npm, PyPI, Homebrew, binaries, `install.sh`, Vercel + Fly.io deploy paths, self-host docker-compose.

**Missing (the product work):**
- Users. There are no testimonials, usage numbers, or case studies anywhere.
- A measured funnel. Nothing records visitor → install → first emulator → team.
- A self-serve paid loop. Stripe is wired but no team has ever gone through it.
- The open-core decision (the single biggest distribution lever available).

## North star and principles

**North star metric: weekly active emulators** — the number of distinct
developers who booted a Carbon replica in the last 7 days. It captures
activation (emulators booted), habit (weekly), and the product's core
promise (replicas).

**Principles (non-negotiables):**
1. **Free local forever.** The CLI, all 8 adapters, local snapshots, and chaos are free. Charging for the local runtime teaches users to fork rather than pay.
2. **Pay for staleness anxiety.** Pro gates on drift detection ("does my mock still match reality?"), the day-two solo-dev pain. Team gates on shared state. Enterprise gates on compliance.
3. **Honest numbers only.** Every metric on the site is either measured live (the `#test-it` section, hero stats from the committed suite) or clearly labeled. No fabricated benchmarks, no fake empty states.
4. **Activation in under 60 seconds.** Visitor → running replica must take one click or one command, no signup.
5. **Spec in, replica out.** Everything flows through parse → IR → graph → runtime. No bespoke product paths.

## Phase A — Launch and activation (weeks 1–2)

**Goal: a Reddit/HN post lands on a page that proves the product in 60 seconds.**

- [x] `#test-it` landing section, now a **live test-drive console**: pick a sample (Petstore/Stripe/GitHub/OpenAI/Twilio/Shopify), start a real server-side runtime, send real HTTP through the API's proxy, watch the real state journal (with rewind/snapshot/reset), copy curl, plus server-measured benchmark numbers. (`apps/web/components/test-console.tsx` + `metrics-test.tsx`)
- [x] Public sandbox API: `POST /v1/sandbox` boots a real runtime from a bundled sample; every method under `/v1/sandbox/:id/*` (including `/__carbon/state/*`) proxies to it over real HTTP. Bounded (16 concurrent), TTL-evicted (15 min), per-IP rate-limited, no auth, no DB. (`apps/api/src/routes/sandbox.ts` + `services/sandbox-registry.ts`)
- [x] `GET /v1/benchmark` public endpoint: boots the real runtime, measures stateful consistency + throughput over HTTP, cached 30s, rate-limited. (`apps/api/src/routes/benchmark.ts`)
- [x] Web app deployed to Vercel (`carbon-web-psi.vercel.app`) — live, `#test-it` section serving, honest fallback while the API is offline.
- [ ] Wire `NEXT_PUBLIC_CARBON_API_URL` on the Vercel web deploy so the console and benchmark card show live numbers. **Blocked on API hosting** — needs Neon `DATABASE_URL` + Upstash `REDIS_URL` + a Fly.io account; `scripts/deploy-api.sh` does the rest in one command.
- [x] Funnel instrumented end-to-end: `anonymous_events` table + migration 0014, public `POST /v1/track` (rate-limited, hashed-IP), and click/page events on `/try`, `#test-it`, gallery, benchmarks, hero and nav CTAs. Inert until the API is deployed (no-op when `NEXT_PUBLIC_CARBON_API_URL` is unset).
- [ ] Launch posts: Show HN + r/programming + r/node with the `#test-it` link and a copy-results proof block. Use the draft in `MARKETING.md`.
- [ ] Sample gallery deep-links into the dashboard (auth-gated). Once sandboxing ships per-sample, add "Test in browser" buttons on `/emulators/:slug` that open the console pre-selected.
- **Exit criterion:** 500 visitors to `#test-it`, 100 installs, 20 first emulators, funnel events flowing.

## Phase B — Product-market fit loop (weeks 3–10)

**Goal: convert the spike into a repeatable loop and find the wedge that sticks.**

1. **Concierge onboarding (the "do things that don't scale" phase).** Personally onboard the first 20 teams: ingest their real spec, set up their CI, save their first snapshot. Every call produces a quote-worthy testimonial and a bug list. This is the highest-ROI activity for both PMF and the YC application.
2. **Distribution inside the dev loop (build these — all specced in `future_ideas_list.json`):**
   - **GitHub Action**: spin a per-PR replica, comment with the inspect link, tear down on close. Every PR becomes a Carbon ad.
   - **VS Code extension**: `carbon emulate` + graph browsing without leaving the editor.
   - **"Run in Carbon" badge + shareable read-only replica links**: API authors embed a badge in their README; prospects poke a live replica with no CLI.
3. **Make the paid aha self-serve.** The drift engine shipped: `carbon replay <recording> --target <real-api> --mode drift --ignore ...` now compares JSON structurally (types, numeric values, missing fields; null≈omitted; `--ignore` for volatile fields) and exits non-zero on divergence (`apps/cli/src/lib/drift.ts`, 15 unit tests, docs updated). Remaining: scheduled drift runs (cron/GitHub Action) → alert on divergence (email/Slack/webhook delivery already exists). That alert moment is the upgrade trigger.
4. **Retention loop:** snapshot sharing between teammates, team workspaces, Slack alerts on drift/emulator crashes. Retention > acquisition once the loop exists.
5. **Weekly metrics review.** Activation %, WAU, D7 retention, free→trial %, trial→paid %. Dashboard page over the existing usage/events data (the raw signals already exist in `apps/api`).
- **Exit criterion:** 25 weekly-active teams, D7 retention > 20%, 5 paying teams, 10 named testimonials.

## Phase C — Monetization hardening (weeks 8–14)

**Goal: the pricing page stops overpromising and starts collecting money.**

1. **Verify the Stripe loop end-to-end** (routes and tests exist): checkout → webhook → plan gate → seat metering. Run one real paying team through it before scaling.
2. **Enforce plan ceilings server-side** (emulator count, ingest quota, retention, seats). Some ceilings exist (`PLAN_EMULATOR_CEILING`, quota routes); make every Team-tier feature gate on `subscriptions.status === 'active'`.
3. **Meter usage**: emulator-minutes and ingest count as the usage-based add-ons. The registry and ingest routes already track both.
4. **Enterprise packaging**: `docker-compose.selfhost.yml` + `DEPLOY.md` section (self-host one-command), SSO/SCIM (built), audit export + SIEM webhook (built). Turn these into a sales deck and a 30-day trial flow instead of a contact-us form.
5. **Decide open-core (recommended): MIT/Apache the core `parser` + `graph` + `runtime` + `state`, keep the control plane proprietary.** This turns the repo into a distribution channel — every `npm i carbon-api` in a CI pipeline is marketing — and gives YC the "OSS engine + paid cloud" story it funds best. It also answers the moat question honestly.
- **Exit criterion:** MRR > $1k from ≥ 3 teams, trial→paid ≥ 25%, open-core decision made and executed.

## Phase D — Scale and team (quarter 2)

**Goal: the product survives real teams and a real company.**

1. **Emulator isolation**: move long-lived emulators behind a worker/child-process boundary with quotas, idle eviction, and per-emulator telemetry (the registry interface already anticipates this).
2. **Reliability**: resumable ingestion with content-addressed artifacts, contract tests generated from the OpenAPI doc, signed binaries, performance-budget regression publishing.
3. **Team**: first hire (engineer or sales-engineer), founder-led sales motion, YC application for the next window (applications open ~Nov 2026 — see YC plan).
4. **Community**: public Discord, weekly office hours where Carbon is demoed against a new famous API, spec gallery contributions.

## The scoreboard (metrics that matter)

| Metric | Where it lives | Target |
|---|---|---|
| Activation (visitor → first emulator) | events + usage | < 2 min, > 10% of installs |
| Weekly active emulators | usage metering | 25 teams by end of Phase B |
| D7 retention | events | > 20% |
| Free → Pro trial | billing routes | > 3% |
| Trial → paid | billing routes | > 25% |
| Install → signup | events | > 5% |
| Benchmarks stay green | `benchmarks/scripts/gate.ts` | always |

## Risks

1. **Crowded category** (MSW, WireMock, Prism, Mockoon). Mitigation: the stateful wedge ("writes change future reads") + the agent-sandbox positioning for YC — every AI agent needs a deterministic, free API sandbox.
2. **Solo founder.** Mitigation: find a technical co-founder or first hire before the YC window; the repo's velocity (117 commits in 10 days) is the recruiting story.
3. **No community flywheel.** Mitigation: the open-core decision in Phase C; public gallery; GitHub Action; Run-in-Carbon badge.
4. **Enterprise overpromising.** Mitigation: pricing-page features are real (SSO/SCIM/audit/self-host exist) — the remaining work is packaging, not building.
5. **Benchmark credibility.** Mitigation: everything is measured (`#test-it`, `latest.json`, gate.ts) — keep it that way; a fake number here would kill the launch.

## Definition of done — "Carbon is a real product"

- 25 weekly-active teams, 5+ paying, D7 > 20%.
- Visitor → running replica in under 2 minutes, measured.
- Every pricing-page claim has a working, tested backend path.
- One named team publicly says "we replaced our mocks with Carbon."
- Open-core decision made; the repo is a distribution channel, not a landing page.
- YC application submitted for the next window with a growth chart, not a feature list.
