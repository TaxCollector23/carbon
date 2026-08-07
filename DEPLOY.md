# Deploying Carbon — free, no blueprints, ~10 minutes

Everything runs on free tiers. No credit card required for any of it.

## What you're setting up

| # | Piece | Where | Time |
|---|---|---|---|
| 1 | Postgres | Neon | 2 min |
| 2 | Redis | Upstash | 2 min |
| 3 | Object storage (optional) | Cloudflare R2 | 3 min |
| 4 | Marketing site | Vercel | 2 min |
| 5 | API | Render Web Service | 3 min |
| 6 | First API key | `bootstrap` script | 30 sec |

You can do 1, 2, 4, 5, 6 in one sitting. Skip 3 until you care about durability.

---

## 1. Neon (Postgres) — 2 min

1. Go to **[console.neon.tech](https://console.neon.tech)**.
2. Click **Continue with GitHub** → authorize.
3. **Create Project**:
   - Name: `carbon`
   - Postgres version: `16` (default)
   - Region: `US West (Oregon)` if you'll deploy to Render Oregon; else pick nearest.
   - Click **Create Project**.
4. On the dashboard, you'll see a **Connection string** panel. Toggle **Pooled connection** ON.
5. Copy the string. It looks like:
   ```
   postgres://carbon_owner:npg_xxxxx@ep-cool-fog-a5xxxxx-pooler.us-west-2.aws.neon.tech/carbon?sslmode=require
   ```
6. Save this as **`DATABASE_URL`** in a scratch file.

Done. Neon's free tier is 0.5 GB, always on, no card.

---

## 2. Upstash (Redis) — 2 min

1. Go to **[console.upstash.com](https://console.upstash.com)**.
2. **Sign in with GitHub** → authorize.
3. Click **Create Database** (Redis).
   - Name: `carbon`
   - Type: **Regional** (Global is fine too; Regional is simpler)
   - Region: US-West-1 (or nearest)
   - Eviction: leave default
   - TLS: **Enabled** (it should be by default)
   - Click **Create**.
4. On the DB page, find **Connect to your database** → dropdown → **Node.js** tab.
5. Copy the URL from the `redis://` (actually `rediss://` because TLS) line. Looks like:
   ```
   rediss://default:xxxxxxxxxxxxxxxxxxxx@happy-elephant-12345.upstash.io:6379
   ```
6. Save as **`REDIS_URL`**.

Upstash free tier: 256 MB, 500k commands/month.

---

## 3. (Optional) Cloudflare R2 for durable storage — 3 min

Skip this on your first deploy. Only needed once you have ingested APIs you don't want to lose on redeploy.

1. **[dash.cloudflare.com](https://dash.cloudflare.com)** → sign up (no card required for free R2).
2. Left sidebar → **R2** → **Create bucket**:
   - Name: `carbon-artifacts`
   - Location: **Automatic**
   - Click **Create bucket**.
3. Left sidebar → **R2** → **Manage R2 API Tokens** → **Create API Token**:
   - Permissions: **Object Read & Write**
   - Scope: only the `carbon-artifacts` bucket
   - TTL: forever
   - Click **Create Token**.
4. Copy the values into your scratch file:
   ```
   S3_ENDPOINT     = https://<account_id>.r2.cloudflarestorage.com
   S3_BUCKET       = carbon-artifacts
   S3_ACCESS_KEY   = <shown once>
   S3_SECRET_KEY   = <shown once>
   S3_REGION       = auto
   ```

R2 free tier: 10 GB storage, zero egress fees.

---

## 4. Vercel (marketing site) — 2 min

1. **[vercel.com/new](https://vercel.com/new)** → **Import Git Repository**.
2. Find `TaxCollector23/carbon` → **Import**.
3. **Configure Project**:
   - Framework Preset: **Next.js** (autodetected)
   - **Root Directory**: click **Edit** → select `apps/web` → click **Continue**
   - Build & Output: leave the defaults (the `vercel.json` in `apps/web` sets them)
   - Environment Variables: none needed for marketing
4. Click **Deploy**. First build takes ~90s.
5. Copy the URL, e.g. `https://carbon-taxcollector23.vercel.app`.

Repeat for `apps/dashboard` if/when you want the dashboard live (Root Directory = `apps/dashboard`; needs `NEXT_PUBLIC_API_URL` env var pointing at your Render API).

---

## 5. Render (API) — 3 min, no Blueprint

1. **[dashboard.render.com](https://dashboard.render.com)** → sign in with GitHub.
2. Click **New +** → **Web Service**.
3. **Connect a repository** → find `TaxCollector23/carbon` → click **Connect**.
4. Fill in the form:

   | Field | Value |
   |---|---|
   | Name | `carbon-api` |
   | Region | `Oregon (US West)` (match Neon if possible) |
   | Branch | `master` |
   | Root Directory | *(leave blank — Dockerfile references files from repo root)* |
   | Runtime | **Docker** |
   | Dockerfile Path | `./apps/api/Dockerfile` |
   | Docker Build Context Directory | `.` |
   | Instance Type | **Free** |
   | Health Check Path | `/health` |

5. Scroll down to **Environment Variables** → click **Add Environment Variable** for each row:

   | Key | Value |
   |---|---|
   | `NODE_ENV` | `production` |
   | `API_HOST` | `0.0.0.0` |
   | `API_PORT` | `4000` |
   | `LOG_LEVEL` | `info` |
   | `CARBON_AUTH_MODE` | `enforced` |
   | `CARBON_RATE_LIMIT_MAX` | `120` |
   | `CARBON_RATE_LIMIT_WINDOW_MS` | `60000` |
   | `EMBED_WORKERS` | `true` |
   | `STORAGE_ROOT` | `/tmp/carbon` *(or configure S3 below)* |
   | `DATABASE_URL` | *paste from Neon (step 1)* |
   | `REDIS_URL` | *paste from Upstash (step 2)* |
   | `ALLOWED_ORIGINS` | *your Vercel URL(s), comma-separated* |
   | `CARBON_AI_PROVIDER` | `openrouter` *(optional)* |
   | `CARBON_AI_API_KEY` | *your OpenRouter key or leave blank* |

   If you set up R2 (step 3), also add:

   | Key | Value |
   |---|---|
   | `STORAGE_BACKEND` | `s3` |
   | `S3_ENDPOINT` | *from step 3* |
   | `S3_BUCKET` | `carbon-artifacts` |
   | `S3_ACCESS_KEY` | *from step 3* |
   | `S3_SECRET_KEY` | *from step 3* |
   | `S3_REGION` | `auto` |

6. Scroll to **Advanced** → **Pre-Deploy Command**:
   ```
   pnpm --filter @carbon/database migrate:apply
   ```
7. Click **Create Web Service**.

Build takes ~5 min the first time. Watch the log for `api.listening`.

---

## 6. Mint your first API key

Still in Render, on the `carbon-api` service page:

1. Click the **Shell** tab (top right).
2. Wait for the shell to attach.
3. Run:
   ```bash
   pnpm --filter @carbon/api bootstrap
   ```
4. Copy the `ck_live_...` key it prints. **You only see it once.**

---

## Verify

Replace `<your-render-url>` with e.g. `https://carbon-api.onrender.com`:

```bash
curl <your-render-url>/health
# → {"ok":true,"service":"carbon-api","version":"0.1.0"}

curl <your-render-url>/ready
# → {"ok":true,"checks":{"database":{"ok":true},"storage":{"ok":true}}}

curl -H "x-carbon-key: ck_live_..." <your-render-url>/v1/projects
# → {"data":[],"nextCursor":null,"total":0}
```

If `/ready` shows `database: {ok: false}` — your `DATABASE_URL` is wrong; check the pooled connection string.
If `/ready` hangs → Render free service is spinning up; first request after idle takes ~30–60s.

---

## Two things to expect on free tier

1. **The API spins down after 15 min of no traffic.** Next request takes 30–60s. Upgrade to `Starter` in Render ($7/mo) when this becomes a problem.
2. **`/tmp/carbon` is ephemeral** on Render free. Redeploys wipe local storage. Use R2 (step 3) if you care about the artifacts.

Everything in Postgres (users, orgs, API keys, projects) is permanent.
