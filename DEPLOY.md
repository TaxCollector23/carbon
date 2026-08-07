# Deploying Carbon

This repo uses one public web URL for the landing page, dashboard, and
benchmarks:

- `/` landing
- `/dashboard` Firebase-gated dashboard
- `/benchmarks` benchmark methodology

A low-cost hosted setup can use:

| Piece           | Provider                | Notes                                           |
| --------------- | ----------------------- | ----------------------------------------------- |
| Web + dashboard | Vercel                  | One project, root directory `apps/web`          |
| API             | Node runtime            | Fastify service in `apps/api`; see notes below  |
| Postgres        | Neon                    | Durable control-plane data                      |
| Redis           | Upstash                 | Async jobs, rate limits, idempotency            |
| Object storage  | Cloudflare R2, optional | Durable artifacts when managed storage is needed |

Postgres and Redis need managed services. Free web deployments restart and
redeploy often, so they are a poor fit for durable control-plane data.

## API + Workers

The backend is a Fastify Node service in `apps/api`. Run it as a long-lived Node
process when you need public API traffic. It owns API-key auth, idempotency,
rate limits, ingestion, emulator orchestration, and optional embedded workers.

For the lowest-friction setup:

- Use Vercel for the public web/dashboard URL.
- Use Neon for Postgres.
- Use Upstash for Redis.
- Run `apps/api` from your machine during early development, or deploy it to a
  Node runtime once you are ready to expose API traffic.

Vercel can host request/response functions, but the current API is designed as a
long-running Fastify service. To run API and web entirely on Vercel, first split
workers from request handlers and add a Vercel function adapter for
`buildServer()`. Keep queue workers out of serverless request handlers.

## Vercel Web

Create or update one Vercel project with:

| Field           | Value                                                               |
| --------------- | ------------------------------------------------------------------- |
| Framework       | Next.js                                                             |
| Root directory  | `apps/web`                                                          |
| Build command   | `cd ../.. && pnpm --filter @carbon/web build`                       |
| Install command | `cd ../.. && pnpm install --frozen-lockfile=false --ignore-scripts` |

Set this environment variable if you use a custom domain:

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

The secret is displayed once. Store it in your password manager or CI secret
store.

## CLI Install

The public install command is:

```bash
curl -fsSL https://raw.githubusercontent.com/TaxCollector23/carbon/master/install.sh | sh
```

The npm package name is `carbon-api`, and the installed command is `carbon`.
