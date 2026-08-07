# Deploying Carbon — the free path

Everything runs on free tiers. Total cost: **$0**.

## Stack

| Component | Host | Free tier |
|---|---|---|
| Marketing (`apps/web`) | Vercel | Free forever |
| Dashboard (`apps/dashboard`) | Vercel | Free forever |
| Docs (`apps/docs`) | Vercel or Mintlify | Free forever |
| API + workers (`apps/api`) | Render Web Service | 750h/mo, spins down after 15min idle |
| Postgres | **Neon** | 0.5 GB, always-on, no card required |
| Redis | **Upstash** | 256 MB, 500k commands/mo |
| AI (optional) | OpenRouter | Pay-per-token; skip to run without AI |

## Two things you should know before you deploy

1. **Free Render web spins down after 15 minutes of inactivity.** The first request after that takes ~30–60s to wake it up. Fine for demos and personal projects. Not fine as a public production API. `plan: starter` in `render.yaml` fixes this for $7/mo.
2. **No persistent disk on Render free.** `STORAGE_ROOT=/tmp/carbon` is ephemeral — a redeploy wipes stored IRs, graphs, and snapshots (they can be re-ingested). For durability, wire an S3-compatible store; Cloudflare R2 has a real free tier (10 GB, no egress fees).

Everything critical (users, orgs, API keys, project metadata) lives in Postgres, so those survive.

## Step-by-step

### 1. Neon (Postgres)
1. Go to [neon.tech](https://neon.tech) → sign in with GitHub.
2. Create a project → give it a name → region close to Render (Oregon = US West).
3. Copy the **pooled** connection string. It looks like:
   ```
   postgres://user:pass@ep-cool-fog-xxx-pooler.us-west-2.aws.neon.tech/neondb?sslmode=require
   ```
   Save it as `DATABASE_URL`.

### 2. Upstash (Redis)
1. Go to [upstash.com](https://upstash.com) → sign in with GitHub.
2. Create a Redis database → Global type → region close to Render.
3. On the DB page, find the **TLS/rediss** URL (starts with `rediss://`). Save it as `REDIS_URL`.

### 3. Vercel (frontend)
1. [vercel.com](https://vercel.com) → **Add New Project** → import your GitHub repo.
2. **Root Directory** = `apps/web`. Framework = Next.js. Deploy.
3. Repeat for `apps/dashboard` (Root = `apps/dashboard`).
4. Note the URLs — you'll paste them into Render as `ALLOWED_ORIGINS`.

### 4. Render (API + embedded workers)
1. [render.com](https://render.com) → **New** → **Blueprint** → connect your repo.
2. Render reads `render.yaml` and asks you to fill in four secrets:
   - `DATABASE_URL` — from Neon (step 1)
   - `REDIS_URL` — from Upstash (step 2)
   - `ALLOWED_ORIGINS` — your Vercel URLs, comma-separated
   - `CARBON_AI_API_KEY` — optional (skip if you don't want AI)
3. Apply. First deploy takes ~5 min. Migrations run automatically as `preDeployCommand`.

### 5. Mint your first API key
Open the `carbon-api` service in Render → **Shell** tab:
```bash
pnpm --filter @carbon/api bootstrap
```
Copy the key it prints (`ck_live_...`) — it's shown once.

### 6. Verify
```bash
curl https://carbon-api.onrender.com/health
# → { "ok": true, "service": "carbon-api", "version": "0.1.0" }

curl https://carbon-api.onrender.com/ready
# → { "ok": true, "checks": { "database": { "ok": true }, "storage": { "ok": true } } }

curl -H "x-carbon-key: ck_live_..." https://carbon-api.onrender.com/v1/projects
# → { "data": [], "nextCursor": null, "total": 0 }
```

## When to upgrade off free

- **API paying users hit "site loading" for 30s** → bump Render `plan: free` to `plan: starter` ($7/mo). This is the single most-worth-it upgrade.
- **You're regenerating IRs after every deploy** → move `STORAGE_ROOT` to Cloudflare R2 (free 10 GB) or S3.
- **Neon 0.5 GB fills up** → their $19/mo tier gives you 10 GB.
- **Upstash 500k commands/mo runs out** → their $10/mo tier gives you unlimited within reason.

## Custom domain (optional, still free)

- Marketing: `carbon.dev` → point at Vercel `apps/web`
- Dashboard: `app.carbon.dev` → Vercel `apps/dashboard`
- API: `api.carbon.dev` → Render `carbon-api`

Add domains in each host's UI. SSL is automatic on both.
