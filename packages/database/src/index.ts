/**
 * @pickly/database — عميل Prisma الموحد.
 * قاعدة العزل: الوصول من الوحدات عبر Repositories بـTenant Scope فقط (docs/10§3) —
 * الاستيراد المباشر لهذا العميل خارج طبقة Repository مخالفة تُرفض في المراجعة.
 */
import { PrismaClient } from "@prisma/client";

declare global {
  var __picklyPrisma: PrismaClient | undefined;
}

export const prisma: PrismaClient =
  globalThis.__picklyPrisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.__picklyPrisma = prisma;
}

export * from "@prisma/client";
export * from "./scheduled-template.js";
