# syntax=docker/dockerfile:1.7

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
RUN pnpm install --frozen-lockfile=false

# ─── Stage 2: build ────────────────────────────────────────────────────────
FROM deps AS build
COPY packages ./packages
COPY apps/api ./apps/api
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
USER carbon
EXPOSE 4000
CMD ["node", "--enable-source-maps", "apps/api/dist/index.js"]
