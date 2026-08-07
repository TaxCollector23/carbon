# Deploying Carbon Without Render

This repo now uses one public web URL for the landing page, dashboard, and
benchmarks:

- `/` landing
- `/dashboard` Firebase-gated dashboard
- `/benchmarks` benchmark methodology

The no-Render free-tier setup is:

| Piece           | Provider                | Notes                                           |
| --------------- | ----------------------- | ----------------------------------------------- |
| Web + dashboard | Vercel                  | One project, root directory `apps/web`          |
| API             | Node runtime            | Fastify service in `apps/api`; see notes below  |
| Postgres        | Neon                    | Durable control-plane data                      |
| Redis           | Upstash                 | Async jobs, rate limits, idempotency            |
| Object storage  | Cloudflare R2, optional | Durable artifacts when local disk is not enough |

Postgres and Redis still need managed services. Putting them inside a free web
deployment would lose data on redeploys and restarts.

## API + Workers

The backend is a Fastify Node service in `apps/api`. Keep it as a real Node
process when you need public API traffic, because it owns API-key auth,
idempotency, rate limits, ingestion, emulator orchestration, and optional
embedded workers.

For the lowest-friction free setup without Render:

- Use Vercel for the public web/dashboard URL.
- Use Neon for Postgres.
- Use Upstash for Redis.
- Run `apps/api` locally during early development, or deploy it to a free Node
  runtime once you are ready to expose API traffic.

Vercel can host request/response functions, but the current API is designed as a
long-running Fastify service. If you want API and web inside Vercel only, split
workers from request handlers first and add a Vercel function adapter for
`buildServer()`. Do not put queue workers inside a serverless request handler.

## Vercel Web

Create or update one Vercel project with:

| Field           | Value                                                               |
| --------------- | ------------------------------------------------------------------- |
| Framework       | Next.js                                                             |
| Root directory  | `apps/web`                                                          |
| Build command   | `cd ../.. && pnpm --filter @carbon/web build`                       |
| Install command | `cd ../.. && pnpm install --frozen-lockfile=false --ignore-scripts` |

Set this env var if you use a custom domain:

```bash
NEXT_PUBLIC_SITE_URL=https://your-domain.example
```

Firebase config is public browser config and is wired in `apps/web/lib/firebase.ts`.
Enable Google and GitHub providers in the Firebase console for the dashboard
sign-in buttons to work.

## Neon

Use the existing Neon project or create a new one. Copy the pooled connection
string and set it as:

```bash
DATABASE_URL=postgres://...
DATABASE_PREPARE=false
```

Run migrations from your machine:

```bash
DATABASE_URL="postgres://..." NODE_ENV=production pnpm --filter @carbon/database migrate:apply
```

## Upstash

Use the Upstash Redis URL as:

```bash
REDIS_URL=redis://...
```

Carbon automatically enables TLS for Upstash hosts, even when the copied URL
starts with `redis://`.

## API Keys

Keep API keys backend-only. Firebase signs humans into the dashboard; Carbon API
keys authenticate CLI, CI, and API callers.

Mint the first key from your machine:

```bash
DATABASE_URL="postgres://..." NODE_ENV=production pnpm --filter @carbon/api bootstrap
```

The secret is shown once. Store it in your password manager or CI secret store.

## CLI Install

The public install command is:

```bash
curl -fsSL https://raw.githubusercontent.com/TaxCollector23/carbon/master/install.sh | sh
```

The npm package name is `carbon-api`, and the installed command is `carbon`.
