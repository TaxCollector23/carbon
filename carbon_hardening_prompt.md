# Carbon — Remove Facades, Wire Real Backends, Ship Enterprise Features

You are working in the `carbon` pnpm/Turborepo monorepo (apps: `cli`, `api`, `web`, `dashboard`, `docs`, `desktop`; packages: `parser`, `ingestion`, `graph`, `runtime`, `state`, `storage`, `proxy`, `sdk`, `ai`, `workers`, `database`, `types`, `core`, `shared`, `ui`, `config`).

Important context before you start: the backend is more complete than the frontend suggests. `apps/api` already has real, tested routes for projects (`apps/api/src/routes/projects.ts`), snapshots (`apps/api/src/routes/snapshots.ts`), emulators (`apps/api/src/routes/emulators.ts`), API keys with scopes and rotation (`apps/api/src/routes/api-keys.ts`), artifacts (`apps/api/src/routes/artifacts.ts`), jobs (`apps/api/src/routes/jobs.ts`), and ingest (`apps/api/src/routes/ingest.ts`). The database schema (`packages/database/src/schema.ts`) already has `organizations`, `memberships` (with `role` enum `owner | admin | member`), `projects`, `artifacts`, and `apiKeys` tables, and `apps/api/src/routes/project-access.ts` already resolves org-scoped access from either an API key's `orgId` or a Firebase-authenticated user's `orgId`. Do not rebuild these — audit them, harden them, and connect the dashboard to them. The primary failure mode in this repo is a frontend that never calls its own backend, not a missing backend.

Work through the following phases in order. Do not skip ahead to feature work before Phase 1–3 are done — a paid product with a fake dashboard is a liability, not a beta.

## Phase 1 — Kill the dashboard facade

`apps/dashboard/lib/empty-data.ts` currently defines static copy for every section (`projects`, `graphs`, `snapshots`, `recordings`, `state`, `keys`, `settings`, `emulators`, `activity`) and `apps/dashboard/app/[section]/page.tsx` + `apps/dashboard/app/page.tsx` render nothing but that static copy — there is no data fetching anywhere in `apps/dashboard`.

1. Delete the "always show empty state" pattern in `apps/dashboard/lib/empty-data.ts`. Keep the copy strings (title/description) for genuine zero-state UX, but every section must attempt a real fetch first and only fall back to the empty-state copy when the fetch legitimately returns zero rows.
2. Build a typed API client in `apps/dashboard/lib/api-client.ts` that calls the `apps/api` routes listed above (base URL from an env var, e.g. `NEXT_PUBLIC_CARBON_API_URL`), forwarding the Better Auth session (see Phase 2) as credentials.
3. Rewrite `apps/dashboard/app/page.tsx` (Overview) to fetch and render real counts/recent items for projects, snapshots, emulators, and API keys instead of the hardcoded `sections` array.
4. Rewrite `apps/dashboard/app/[section]/page.tsx` per-section:
   - `projects` → list from `GET /v1/projects`, detail view hits the project-by-id route in `apps/api/src/routes/projects.ts`, add a "New project" flow that calls `POST /v1/projects`.
   - `snapshots` → list from the snapshot routes in `apps/api/src/routes/snapshots.ts` (note the `slug`/`name`/`limit` params already defined there), add delete wired to the existing `DELETE` handler.
   - `emulators` → list from `GET /v1/emulators`, add start/stop buttons wired to the existing per-id action routes in `apps/api/src/routes/emulators.ts`, live-poll or use SSE/WebSocket if `apps/workers` exposes one — otherwise poll every 3–5s.
   - `keys` → list/create/revoke wired to `apps/api/src/routes/api-keys.ts` (respect the `admin` scope requirement already enforced there); show the raw key exactly once on creation, never again.
   - `graphs`, `recordings`, `state`, `activity` — audit whether these have real backing today. If they map onto `artifacts`/`ingest`/`jobs` routes, wire them to those. If no real backend exists yet (this appears true for `activity` and possibly `state`), build it — see Phase 3 (event/audit log) and do not leave the section faking data in the meantime; show an honest "not available yet" state instead of fabricated content.
   - `settings` → wire to the `organizations`/`memberships` tables via a new `apps/api/src/routes/organizations.ts` (see Phase 4) instead of remaining a stub.
5. Add loading and error states to every fetch — no silent failures, no infinite spinners.
6. Grep the entire `apps/dashboard` and `apps/web` trees for any other hardcoded arrays that stand in for real data (marketing components like `apps/web/components/dashboard.tsx` are fine to keep illustrative, but anything inside `apps/dashboard` that is not marketing copy must become live data or be explicitly labeled as a placeholder with a tracking TODO and an issue reference).

## Phase 2 — Consolidate authentication to one system

