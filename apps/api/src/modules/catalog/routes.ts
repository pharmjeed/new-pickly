import type { FastifyInstance } from "fastify";
import { NearbyQuerySchema, UuidSchema, type BranchCard, type Menu } from "@pickly/contracts";
import { prisma } from "@pickly/database";
import { AppError } from "@pickly/observability";
import { createGeoAdapter, haversineMeters } from "@pickly/geo";

/**
 * وحدة Discovery/Catalog — نطاق الـVertical Slice:
 * GET /v1/branches/nearby · GET /v1/branches/:id/menu (docs/11§2)
 */
export async function catalogRoutes(app: FastifyInstance): Promise<void> {
  const geo = createGeoAdapter();

  app.get("/branches/nearby", async (req) => {
    const q = NearbyQuerySchema.parse(req.query);

    // PostGIS gist — لا مسافة مستقيمة للـETA لكن نصف القطر مكاني (docs/10§4)
    const rows = await prisma.$queryRaw<Array<{ id: string; distance_m: number }>>`
      SELECT id, ST_Distance(location, ST_SetSRID(ST_MakePoint(${q.lng}, ${q.lat}), 4326)::geography)::int AS distance_m
      FROM branches
      WHERE is_active AND location IS NOT NULL
        AND ST_DWithin(location, ST_SetSRID(ST_MakePoint(${q.lng}, ${q.lat}), 4326)::geography, ${q.radius})
      ORDER BY distance_m ASC
      LIMIT 50`;

    if (rows.length === 0) return [];
    const distances = new Map(rows.map((r) => [r.id, r.distance_m]));

    const branches = await prisma.branch.findMany({
      where: { id: { in: rows.map((r) => r.id) } },
      include: { brand: true }
    });

    const cards: BranchCard[] = await Promise.all(
      branches.map(async (b) => {
        const route = await geo.estimateRoute(
          { lat: q.lat, lng: q.lng },
          { lat: b.lat, lng: b.lng }
        );
        return {
          id: b.id,
          brand_id: b.brand_id,
          brand_name_ar: b.brand.name_ar,
          brand_name_en: b.brand.name_en,
          logo_url: b.brand.logo_url,
          cover_url: b.brand.cover_url,
          status: b.status,
          busy_message: b.busy_message,
          distance_meters: distances.get(b.id) ?? haversineMeters({ lat: q.lat, lng: q.lng }, { lat: b.lat, lng: b.lng }),
          eta_minutes: Math.round(route.eta_seconds / 60),
          rating: null, // يُحسب من reviews بعد الطيار الأول للبيانات
          min_order_halalas: b.min_order_halalas,
          location: { lat: b.lat, lng: b.lng },
          address_short: b.address_short
        };
      })
    );
    return cards.sort((a, b) => (a.distance_meters ?? 0) - (b.distance_meters ?? 0));
  });

  app.get("/branches/:id/menu", async (req) => {
    const branch_id = UuidSchema.parse((req.params as { id: string }).id);
    const branch = await prisma.branch.findUnique({ where: { id: branch_id } });
    if (!branch || !branch.is_active) throw new AppError("CATALOG-2001");

    const menu = await prisma.menu.findFirst({
      where: { brand_id: branch.brand_id, is_active: true },
      include: {
        categories: {
          orderBy: { sort_order: "asc" },
          include: {
            products: {
              where: { is_active: true },
              orderBy: { sort_order: "asc" },
              include: {
                images: { orderBy: { sort: "asc" }, take: 1 },
                modifier_groups: {
                  orderBy: { sort: "asc" },
                  include: { group: { include: { modifiers: { where: { is_active: true } } } } }
                },
                availability: { where: { branch_id } }
              }
            }
          }
        }
      }
    });
    if (!menu) throw new AppError("CATALOG-2001");

    const result: Menu = {
      branch_id,
      categories: menu.categories.map((c) => ({
        id: c.id,
        name_ar: c.name_ar,
        name_en: c.name_en,
        sort_order: c.sort_order,
        products: c.products.map((p) => ({
          id: p.id,
          category_id: p.category_id,
          name_ar: p.name_ar,
          name_en: p.name_en,
          description_ar: p.description_ar,
          price_halalas: p.price_halalas,
          image_url: p.images?.[0]?.file_url ?? null,
          is_available: p.availability[0]?.is_available ?? true,
          calories: p.calories,
          modifier_groups: p.modifier_groups.map((pg) => ({
            id: pg.group.id,
            name_ar: pg.group.name_ar,
            name_en: pg.group.name_en,
            min_select: pg.group.min_select,
            max_select: pg.group.max_select,
            modifiers: pg.group.modifiers.map((m) => ({
              id: m.id,
              name_ar: m.name_ar,
              name_en: m.name_en,
              price_halalas: m.price_halalas,
              is_available: m.is_active
            }))
          }))
        }))
      }))
    };
    return result;
  });
}
