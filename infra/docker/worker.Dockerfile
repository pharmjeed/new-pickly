# Pickly Worker — Cloud Run (min instances ≥1 — يعالج outbox والمؤقتات)
FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.0.0 --activate
WORKDIR /app

FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages ./packages
COPY apps/worker ./apps/worker
RUN pnpm install --frozen-lockfile --filter @pickly/worker...

FROM deps AS build
RUN pnpm --filter @pickly/database generate \
 && pnpm --filter @pickly/worker... build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app ./
CMD ["node", "apps/worker/dist/main.js"]