Today `apps/dashboard/lib/auth.ts` runs Better Auth (email/password, Drizzle-backed against `users`/`sessions`/`accounts`/`verifications`) while `apps/api/src/plugins/firebase-auth.ts` verifies Firebase bearer tokens, and `apps/api/src/routes/project-access.ts` already has to reconcile both (`callerOrgId` falls back between an API key's org and a Firebase user's org). This is two identity systems that must agree on "who is this user," and it's a source of subtle auth bugs.

1. Decide and document one system as canonical for human/browser auth. Recommendation: standardize on Better Auth end-to-end since it already owns the dashboard's session and the Drizzle schema — remove the Firebase Admin dependency from `apps/api/src/plugins/firebase-auth.ts` and `apps/api/src/plugins/firebase-auth.test.ts`, and instead have `apps/api` validate Better Auth session tokens directly (Better Auth supports server-side session verification against the same Postgres database both apps already share via `packages/database`).
2. Keep the existing API-key auth path in `apps/api/src/plugins/api-key.ts` untouched — that's correctly scoped for CLI/CI machine callers and should remain separate from human session auth.
3. Update `.env.example` to remove the `FIREBASE_PROJECT_ID` / `FIREBASE_CLIENT_EMAIL` / `FIREBASE_PRIVATE_KEY` block once Firebase is fully removed, and remove the Firebase config wiring in `apps/web/lib/firebase.ts` and the sign-in buttons that reference it.
4. Update `packages/database/src/schema.ts` comments/docs if any reference Firebase, and re-run `apps/api/src/routes/project-access.test.ts` plus `apps/api/src/plugins/scopes.test.ts` after the change to confirm org resolution still works with a single auth source.
5. If you decide to keep Firebase instead (e.g. for social login breadth), do the reverse: drop Better Auth's separate `users`/`sessions` tables and make Firebase UID the single source of identity, with `apps/api` as the sole session-token verifier. Pick one — do not ship both to production.

## Phase 3 — Build the missing activity/audit log (real backend, not a stub)

`activity` in `apps/dashboard/lib/empty-data.ts` currently has no backing table or route at all.

1. Add an `events` table to `packages/database/src/schema.ts`: columns for `id`, `orgId`, `projectId` (nullable), `actorType` (`user | api_key | system`), `actorId`, `action` (e.g. `project.created`, `snapshot.saved`, `emulator.started`, `api_key.created`, `api_key.revoked`), `metadata` (jsonb), `createdAt`. Add a Drizzle migration under `packages/database/migrations/`.
2. Add a small `recordEvent(ctx, event)` helper in `apps/api/src/context.ts` or a new `apps/api/src/services/events.ts`, and call it from every mutating route: `apps/api/src/routes/projects.ts` (create), `apps/api/src/routes/snapshots.ts` (save/restore/delete), `apps/api/src/routes/emulators.ts` (start/stop), `apps/api/src/routes/api-keys.ts` (create/revoke/rotate), `apps/api/src/routes/ingest.ts` (ingest completed).
3. Add `GET /v1/events` (paginated, org-scoped, filterable by `projectId`/`action`) in a new `apps/api/src/routes/events.ts`, guarded by `requireScope('read')` like the other routes.
4. Wire the dashboard `activity` section (Phase 1) to this endpoint with a real timeline UI.
5. This table doubles as the foundation for the Enterprise "audit log" feature in Phase 5 — do not build a second, separate audit system later.

## Phase 4 — Multi-tenant UI + billing (the backend already has org/role scaffolding — surface it and monetize it)

1. Build `apps/api/src/routes/organizations.ts`: `GET /v1/organizations/:id`, `PATCH /v1/organizations/:id`, `GET /v1/organizations/:id/members`, `POST /v1/organizations/:id/members` (invite), `PATCH /v1/organizations/:id/members/:userId` (change role among `owner|admin|member` per the existing enum in `packages/database/src/schema.ts`), `DELETE /v1/organizations/:id/members/:userId`. Enforce that only `owner`/`admin` roles can call the mutating endpoints.
2. Wire `apps/dashboard`'s `settings` section (Phase 1) to these routes: org name/slug editing, a member list with role dropdowns, an invite-by-email flow (send via whatever transactional email you wire up, or at minimum generate an invite link + token stored in a new `invitations` table).
3. Add Stripe billing since none exists today despite the pricing tiers already defined in `apps/web/components/pricing.tsx` ($0 Developer / $29-per-seat Team / Enterprise):
   - Add a `subscriptions` table to `packages/database/src/schema.ts` (`orgId`, `stripeCustomerId`, `stripeSubscriptionId`, `plan`, `status`, `seats`, `currentPeriodEnd`).
   - Add `apps/api/src/routes/billing.ts`: `POST /v1/billing/checkout` (create a Stripe Checkout session for a plan+seat count), `POST /v1/billing/portal` (Stripe customer portal redirect), and a `POST /v1/billing/webhook` handler that verifies the Stripe signature and updates `subscriptions` on `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`.
   - Gate Team-tier dashboard features (member seats beyond 1, shared snapshots/recordings) behind `subscriptions.status === 'active'` and `plan === 'team'`, checked server-side in the relevant routes, not just hidden client-side.
   - Meter usage where it matters for future usage-based add-ons: emulator-minutes and ingest-count are natural metering units given `apps/api/src/services/emulator-registry.ts` and `apps/api/src/routes/ingest.ts` already track this state.

