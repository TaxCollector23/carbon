# syntax=docker/dockerfile:1.7
#
# Root-level Dockerfile for Render's native Docker runtime.
#
# Render runs Docker builds with the repo root as build context and expects a
# Dockerfile at the root. The api service also has `apps/api/Dockerfile`
# (used by Fly.io, which scopes the build to apps/api) — those two contexts
# differ, so this root image exists solely for the repo-root build.
#
# The pipeline is identical to apps/api/Dockerfile: install the pnpm workspace,
# build the control-plane API with tsup, then ship a slim production image that
# boots Fastify on ${API_PORT:-4000}.

# ─── Stage 1: install workspace ────────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.6.0 --activate
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* turbo.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY packages/config/package.json packages/config/
COPY packages/core/package.json packages/core/
COPY packages/shared/package.json packages/shared/
COPY packages/types/package.json packages/types/
COPY packages/parser/package.json packages/parser/
COPY packages/ai/package.json packages/ai/
COPY packages/graph/package.json packages/graph/
COPY packages/state/package.json packages/state/
COPY packages/storage/package.json packages/storage/
COPY packages/runtime/package.json packages/runtime/
COPY packages/ingestion/package.json packages/ingestion/
COPY packages/database/package.json packages/database/
COPY packages/workers/package.json packages/workers/
COPY benchmarks/package.json benchmarks/
RUN pnpm install --frozen-lockfile=false

# ─── Stage 2: build ────────────────────────────────────────────────────────
FROM deps AS build
COPY packages ./packages
COPY apps/api ./apps/api
COPY benchmarks ./benchmarks
RUN pnpm --filter @carbon/api build

# ─── Stage 3: runtime ──────────────────────────────────────────────────────
FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S carbon && adduser -S carbon -G carbon
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/packages ./packages
COPY --from=build /app/benchmarks ./benchmarks
USER carbon
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+ (process.env.API_PORT || 4000) + '/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--enable-source-maps", "apps/api/dist/index.js"]