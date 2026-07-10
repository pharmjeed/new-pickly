import { prisma } from "@pickly/database";
import { AppError } from "@pickly/observability";

/**
 * بوابة الأعلام خادمياً — docs/09§6-5: كل خاصية جديدة قابلة للإيقاف دون نشر.
 * الواجهات تقرأ GET /v1/feature-flags للعرض، والخادم يفرض العلم عند التنفيذ.
 */
let cache: { data: Record<string, boolean>; at: number } | null = null;
const TTL_MS = Number(process.env.FEATURE_FLAGS_REFRESH_SECONDS ?? 30) * 1000;

export async function flagEnabled(key: string): Promise<boolean> {
  if (!cache || Date.now() - cache.at >= TTL_MS) {
    const flags = await prisma.featureFlag.findMany();
    cache = { data: Object.fromEntries(flags.map((f) => [f.key, f.enabled])), at: Date.now() };
  }
  return cache.data[key] ?? false;
}

/** للاختبارات وكتابة الأدمن — إسقاط الكاش فور التعديل */
export function invalidateFlagCache(): void {
  cache = null;
}

export async function requireFlag(key: string): Promise<void> {
  if (!(await flagEnabled(key))) {
    throw new AppError("SYS-9004", { hint: `الخاصية ${key} غير مفعلة حالياً` });
  }
}
