import type { FastifyInstance } from "fastify";
import { prisma } from "@pickly/database";

/**
 * Feature Flags — docs/09§6-5: كل خاصية جديدة قابلة للإيقاف دون نشر.
 * القراءة عامة (الواجهات تكيّف نفسها)؛ الكتابة من لوحة الأدمن لاحقاً (مرحلة 7).
 */
export async function featureFlagRoutes(app: FastifyInstance): Promise<void> {
  let cache: { data: Record<string, boolean>; at: number } | null = null;
  const ttlMs = Number(process.env.FEATURE_FLAGS_REFRESH_SECONDS ?? 30) * 1000;

  app.get("/feature-flags", async () => {
    if (cache && Date.now() - cache.at < ttlMs) return cache.data;
    const flags = await prisma.featureFlag.findMany();
    const data = Object.fromEntries(flags.map((f) => [f.key, f.enabled]));
    cache = { data, at: Date.now() };
    return data;
  });
}
