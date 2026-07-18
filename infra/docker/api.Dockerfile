# Pickly API — Cloud Run (قابلية النقل: Docker قياسي — docs/09§2)
FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.0.0 --activate
WORKDIR /app

FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages ./packages
COPY apps/api ./apps/api
RUN pnpm install --frozen-lockfile --filter @pickly/api...

FROM deps AS build
RUN pnpm --filter @pickly/database generate \
 && pnpm --filter @pickly/api... build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app ./
EXPOSE 4000
# migrate deploy قبل الإقلاع: idempotent، والنشر الذاتي على السيرفر لا يشغّل خطوة هجرات مستقلة
CMD ["sh", "-c", "cd packages/database && npx prisma migrate deploy && cd /app && exec node apps/api/dist/server.js"]
