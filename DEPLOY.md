# Deploying Carbon

This repo uses one public web URL for the landing page, dashboard, and
benchmarks:

- `/` landing
- `/dashboard` Firebase-gated dashboard
- `/benchmarks` benchmark methodology

A low-cost hosted setup can use:

| Piece           | Provider                | Notes                                            |
| --------------- | ----------------------- | ------------------------------------------------ |
| Web + dashboard | Vercel                  | One project, root directory `apps/web`           |
| API             | Node runtime            | Fastify service in `apps/api`; see notes below   |
| Postgres        | Neon                    | Durable control-plane data                       |
| Redis           | Upstash                 | Async jobs, rate limits, idempotency             |
| Object storage  | Cloudflare R2, optional | Durable artifacts when managed storage is needed |

Postgres and Redis need managed services. Free web deployments restart and
redeploy often, so they are a poor fit for durable control-plane data.

## API + Workers

The backend is a Fastify Node service in `apps/api`. It expects a long-lived
Node runtime — Vercel functions are the wrong shape for it. The two supported
production paths are Fly.io (multi-tenant) and the self-hosted docker-compose
bundle (single-VM). Both are covered below.

### Fly.io (recommended for hosted)

Both `apps/api` and `apps/dashboard` ship with a `fly.toml`. The API's toml
declares a `release_command` that runs `pnpm --filter @carbon/database
migrate:apply`, so migrations are applied automatically on every deploy — do
not run them by hand.

1. Install flyctl and log in: `curl -L https://fly.io/install.sh | sh && fly auth login`.
2. Provision Postgres and Redis. Options:
   - **Fly-native:** `fly postgres create --name carbon-db` and
     `fly redis create --name carbon-redis`. Fly attaches the connection URL
     as a secret automatically when you run `fly postgres attach carbon-db`.
   - **Neon + Upstash:** create databases in each console, then
     `fly secrets set DATABASE_URL=... REDIS_URL=... --app carbon-api`.
3. Bootstrap the API app once (creates it in Fly's registry, does not deploy):
   ```bash
   fly launch --config apps/api/fly.toml --copy-config --no-deploy --name carbon-api
   fly secrets set --app carbon-api \
     BETTER_AUTH_SECRET=$(openssl rand -hex 32) \
     CARBON_METRICS_TOKEN=$(openssl rand -hex 16) \
     ALLOWED_ORIGINS=https://dashboard.carbon.example
   fly deploy --config apps/api/fly.toml --remote-only
   ```
4. Bootstrap the dashboard:
   ```bash
   fly launch --config apps/dashboard/fly.toml --copy-config --no-deploy --name carbon-dashboard
   fly secrets set --app carbon-dashboard \
     DATABASE_URL="$(fly secrets list --app carbon-api | grep DATABASE_URL | awk '{print $2}')" \
     BETTER_AUTH_SECRET=... \
     NEXT_PUBLIC_CARBON_API_URL=https://carbon-api.fly.dev
   fly deploy --config apps/dashboard/fly.toml --remote-only
   ```
5. CI (see `.github/workflows/ci.yml`) redeploys both on push to `main`
   using `FLY_API_TOKEN` — no manual `docker build` from a laptop after the
   first bootstrap.

### Self-hosted (single VM)

For Enterprise customers who want everything on their own hardware, the repo
ships a `docker-compose.selfhost.yml` that bundles Postgres, Redis, the
migration sidecar, the API, the worker process, and the dashboard on one
Docker network. Requires Docker Engine 24+ with the compose plugin.

```bash
# One-time: point compose at your public URL and set the auth secret.
cat > .env <<'EOF'
NEXT_PUBLIC_SITE_URL=https://carbon.internal.example
NEXT_PUBLIC_CARBON_API_URL=https://carbon.internal.example/api
BETTER_AUTH_SECRET=$(openssl rand -hex 32)
ALLOWED_ORIGINS=https://carbon.internal.example
CARBON_METRICS_TOKEN=$(openssl rand -hex 16)
EOF

docker compose -f docker-compose.selfhost.yml up -d
```

The `migrate` sidecar runs `pnpm --filter @carbon/database migrate:apply`
against the compose-managed Postgres and exits. The `api`, `workers`, and
`dashboard` services all wait on `service_completed_successfully` for the
sidecar, so you should never run migrations by hand in the self-host path.

Front the stack with your own TLS terminator (Caddy, nginx, Cloudflare
Tunnel) — the compose file exposes plain HTTP on `:3001` (dashboard) and
`:4000` (API).

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

Migration `0001` replaces the non-unique `api_keys_prefix_idx` with a unique
index. It fails if two live keys somehow share a prefix — check with
`SELECT prefix FROM api_keys GROUP BY prefix HAVING count(*) > 1;` and revoke
the duplicate before applying.

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

## Operating the API

### Probes

`/health` is liveness — point the orchestrator's restart probe here. `/ready` is
readiness — point the load balancer here. Readiness results are cached for two
seconds, so probing at 1Hz is cheap; it checks Postgres, Redis, and object
storage concurrently and returns 503 with a per-dependency breakdown.

### Rolling deploys

On `SIGTERM` the API fails `/ready` immediately and keeps serving for
`CARBON_DRAIN_MS` (default 5s) before closing the listener, so the load balancer
stops routing before connections are cut. If your platform removes the instance
from the pool before signalling, set `CARBON_DRAIN_MS=0` to shut down at once.

### Metrics

`/metrics` exposes Prometheus text format: request counts and a latency
histogram, both labelled by route pattern, plus in-flight requests, event-loop
lag, uptime, and RSS. It is unauthenticated so a scraper can reach it without a
Carbon key — set `CARBON_METRICS_TOKEN` and scrape with
`Authorization: Bearer <token>` if the endpoint is internet-reachable.

Useful queries:

```promql
# 5xx rate
sum(rate(carbon_http_requests_total{status_class="5xx"}[5m]))

# p95 latency by route
histogram_quantile(0.95, sum by (route, le) (rate(carbon_http_request_duration_ms_bucket[5m])))

# event loop saturation
carbon_nodejs_eventloop_lag_ms > 100
```

### Logs

Every response carries `x-request-id`, and an inbound `x-request-id` is honoured
so a trace survives across the proxy, the dashboard, and the API. One structured
`api.access` line is emitted per request — `error` for 5xx, `warn` for 4xx and
slow requests, `info` otherwise — so `level>=50` is a usable alert condition
without a parsing rule. Probe endpoints are excluded to keep the volume honest.

## CLI Install

The public install command is:

```bash
curl -fsSL https://raw.githubusercontent.com/carbon-dev/carbon/master/install.sh | sh
```

The npm package name is `carbon-dev`, and the installed command is `carbon` (`carbon-dev` and `carbon-api` are also linked as aliases).