## Phase 5 — Enterprise checkboxes promised on the pricing page

`apps/web/components/pricing.tsx` already advertises "Self-hosted control plane," "SSO and SCIM," "Audit logs, retention controls," "Private storage configuration" on the Enterprise tier. None of these exist yet except private storage config (`packages/storage/src/s3.ts` already supports S3-compatible backends). Build the rest so the pricing page stops overpromising:

1. **Audit logs**: reuse the `events` table from Phase 3; add CSV export (`GET /v1/events/export`) and, if time allows, a webhook sink for SIEM forwarding.
2. **SSO/SCIM**: if you standardized on Better Auth in Phase 2, use its SSO plugin for SAML/OIDC; add a SCIM-compatible provisioning endpoint under `apps/api/src/routes/scim.ts` gated to Enterprise orgs only.
3. **Retention controls**: add an org-level setting (new column on `organizations` in `packages/database/src/schema.ts`) for snapshot/event retention days, and a scheduled job in `apps/workers/src/index.ts` (alongside the existing `apps/workers/src/ingest-worker.ts` pattern) that purges expired snapshots/events.
4. **Self-hosted control plane packaging**: the `docker-compose.yml` at the repo root already exists — turn it into a documented one-command self-host path in `DEPLOY.md`, including a `docker compose -f docker-compose.selfhost.yml up` variant that bundles Postgres/Redis so Enterprise customers are not forced onto Neon/Upstash.

## Phase 6 — Deployment story

`DEPLOY.md` currently admits the Fastify API in `apps/api` cannot run natively on Vercel and recommends running it "from your machine" during early development. That's not viable for a real launch.

1. Pick a real long-running Node target (Fly.io, Render, or Railway are the common low-friction choices for a Fastify service) and write a concrete `DEPLOY.md` section with the actual deploy commands/config for that platform, referencing the existing `apps/api/Dockerfile`.
2. Confirm `apps/api/Dockerfile` and `apps/dashboard/Dockerfile` build cleanly and include the migration step (`pnpm --filter @carbon/database migrate:apply`) as a release step, not a manual instruction buried in prose.
3. Update `.github/workflows/ci.yml` to add a deploy job (gated on `main`) that builds and pushes both Docker images, so shipping isn't a manual `docker build` from a laptop.

## Phase 7 — Test coverage for everything you touch

There are 33 test files today covering parser/runtime/api/state, but the dashboard, most of `apps/web`, and the `packages/ai` providers have none. For every route or table you add or change in Phases 1–5:

1. Add a Vitest test file next to it, following the existing convention (e.g. `apps/api/src/routes/organizations.test.ts` mirroring `apps/api/src/routes/api-keys.test.ts`).
2. Add at least one end-to-end test that exercises the full pipeline: ingest a spec → build the graph → start an emulator → hit it → save a snapshot → restore it → confirm state matches. Put this in `packages/sdk` or `apps/api` tests since the SDK already composes the full pipeline in `packages/sdk/src/index.ts`.
3. Add dashboard tests (React Testing Library or Playwright) that assert each section renders real fetched data, not the static empty-state copy, when the API returns rows — this is the regression test that prevents the facade from silently coming back.

## Constraints while doing all of the above

- Do not introduce a second ORM, a second auth library, or a second job queue — extend what's already in `packages/database`, `apps/dashboard/lib/auth.ts`/`apps/api/src/plugins`, and `apps/workers`.
- Every new mutating route must go through the existing `requireScope(...)` pattern used in `apps/api/src/routes/*.ts` — do not bypass it for convenience.
- Every new table needs a Drizzle migration file under `packages/database/migrations/` plus a matching entry under `packages/database/migrations/meta/` (follow the existing numbered convention, e.g. `0004_...sql`).
- Preserve `CARBON_AUTH_MODE=disabled` dev-mode behavior (`apps/api/src/env.ts`) so local development without Postgres/Redis still works — new features should degrade gracefully in that mode, not hard-crash.
- When a section genuinely has no data yet, show the existing honest empty-state copy from `apps/dashboard/lib/empty-data.ts` — the goal of this prompt is to make empty states _true_ (backed by a real fetch that returned zero rows), not to remove them.

Work phase by phase, run `pnpm typecheck` and `pnpm test` after each phase, and do not move to the next phase until the current one's tests pass.
