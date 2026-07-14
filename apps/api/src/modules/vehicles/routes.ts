import type { FastifyInstance } from "fastify";
import { prisma } from "@pickly/database";
import { VEHICLE_COLORS, VEHICLE_COLOR_ALIASES } from "./colors.js";

/**
 * كتالوج السيارات — بيانات مرجعية عامة لشاشة «أضف سيارة جديدة»:
 * الماركات والموديلات من قاعدة البيانات (vehicle_makes/vehicle_models) + قائمة ألوان ثابتة.
 */

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
      colors: VEHICLE_COLORS.map((c) => ({ ...c, aliases: VEHICLE_COLOR_ALIASES[c.name_ar] ?? [] }))
    };
  });
}
