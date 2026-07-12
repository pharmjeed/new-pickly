import type { FastifyInstance } from "fastify";
import {
  NearbyQuerySchema,
  SearchQuerySchema,
  UuidSchema,
  type BranchCard,
  type CapacitySlot,
  type ContentBanner,
  type Menu,
  type SearchResponse
} from "@pickly/contracts";
import { prisma } from "@pickly/database";
import { AppError } from "@pickly/observability";
import { createGeoAdapter, haversineMeters } from "@pickly/geo";
import { requireFlag } from "../../lib/flags.js";

/**
 * وحدة Discovery/Catalog:
 * GET /v1/branches/nearby · GET /v1/branches/:id/menu (docs/11§2)
 * GET /v1/search (C-11/C-12) · GET /v1/branches/:id/slots (BR-5) · GET /v1/content/banners (A-13)
 */
export async function catalogRoutes(app: FastifyInstance): Promise<void> {
  const geo = createGeoAdapter();

  /** بحث C-11: مطاعم ومنتجات وتصنيفات — ILIKE على الأسماء (docs/11§2) */
  app.get("/search", async (req) => {
    await requireFlag("search");
    const q = SearchQuerySchema.parse(req.query);
    const term = `%${q.q}%`;

    const branchRows = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT b.id
      FROM branches b
      JOIN brands br ON br.id = b.brand_id
      WHERE b.is_active
        AND (br.name_ar ILIKE ${term} OR br.name_en ILIKE ${term} OR b.name_ar ILIKE ${term} OR b.city ILIKE ${term})
      LIMIT 20`;

    const productRows = await prisma.$queryRaw<
      Array<{ id: string; name_ar: string; price_halalas: number; brand_id: string }>
    >`
      SELECT p.id, p.name_ar, p.price_halalas, m.brand_id
      FROM products p
      JOIN categories c ON c.id = p.category_id
      JOIN menus m ON m.id = c.menu_id
      WHERE p.is_active AND m.is_active
        AND (p.name_ar ILIKE ${term} OR p.name_en ILIKE ${term} OR p.description_ar ILIKE ${term} OR c.name_ar ILIKE ${term})
      LIMIT 30`;

    const brandIds = [...new Set(productRows.map((p) => p.brand_id))];
    const branches = await prisma.branch.findMany({
      where: {
        OR: [
          { id: { in: branchRows.map((r) => r.id) } },
          { brand_id: { in: brandIds }, is_active: true }
        ]
      },
      include: { brand: true }
    });

    const toCard = (b: (typeof branches)[number]): BranchCard => ({
      id: b.id,
      brand_id: b.brand_id,
      brand_name_ar: b.brand.name_ar,
      brand_name_en: b.brand.name_en,
      cuisine_ar: b.brand.cuisine_ar,
      logo_url: b.brand.logo_url,
      cover_url: b.brand.cover_url,
      status: b.status,
      busy_message: b.busy_message,
      distance_meters:
        q.lat != null && q.lng != null
          ? haversineMeters({ lat: q.lat, lng: q.lng }, { lat: b.lat, lng: b.lng })
          : null,
      eta_minutes: null,
      rating: null,
      min_order_halalas: b.min_order_halalas,
      location: { lat: b.lat, lng: b.lng },
      address_short: b.address_short
    });

    // أقرب فرع لكل علامة يحمل نتيجة المنتج — المنتج يُطلب من فرع محدد
    const byBrand = new Map<string, (typeof branches)[number]>();
    for (const b of branches) {
      const cur = byBrand.get(b.brand_id);
      if (!cur) {
        byBrand.set(b.brand_id, b);
        continue;
      }
      if (q.lat != null && q.lng != null) {
        const here = { lat: q.lat, lng: q.lng };
        if (
          haversineMeters(here, { lat: b.lat, lng: b.lng }) <
          haversineMeters(here, { lat: cur.lat, lng: cur.lng })
        ) {
          byBrand.set(b.brand_id, b);
        }
      }
    }

    const directIds = new Set(branchRows.map((r) => r.id));
    const result: SearchResponse = {
      branches: branches
        .filter((b) => directIds.has(b.id))
        .map(toCard)
        .sort((a, b) => (a.distance_meters ?? 1e9) - (b.distance_meters ?? 1e9)),
      products: productRows.flatMap((p) => {
        const branch = byBrand.get(p.brand_id);
        if (!branch) return [];
        return [
          {
            id: p.id,
            branch_id: branch.id,
            brand_name_ar: branch.brand.name_ar,
            name_ar: p.name_ar,
            price_halalas: p.price_halalas,
            image_url: null
          }
        ];
      })
    };
    return result;
  });

  /** فترات BR-5 المتاحة — سعة يحددها الفرع (M-06) */
  app.get("/branches/:id/slots", async (req) => {
    await requireFlag("scheduled_orders");
    const branch_id = UuidSchema.parse((req.params as { id: string }).id);
    const settings = await prisma.branchPickupSettings.findUnique({ where: { branch_id } });
    if (!settings?.scheduled_enabled) throw new AppError("ORDER-4007");

    const slots = await prisma.branchCapacitySlot.findMany({
      where: { branch_id, slot_start: { gte: new Date() } },
      orderBy: { slot_start: "asc" },
      take: 60
    });
    return slots
      .filter((s) => s.booked < s.capacity)
      .map(
        (s): CapacitySlot => ({
          id: s.id,
          slot_start: s.slot_start.toISOString(),
          slot_end: s.slot_end.toISOString(),
          capacity: s.capacity,
          booked: s.booked,
          remaining: s.capacity - s.booked
        })
      );
  });

  /** بانرات CMS (A-13) — أحدث قيمة سارية للمفتاح cms.banners */
  app.get("/content/banners", async () => {
    const setting = await prisma.systemSetting.findFirst({
      where: { key: "cms.banners", effective_at: { lte: new Date() } },
      orderBy: { effective_at: "desc" }
    });
    return (setting?.value ?? []) as ContentBanner[];
  });

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
          cuisine_ar: b.brand.cuisine_ar,
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
