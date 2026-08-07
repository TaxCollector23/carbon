# syntax=docker/dockerfile:1.7

FROM node:20-alpine AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.6.0 --activate
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* turbo.json tsconfig.base.json ./
COPY apps/workers/package.json apps/workers/
COPY packages/config/package.json packages/config/
COPY packages/core/package.json packages/core/
COPY packages/shared/package.json packages/shared/
COPY packages/types/package.json packages/types/
COPY packages/ai/package.json packages/ai/
COPY packages/parser/package.json packages/parser/
COPY packages/graph/package.json packages/graph/
COPY packages/ingestion/package.json packages/ingestion/
COPY packages/storage/package.json packages/storage/
COPY packages/workers/package.json packages/workers/
RUN pnpm install --frozen-lockfile=false

FROM deps AS build
COPY packages ./packages
COPY apps/workers ./apps/workers
RUN pnpm --filter @carbon/workers-runner build

FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S carbon && adduser -S carbon -G carbon
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/workers/dist ./apps/workers/dist
COPY --from=build /app/apps/workers/package.json ./apps/workers/package.json
COPY --from=build /app/packages ./packages
USER carbon
CMD ["node", "--enable-source-maps", "apps/workers/dist/index.js"]
