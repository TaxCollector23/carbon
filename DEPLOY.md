# Deploying Carbon

Two systems, two hosts.

- **Frontend** (`apps/web`, `apps/dashboard`, `apps/docs`) → **Vercel**
- **Backend** (`apps/api`, `apps/workers`, Postgres, Redis) → **Render**

## Frontend on Vercel

1. Import the repo into Vercel three times — once per Next app.
2. For each project, set **Root Directory** to the app path:
   - `apps/web`
   - `apps/dashboard`
   - `apps/docs` *(Mintlify — you can also host on Mintlify directly)*
3. Vercel autodetects Next.js. The `vercel.json` in each app tells it to install from the repo root so pnpm workspaces resolve.
4. Set `NEXT_PUBLIC_API_URL=https://carbon-api.onrender.com` on the dashboard project (once the API is deployed).

## Backend on Render

1. Push the repo to GitHub (already done).
2. Render → **New** → **Blueprint** → point at your repo.
3. Render reads `render.yaml` and provisions:
   - `carbon-api` — Fastify web service
   - `carbon-workers` — BullMQ background worker
   - `carbon-postgres` — managed Postgres 16
   - `carbon-redis` — managed Redis
4. First deploy runs `pnpm --filter @carbon/database migrate:apply` as `preDeployCommand`.
5. Set `CARBON_AI_API_KEY` in the Render dashboard (marked `sync: false` — never in git).
6. Open the `carbon-api` shell tab and run:
   ```
   pnpm --filter @carbon/api bootstrap
   ```
   This mints your first org and API key. Copy the key — it's printed once.

Total baseline: **~$30/mo** (Postgres $6 + Redis $10 + API $7 + Workers $7).

## Cheaper: swap Render Postgres/Redis for serverless

- **Neon** — Postgres with a real free tier, scales to zero.
- **Upstash** — Redis priced per request.

In `render.yaml`, delete the `databases:` block and the `keyvalue` service, then set `DATABASE_URL` and `REDIS_URL` on both services from the Render UI.

## Custom domain

- Marketing: `carbon.dev` → Vercel `apps/web`
- Dashboard: `dashboard.carbon.dev` → Vercel `apps/dashboard`
- API: `api.carbon.dev` → Render `carbon-api`

Add the domains in each host's UI. Render and Vercel both handle SSL automatically.

## What to check after first deploy

- `curl https://carbon-api.onrender.com/health` returns `{"ok":true}`
- `curl https://carbon-api.onrender.com/ready` returns `{"ok":true, "checks": {"database": {"ok":true}, "storage": {"ok":true}}}`
- `carbon-api` logs show `api.listening`
- `carbon-workers` logs show `workers.ready`
