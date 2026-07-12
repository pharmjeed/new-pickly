import type { FastifyInstance } from "fastify";
import { prisma } from "@pickly/database";

/**
 * كتالوج السيارات — بيانات مرجعية عامة لشاشة «أضف سيارة جديدة»:
 * الماركات والموديلات من قاعدة البيانات (vehicle_makes/vehicle_models) + قائمة ألوان ثابتة.
 */

/** ألوان السيارات المتاحة في القائمة المنسدلة — الاسم عربي + hex لعرض الحبة الملونة */
export const VEHICLE_COLORS: ReadonlyArray<{ name_ar: string; hex: string }> = [
  { name_ar: "أبيض", hex: "#FFFFFF" },
  { name_ar: "أسود", hex: "#1B1B1B" },
  { name_ar: "فضي", hex: "#C7CCD1" },
  { name_ar: "رمادي", hex: "#7E868C" },
  { name_ar: "أزرق", hex: "#2456A6" },
  { name_ar: "أحمر", hex: "#C0272D" },
  { name_ar: "أخضر", hex: "#1E7A46" },
  { name_ar: "بني", hex: "#6B4A2F" },
  { name_ar: "بيج", hex: "#D9C9A8" },
  { name_ar: "ذهبي", hex: "#C9A227" },
  { name_ar: "برتقالي", hex: "#E07A1F" },
  { name_ar: "عنابي", hex: "#6E1F2C" },
  { name_ar: "أصفر", hex: "#E8C41C" }
];

export async function vehicleCatalogRoutes(app: FastifyInstance): Promise<void> {
  app.get("/vehicle-catalog", async () => {
    const makes = await prisma.vehicleMake.findMany({
      where: { is_active: true },
      orderBy: [{ sort: "asc" }, { name_ar: "asc" }],
      include: {
        models: { where: { is_active: true }, orderBy: [{ sort: "asc" }, { name_ar: "asc" }] }
      }
    });
    return {
      makes: makes.map((mk) => ({
        key: mk.key,
        name_ar: mk.name_ar,
        name_en: mk.name_en,
        models: mk.models.map((md) => ({ name_ar: md.name_ar, name_en: md.name_en }))
      })),
      colors: VEHICLE_COLORS
    };
  });
}
