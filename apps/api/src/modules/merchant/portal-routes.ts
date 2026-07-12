import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { hashPin } from "@pickly/auth";
import { generateBranchSlotsFromTemplate, prisma } from "@pickly/database";
import { AppError } from "@pickly/observability";
import { HalalaSchema, UuidSchema, type JwtClaims } from "@pickly/contracts";
import { assertBranchScope, requireAuth, requireStaff } from "../../lib/auth-plugin.js";

/**
 * صورة الصنف كـdata URL (نطاق الطيار — التخزين المحلي/العرض).
 * الإنتاج يبدّلها بObject Storage (docs/09§2) — يكفي تغيير طبقة الحفظ.
 * سقف ~1MB بعد التصغير في المتصفح؛ صيغ صور فقط.
 */
const ImageDataUrlSchema = z
  .string()
  .regex(/^data:image\/(png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$/, "صيغة صورة غير صالحة")
  .max(1_400_000, "الصورة كبيرة — صغّرها قبل الرفع");

/**
 * يفكّ ربط مجموعات المُعدِّلات عن المنتج ويحذفها بأمان:
 * المُعدِّلات المرجعية في سلال سابقة (cart_item_modifiers) تُترك (لقطات لا تُكسر) —
 * فقط غير المرجعية تُحذف، والمجموعة تُحذف إن خلَت تماماً.
 */
async function pruneProductGroups(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  product_id: string
): Promise<void> {
  const links = await tx.productModifierGroup.findMany({ where: { product_id } });
  const groupIds = links.map((l) => l.group_id);
  await tx.productModifierGroup.deleteMany({ where: { product_id } });
  if (groupIds.length === 0) return;

  const mods = await tx.modifier.findMany({ where: { group_id: { in: groupIds } }, select: { id: true } });
  const refs = await tx.cartItemModifier.findMany({
    where: { modifier_id: { in: mods.map((m) => m.id) } },
    select: { modifier_id: true }
  });
  const referenced = new Set(refs.map((r) => r.modifier_id));
  const deletable = mods.filter((m) => !referenced.has(m.id)).map((m) => m.id);
  if (deletable.length > 0) await tx.modifier.deleteMany({ where: { id: { in: deletable } } });
  // احذف المجموعات التي لم يبقَ فيها أي مُعدِّل (المرجعية تبقى معلّقة بلا ضرر — غير مرتبطة بأي منتج)
  for (const gid of groupIds) {
    const remaining = await tx.modifier.count({ where: { group_id: gid } });
    if (remaining === 0) await tx.modifierGroup.delete({ where: { id: gid } });
  }
}

const ModifierGroupsSchema = z
  .array(
    z.object({
      name_ar: z.string().min(1).max(60),
      min_select: z.number().int().min(0).max(10),
      max_select: z.number().int().min(1).max(20),
      modifiers: z
        .array(
          z.object({
            name_ar: z.string().min(1).max(60),
            price_halalas: HalalaSchema.default(0)
          })
        )
        .min(1)
        .max(30)
    })
  )
  .max(6);

/**
 * بوابة التاجر (نطاق الطيار) — يدعم صفحات M-01/M-02/M-03/M-08/M-10/M-12/M-15
 * وشاشتي الوردية B-02/B-16. الأدوار وفق docs/16§1.
 */

const MANAGER_ROLES = ["owner", "general_manager", "operations_manager", "branch_manager"] as const;
/** هوية العلامة (الاسم/الشعار/الغلاف) تمس كل الفروع — المالك والمدير العام فقط */
const BRAND_EDIT_ROLES = ["owner", "general_manager"] as const;
const MENU_ROLES = [...MANAGER_ROLES, "cashier"] as const; // الكاشير: توفر فرعه فقط
const FINANCE_VIEW = ["owner", "general_manager", "finance"] as const;
const REPORT_ROLES = [...MANAGER_ROLES, "finance", "analyst"] as const;

/**
 * M-10 إدارة الطاقم — docs/16§1 «الموظفون والأدوار»:
 * مالك/مدير عام ✅ كامل · مدير عمليات 🔶 فروعه · مدير فرع 🔶 فرعه دون مدراء.
 * التدرّج يمنع تصعيد الصلاحيات: لا منح/تعديل دور برتبة ≥ رتبة الفاعل.
 */
const STAFF_ROLE_RANK: Record<string, number> = {
  owner: 5,
  general_manager: 4,
  operations_manager: 3,
  branch_manager: 2,
  cashier: 1,
  kitchen: 1,
  handoff: 1,
  finance: 1,
  analyst: 1
};
// المالك لا يُمنح من هنا (يُنشأ عند الانضمام) — أعلى دور قابل للمنح: مدير عام
const GrantableRoleSchema = z.enum([
  "general_manager",
  "operations_manager",
  "branch_manager",
  "cashier",
  "kitchen",
  "handoff",
  "finance",
  "analyst"
]);
/** أدوار تشغيلية تتطلب فرعاً واحداً على الأقل (دخول الفرع يشترط تعييناً) */
const BRANCH_BOUND_ROLES = new Set(["operations_manager", "branch_manager", "cashier", "kitchen", "handoff"]);
const PinSchema = z.string().regex(/^\d{4,6}$/, "الرمز السري 4-6 أرقام");

const plainRole = (key: string): string => key.replace(/^merchant:/, "");
const rankOf = (roleKey: string): number => STAFF_ROLE_RANK[plainRole(roleKey)] ?? 0;
const actorRankOf = (claims: JwtClaims): number => Math.max(0, ...claims.roles.map(rankOf));
/** المالك/المدير العام نطاقهما كل الفروع؛ من دونهما مقيد بفروع توكنه (docs/16§1 🔶) */
const hasFullScope = (claims: JwtClaims): boolean =>
  claims.roles.some((r) => ["owner", "general_manager"].includes(plainRole(r)));

/** يتحقق أن الفاعل يملك منح هذا الدور على هذه الفروع — وإلا AUTH-1006/MERCHANT-7003 */
function assertStaffGrant(claims: JwtClaims, role_key: string, branch_ids: string[]): void {
  if (rankOf(role_key) >= actorRankOf(claims)) throw new AppError("AUTH-1006");
  if (!hasFullScope(claims)) {
    const scope = new Set(claims.branch_ids ?? []);
    if (branch_ids.length === 0 || branch_ids.some((b) => !scope.has(b))) {
      throw new AppError("MERCHANT-7003");
    }
  }
}

export async function merchantPortalRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  const merchantIdOf = (req: Parameters<typeof requireStaff>[0]): string => {
    const id = req.claims?.merchant_id;
    if (!id) throw new AppError("MERCHANT-7003");
    return id;
  };

  /** M-01: لوحة اليوم — أرقام تشغيلية حية */
  app.get("/dashboard", async (req) => {
    const claims = requireStaff(req, REPORT_ROLES);
    const merchant_id = merchantIdOf(req);
    void claims;

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const [todayOrders, completed, rejected, activeNow, branches] = await Promise.all([
      prisma.order.count({ where: { merchant_id, created_at: { gte: startOfDay } } }),
      prisma.order.findMany({
        where: { merchant_id, order_status: "COMPLETED", completed_at: { gte: startOfDay } },
        select: { total_halalas: true, arrived_at: true, completed_at: true }
      }),
      prisma.order.count({
        where: { merchant_id, order_status: { in: ["MERCHANT_REJECTED", "REFUNDED"] }, created_at: { gte: startOfDay } }
      }),
      prisma.order.count({
        where: {
          merchant_id,
          order_status: {
            in: ["MERCHANT_PENDING", "MERCHANT_ACCEPTED", "PREPARING", "READY", "CUSTOMER_NOTIFIED", "CUSTOMER_ON_THE_WAY", "CUSTOMER_NEARBY", "CUSTOMER_ARRIVED", "HANDOFF_IN_PROGRESS"]
          }
        }
      }),
      prisma.branch.findMany({ where: { merchant_id }, select: { id: true, name_ar: true, status: true } })
    ]);

    const revenue = completed.reduce((s, o) => s + o.total_halalas, 0);
    // متوسط زمن الخدمة بعد الوصول (ث) — مقياس الطيار الأهم
    const served = completed.filter((o) => o.arrived_at && o.completed_at);
    const avgServiceSeconds =
      served.length > 0
        ? Math.round(
            served.reduce((s, o) => s + (o.completed_at!.getTime() - o.arrived_at!.getTime()) / 1000, 0) / served.length
          )
        : null;

    return {
      today_orders: todayOrders,
      completed_orders: completed.length,
      rejected_or_refunded: rejected,
      active_now: activeNow,
      revenue_halalas: revenue,
      avg_service_seconds: avgServiceSeconds,
      branches
    };
  });

  /** M-03: الفروع */
  app.get("/branches", async (req) => {
    requireStaff(req, [...MANAGER_ROLES, "cashier", "kitchen", "handoff", "finance", "analyst"]);
    const merchant_id = merchantIdOf(req);
    const branches = await prisma.branch.findMany({
      where: { merchant_id },
      include: { pickup_settings: true }
    });
    return branches.map((b) => ({
      id: b.id,
      name_ar: b.name_ar,
      branch_code: b.branch_code,
      city: b.city,
      status: b.status,
      busy_message: b.busy_message,
      address_short: b.address_short,
      default_prep_minutes: b.pickup_settings?.default_prep_minutes ?? 15,
      service_target_seconds: b.pickup_settings?.service_target_seconds ?? 120
    }));
  });

  /**
   * «متوسط وقت تجهيز الطلب» — قرار المالك 2026-07-12: هذا الرقم هو الوقت المتوقع
   * الذي يُختم على كل طلب عند قبوله ويظهر للعميل — لا اختيار وقتٍ عند كل قبول.
   */
  app.post("/branches/:id/prep-minutes", async (req) => {
    const claims = requireStaff(req, MANAGER_ROLES);
    const branch_id = UuidSchema.parse((req.params as { id: string }).id);
    assertBranchScope(claims, branch_id);
    const body = z.object({ prep_minutes: z.number().int().min(1).max(120) }).parse(req.body);

    await prisma.$transaction(async (tx) => {
      await tx.branchPickupSettings.upsert({
        where: { branch_id },
        create: { branch_id, default_prep_minutes: body.prep_minutes },
        update: { default_prep_minutes: body.prep_minutes }
      });
      await tx.auditLog.create({
        data: {
          actor_type: "merchant_staff",
          actor_id: claims.sub,
          action: "default_prep_minutes_set",
          entity_type: "branch",
          entity_id: branch_id,
          merchant_id: claims.merchant_id ?? null,
          branch_id,
          after: { prep_minutes: body.prep_minutes } as never
        }
      });
    });
    return { branch_id, default_prep_minutes: body.prep_minutes };
  });

  // ===== مواقف الاستلام (parking_spots) — يحددها المطعم فيختار العميل منها فقط =====

  const ownedBranch = async (merchant_id: string, branch_id: string) => {
    const branch = await prisma.branch.findFirst({ where: { id: branch_id, merchant_id } });
    if (!branch) throw new AppError("MERCHANT-7003");
    return branch;
  };

  /** موقف ضمن ملكية التاجر ونطاق الفاعل — وإلا MERCHANT-7003 */
  const ownedSpot = async (req: Parameters<typeof requireStaff>[0], claims: JwtClaims, id: string) => {
    const spot = await prisma.parkingSpot.findUnique({
      where: { id },
      include: { branch: { select: { merchant_id: true } } }
    });
    if (!spot || spot.branch.merchant_id !== merchantIdOf(req)) throw new AppError("MERCHANT-7003");
    assertBranchScope(claims, spot.branch_id);
    return spot;
  };

  app.get("/branches/:id/parking-spots", async (req) => {
    const claims = requireStaff(req, MANAGER_ROLES);
    const branch_id = UuidSchema.parse((req.params as { id: string }).id);
    assertBranchScope(claims, branch_id);
    await ownedBranch(merchantIdOf(req), branch_id);
    const spots = await prisma.parkingSpot.findMany({
      where: { branch_id },
      orderBy: [{ sort: "asc" }, { label: "asc" }]
    });
    return spots.map((s) => ({ id: s.id, label: s.label, is_active: s.is_active }));
  });

  app.post("/branches/:id/parking-spots", async (req) => {
    const claims = requireStaff(req, MANAGER_ROLES);
    const branch_id = UuidSchema.parse((req.params as { id: string }).id);
    assertBranchScope(claims, branch_id);
    const body = z.object({ label: z.string().trim().min(1).max(40) }).parse(req.body);
    await ownedBranch(merchantIdOf(req), branch_id);

    const dup = await prisma.parkingSpot.findUnique({
      where: { branch_id_label: { branch_id, label: body.label } }
    });
    if (dup) throw new AppError("SYS-9004", { label: "هذا الموقف مضاف مسبقاً" });

    const spot = await prisma.$transaction(async (tx) => {
      const sort = await tx.parkingSpot.count({ where: { branch_id } });
      const created = await tx.parkingSpot.create({
        data: { branch_id, label: body.label, sort }
      });
      await tx.auditLog.create({
        data: {
          actor_type: "merchant_staff",
          actor_id: claims.sub,
          action: "parking_spot_added",
          entity_type: "parking_spot",
          entity_id: created.id,
          merchant_id: claims.merchant_id ?? null,
          branch_id,
          after: { label: body.label } as never
        }
      });
      return created;
    });
    return { id: spot.id, label: spot.label, is_active: spot.is_active };
  });

  app.patch("/parking-spots/:id", async (req) => {
    const claims = requireStaff(req, MANAGER_ROLES);
    const id = UuidSchema.parse((req.params as { id: string }).id);
    const body = z
      .object({
        label: z.string().trim().min(1).max(40).optional(),
        is_active: z.boolean().optional()
      })
      .parse(req.body);
    const spot = await ownedSpot(req, claims, id);

    if (body.label && body.label !== spot.label) {
      const dup = await prisma.parkingSpot.findUnique({
        where: { branch_id_label: { branch_id: spot.branch_id, label: body.label } }
      });
      if (dup) throw new AppError("SYS-9004", { label: "هذا الموقف مضاف مسبقاً" });
    }

    await prisma.$transaction(async (tx) => {
      await tx.parkingSpot.update({
        where: { id },
        data: {
          ...(body.label !== undefined ? { label: body.label } : {}),
          ...(body.is_active !== undefined ? { is_active: body.is_active } : {})
        }
      });
      await tx.auditLog.create({
        data: {
          actor_type: "merchant_staff",
          actor_id: claims.sub,
          action: "parking_spot_updated",
          entity_type: "parking_spot",
          entity_id: id,
          merchant_id: claims.merchant_id ?? null,
          branch_id: spot.branch_id,
          before: { label: spot.label, is_active: spot.is_active } as never,
          after: body as never
        }
      });
    });
    return { id, ok: true };
  });

  /** حذف موقف — parking_spot_label على الطلبات لقطة نصية فلا يتأثر تاريخها */
  app.delete("/parking-spots/:id", async (req) => {
    const claims = requireStaff(req, MANAGER_ROLES);
    const id = UuidSchema.parse((req.params as { id: string }).id);
    const spot = await ownedSpot(req, claims, id);

    await prisma.$transaction(async (tx) => {
      await tx.parkingSpot.delete({ where: { id } });
      await tx.auditLog.create({
        data: {
          actor_type: "merchant_staff",
          actor_id: claims.sub,
          action: "parking_spot_deleted",
          entity_type: "parking_spot",
          entity_id: id,
          merchant_id: claims.merchant_id ?? null,
          branch_id: spot.branch_id,
          before: { label: spot.label } as never
        }
      });
    });
    return { id, deleted: true };
  });

  /**
   * M-02: الملف التعريفي — هوية المطعم كما يراها العميل في Discovery
   * (الشعار logo_url، الغلاف cover_url، الاسم، نوع المطبخ).
   */
  app.get("/profile", async (req) => {
    requireStaff(req, MANAGER_ROLES);
    const merchant_id = merchantIdOf(req);
    const [merchant, brands] = await Promise.all([
      prisma.merchant.findUniqueOrThrow({
        where: { id: merchant_id },
        select: { name_ar: true, name_en: true }
      }),
      prisma.brand.findMany({
        where: { merchant_id },
        orderBy: { created_at: "asc" },
        select: {
          id: true,
          name_ar: true,
          name_en: true,
          cuisine_ar: true,
          logo_url: true,
          cover_url: true,
          is_active: true
        }
      })
    ]);
    return { merchant, brands };
  });

  /**
   * M-02: تعديل هوية العلامة — الاسم/المطبخ/الشعار/الغلاف.
   * الصور data URL كنمط صور الأصناف: "" للإزالة، data URL للتبديل، غياب المفتاح = إبقاء.
   */
  app.patch("/brands/:id", async (req) => {
    const claims = requireStaff(req, BRAND_EDIT_ROLES);
    const merchant_id = merchantIdOf(req);
    const id = UuidSchema.parse((req.params as { id: string }).id);
    const body = z
      .object({
        name_ar: z.string().min(2).max(60).optional(),
        name_en: z.string().min(2).max(60).nullable().optional(),
        cuisine_ar: z.string().min(2).max(40).nullable().optional(),
        logo_data_url: z.union([ImageDataUrlSchema, z.literal("")]).optional(),
        cover_data_url: z.union([ImageDataUrlSchema, z.literal("")]).optional()
      })
      .parse(req.body);

    const brand = await prisma.brand.findFirst({ where: { id, merchant_id } });
    if (!brand) throw new AppError("MERCHANT-7003");

    const data: Record<string, unknown> = {};
    if (body.name_ar !== undefined) data.name_ar = body.name_ar;
    if (body.name_en !== undefined) data.name_en = body.name_en;
    if (body.cuisine_ar !== undefined) data.cuisine_ar = body.cuisine_ar;
    if (body.logo_data_url !== undefined) data.logo_url = body.logo_data_url === "" ? null : body.logo_data_url;
    if (body.cover_data_url !== undefined) data.cover_url = body.cover_data_url === "" ? null : body.cover_data_url;

    await prisma.$transaction(async (tx) => {
      if (Object.keys(data).length > 0) {
        await tx.brand.update({ where: { id }, data });
      }
      await tx.auditLog.create({
        data: {
          actor_type: "merchant_staff",
          actor_id: claims.sub,
          action: "brand_profile_updated",
          entity_type: "brand",
          entity_id: id,
          merchant_id,
          before: { name_ar: brand.name_ar, name_en: brand.name_en, cuisine_ar: brand.cuisine_ar } as never,
          after: {
            ...(body.name_ar !== undefined ? { name_ar: body.name_ar } : {}),
            ...(body.name_en !== undefined ? { name_en: body.name_en } : {}),
            ...(body.cuisine_ar !== undefined ? { cuisine_ar: body.cuisine_ar } : {}),
            ...(body.logo_data_url !== undefined ? { logo: body.logo_data_url === "" ? "removed" : "changed" } : {}),
            ...(body.cover_data_url !== undefined ? { cover: body.cover_data_url === "" ? "removed" : "changed" } : {})
          } as never
        }
      });
    });

    return { id, ok: true };
  });

  /** M-08: المنيو والتوفر — قائمة موحدة لكل فرع */
  app.get("/menu", async (req) => {
    const claims = requireStaff(req, MENU_ROLES);
    const merchant_id = merchantIdOf(req);
    const q = z.object({ branch_id: UuidSchema }).parse(req.query);
    assertBranchScope(claims, q.branch_id);

    const branch = await prisma.branch.findFirst({ where: { id: q.branch_id, merchant_id } });
    if (!branch) throw new AppError("MERCHANT-7003");

    const menu = await prisma.menu.findFirst({
      where: { brand_id: branch.brand_id, is_active: true },
      include: {
        categories: {
          orderBy: { sort_order: "asc" },
          include: {
            products: {
              orderBy: { sort_order: "asc" },
              include: {
                availability: { where: { branch_id: q.branch_id } },
                images: { orderBy: { sort: "asc" }, take: 1 },
                modifier_groups: {
                  orderBy: { sort: "asc" },
                  include: { group: { include: { modifiers: true } } }
                }
              }
            }
          }
        }
      }
    });
    if (!menu) return { categories: [] };
    return {
      categories: menu.categories.map((c) => ({
        id: c.id,
        name_ar: c.name_ar,
        products: c.products.map((p) => ({
          id: p.id,
          name_ar: p.name_ar,
          description_ar: p.description_ar,
          price_halalas: p.price_halalas,
          calories: p.calories,
          image_url: p.images[0]?.file_url ?? null,
          is_active: p.is_active,
          is_available: p.availability[0]?.is_available ?? true,
          modifier_groups: p.modifier_groups.map((pg) => ({
            name_ar: pg.group.name_ar,
            min_select: pg.group.min_select,
            max_select: pg.group.max_select,
            modifiers: pg.group.modifiers.map((m) => ({
              name_ar: m.name_ar,
              price_halalas: m.price_halalas
            }))
          }))
        }))
      }))
    };
  });

  /** M-08/M-09: تبديل توفر منتج في فرع */
  app.post("/availability", async (req) => {
    const claims = requireStaff(req, MENU_ROLES);
    const merchant_id = merchantIdOf(req);
    const body = z
      .object({
        branch_id: UuidSchema,
        product_id: UuidSchema,
        is_available: z.boolean()
      })
      .parse(req.body);
    assertBranchScope(claims, body.branch_id);

    const branch = await prisma.branch.findFirst({ where: { id: body.branch_id, merchant_id } });
    if (!branch) throw new AppError("MERCHANT-7003");

    await prisma.branchProductAvailability.upsert({
      where: { branch_id_product_id: { branch_id: body.branch_id, product_id: body.product_id } },
      create: { branch_id: body.branch_id, product_id: body.product_id, is_available: body.is_available },
      update: { is_available: body.is_available }
    });
    return { ok: true, is_available: body.is_available };
  });

  /**
   * M-08 CRUD (docs/11§6): إضافة تصنيف للقائمة.
   * التصنيف على مستوى العلامة (menu) فيظهر في كل الفروع؛ الأدوار الإدارية فقط.
   */
  app.post("/categories", async (req) => {
    requireStaff(req, MANAGER_ROLES);
    const merchant_id = merchantIdOf(req);
    const body = z
      .object({ branch_id: UuidSchema, name_ar: z.string().min(2).max(60) })
      .parse(req.body);

    const branch = await prisma.branch.findFirst({ where: { id: body.branch_id, merchant_id } });
    if (!branch) throw new AppError("MERCHANT-7003");

    let menu = await prisma.menu.findFirst({ where: { brand_id: branch.brand_id, is_active: true } });
    menu ??= await prisma.menu.create({ data: { brand_id: branch.brand_id, name_ar: "المنيو الرئيسي" } });

    const count = await prisma.category.count({ where: { menu_id: menu.id } });
    const cat = await prisma.category.create({
      data: { menu_id: menu.id, name_ar: body.name_ar, sort_order: count }
    });
    return { id: cat.id, name_ar: cat.name_ar };
  });

  /**
   * M-08 CRUD (docs/11§6): إضافة صنف بكل تفاصيله + مجموعات مُعدِّلات اختيارية.
   * الأسعار تُدخل بالريال وتُخزَّن هللات (BR-6 التسعير خادمي). يتوفر تلقائياً في الفرع.
   */
  app.post("/products", async (req) => {
    const claims = requireStaff(req, MANAGER_ROLES);
    const merchant_id = merchantIdOf(req);
    const body = z
      .object({
        branch_id: UuidSchema,
        category_id: UuidSchema,
        name_ar: z.string().min(2).max(80),
        description_ar: z.string().max(280).optional(),
        price_halalas: HalalaSchema,
        calories: z.number().int().min(0).max(9999).optional(),
        image_data_url: ImageDataUrlSchema.optional(),
        modifier_groups: ModifierGroupsSchema.default([])
      })
      .parse(req.body);

    const branch = await prisma.branch.findFirst({ where: { id: body.branch_id, merchant_id } });
    if (!branch) throw new AppError("MERCHANT-7003");

    // التصنيف لا بد أن يخص قائمة علامة هذا التاجر (عزل — BR-15)
    const category = await prisma.category.findUnique({
      where: { id: body.category_id },
      include: { menu: true }
    });
    if (!category || category.menu.brand_id !== branch.brand_id) throw new AppError("MERCHANT-7003");

    const product = await prisma.$transaction(async (tx) => {
      const sort = await tx.product.count({ where: { category_id: category.id } });
      const p = await tx.product.create({
        data: {
          category_id: category.id,
          name_ar: body.name_ar,
          description_ar: body.description_ar ?? null,
          price_halalas: body.price_halalas,
          calories: body.calories ?? null,
          sort_order: sort,
          is_active: true
        }
      });
      for (const g of body.modifier_groups) {
        const group = await tx.modifierGroup.create({
          data: { name_ar: g.name_ar, min_select: g.min_select, max_select: g.max_select }
        });
        await tx.productModifierGroup.create({
          data: { product_id: p.id, group_id: group.id }
        });
        for (const m of g.modifiers) {
          await tx.modifier.create({
            data: { group_id: group.id, name_ar: m.name_ar, price_halalas: m.price_halalas }
          });
        }
      }
      // صورة الصنف (اختيارية)
      if (body.image_data_url) {
        await tx.productImage.create({
          data: { product_id: p.id, file_url: body.image_data_url, sort: 0 }
        });
      }
      // متاح في كل فروع العلامة فور الإنشاء
      const branches = await tx.branch.findMany({
        where: { brand_id: branch.brand_id },
        select: { id: true }
      });
      for (const b of branches) {
        await tx.branchProductAvailability.upsert({
          where: { branch_id_product_id: { branch_id: b.id, product_id: p.id } },
          create: { branch_id: b.id, product_id: p.id, is_available: true },
          update: {}
        });
      }
      // فعل إداري — audit (docs/16§4)
      await tx.auditLog.create({
        data: {
          actor_type: "merchant_staff",
          actor_id: claims.sub,
          action: "product_created",
          entity_type: "product",
          entity_id: p.id,
          merchant_id,
          branch_id: body.branch_id,
          after: { name_ar: body.name_ar, price_halalas: body.price_halalas } as never
        }
      });
      return p;
    });

    return { id: product.id, name_ar: product.name_ar, price_halalas: product.price_halalas };
  });

  /** M-08 CRUD: إيقاف/نشر صنف (soft) عبر is_active */
  app.post("/products/:id/toggle-active", async (req) => {
    requireStaff(req, MANAGER_ROLES);
    const merchant_id = merchantIdOf(req);
    const id = UuidSchema.parse((req.params as { id: string }).id);
    const body = z.object({ is_active: z.boolean() }).parse(req.body);
    const product = await prisma.product.findUnique({
      where: { id },
      include: { category: { include: { menu: true } } }
    });
    if (!product) throw new AppError("ORDER-4001");
    const brand = await prisma.brand.findFirst({
      where: { id: product.category.menu.brand_id, merchant_id }
    });
    if (!brand) throw new AppError("MERCHANT-7003");
    await prisma.product.update({ where: { id }, data: { is_active: body.is_active } });
    return { id, is_active: body.is_active };
  });

  /**
   * M-08 CRUD: تعديل صنف موجود — الحقول + الصورة + مجموعات المُعدِّلات.
   * تمرير أي حقل = تحديثه؛ modifier_groups إن مُرّرت تستبدل المجموعات كاملة.
   */
  app.patch("/products/:id", async (req) => {
    const claims = requireStaff(req, MANAGER_ROLES);
    const merchant_id = merchantIdOf(req);
    const id = UuidSchema.parse((req.params as { id: string }).id);
    const body = z
      .object({
        name_ar: z.string().min(2).max(80).optional(),
        description_ar: z.string().max(280).nullable().optional(),
        price_halalas: HalalaSchema.optional(),
        calories: z.number().int().min(0).max(9999).nullable().optional(),
        // "" لإزالة الصورة، data URL لتبديلها، غياب المفتاح = إبقاؤها
        image_data_url: z.union([ImageDataUrlSchema, z.literal("")]).optional(),
        modifier_groups: ModifierGroupsSchema.optional()
      })
      .parse(req.body);

    const product = await prisma.product.findUnique({
      where: { id },
      include: { category: { include: { menu: true } }, modifier_groups: true }
    });
    if (!product) throw new AppError("ORDER-4001");
    const brand = await prisma.brand.findFirst({
      where: { id: product.category.menu.brand_id, merchant_id }
    });
    if (!brand) throw new AppError("MERCHANT-7003");

    await prisma.$transaction(async (tx) => {
      const data: Record<string, unknown> = {};
      if (body.name_ar !== undefined) data.name_ar = body.name_ar;
      if (body.description_ar !== undefined) data.description_ar = body.description_ar;
      if (body.price_halalas !== undefined) data.price_halalas = body.price_halalas;
      if (body.calories !== undefined) data.calories = body.calories;
      if (Object.keys(data).length > 0) {
        await tx.product.update({ where: { id }, data });
      }

      // الصورة: "" حذف · data URL تبديل
      if (body.image_data_url !== undefined) {
        await tx.productImage.deleteMany({ where: { product_id: id } });
        if (body.image_data_url !== "") {
          await tx.productImage.create({
            data: { product_id: id, file_url: body.image_data_url, sort: 0 }
          });
        }
      }

      // استبدال مجموعات المُعدِّلات بالكامل إن مُرّرت
      if (body.modifier_groups !== undefined) {
        await pruneProductGroups(tx, id);
        for (const g of body.modifier_groups) {
          const group = await tx.modifierGroup.create({
            data: { name_ar: g.name_ar, min_select: g.min_select, max_select: g.max_select }
          });
          await tx.productModifierGroup.create({ data: { product_id: id, group_id: group.id } });
          for (const m of g.modifiers) {
            await tx.modifier.create({
              data: { group_id: group.id, name_ar: m.name_ar, price_halalas: m.price_halalas }
            });
          }
        }
      }

      await tx.auditLog.create({
        data: {
          actor_type: "merchant_staff",
          actor_id: claims.sub,
          action: "product_updated",
          entity_type: "product",
          entity_id: id,
          merchant_id,
          before: { name_ar: product.name_ar, price_halalas: product.price_halalas } as never,
          after: body as never
        }
      });
    });

    return { id, ok: true };
  });

  /**
   * M-08 CRUD: حذف صنف. إن كان مرتبطاً بطلبات/سلال سابقة (لقطات) يُوقَف بدل الحذف
   * الصلب حفاظاً على سلامة السجلّات؛ وإلا يُحذف نهائياً.
   */
  app.delete("/products/:id", async (req) => {
    const claims = requireStaff(req, MANAGER_ROLES);
    const merchant_id = merchantIdOf(req);
    const id = UuidSchema.parse((req.params as { id: string }).id);
    const product = await prisma.product.findUnique({
      where: { id },
      include: { category: { include: { menu: true } } }
    });
    if (!product) throw new AppError("ORDER-4001");
    const brand = await prisma.brand.findFirst({
      where: { id: product.category.menu.brand_id, merchant_id }
    });
    if (!brand) throw new AppError("MERCHANT-7003");

    const referenced =
      (await prisma.orderItem.count({ where: { product_id: id } })) > 0 ||
      (await prisma.cartItem.count({ where: { product_id: id } })) > 0;

    await prisma.$transaction(async (tx) => {
      if (referenced) {
        // مرتبط بلقطات — إيقاف soft فقط
        await tx.product.update({ where: { id }, data: { is_active: false } });
      } else {
        await pruneProductGroups(tx, id);
        await tx.productImage.deleteMany({ where: { product_id: id } });
        await tx.branchProductAvailability.deleteMany({ where: { product_id: id } });
        await tx.product.delete({ where: { id } });
      }
      await tx.auditLog.create({
        data: {
          actor_type: "merchant_staff",
          actor_id: claims.sub,
          action: referenced ? "product_deactivated" : "product_deleted",
          entity_type: "product",
          entity_id: id,
          merchant_id,
          before: { name_ar: product.name_ar } as never
        }
      });
    });

    return { id, deleted: !referenced, deactivated: referenced };
  });

  /** M-10: الطاقم — القائمة ضمن نطاق الفاعل (docs/16§1) */
  app.get("/staff", async (req) => {
    const claims = requireStaff(req, MANAGER_ROLES);
    const merchant_id = merchantIdOf(req);
    const staff = await prisma.merchantStaff.findMany({
      where: { merchant_id, status: { not: "removed" } },
      include: { branch_assignments: { include: { branch: true } } },
      orderBy: { created_at: "asc" }
    });
    const scope = new Set(claims.branch_ids ?? []);
    const visible = hasFullScope(claims)
      ? staff
      : staff.filter((s) => s.branch_assignments.some((a) => scope.has(a.branch_id)));
    const myRank = actorRankOf(claims);
    return visible.map((s) => ({
      id: s.id,
      username: s.username,
      full_name: s.full_name,
      role_key: plainRole(s.role_key),
      status: s.status,
      branches: s.branch_assignments.map((a) => a.branch.name_ar),
      branch_ids: s.branch_assignments.map((a) => a.branch_id),
      // للواجهة: هل يستطيع الفاعل إدارة هذا الصف (لا ذاته، ولا رتبة ≥ رتبته)
      can_manage: (s.user_id == null || s.user_id !== claims.sub) && rankOf(s.role_key) < myRank
    }));
  });

  /** M-10 CRUD: إضافة موظف بدور وفروع — docs/16§1 «الموظفون والأدوار» */
  app.post("/staff", async (req) => {
    const claims = requireStaff(req, MANAGER_ROLES);
    const merchant_id = merchantIdOf(req);
    const body = z
      .object({
        full_name: z.string().min(2).max(60),
        username: z.string().regex(/^[a-zA-Z0-9._-]{3,32}$/, "اسم الحساب لاتيني 3-32 حرفاً"),
        pin: PinSchema,
        role_key: GrantableRoleSchema,
        branch_ids: z.array(UuidSchema).max(50).default([])
      })
      .parse(req.body);

    assertStaffGrant(claims, body.role_key, body.branch_ids);
    if (BRANCH_BOUND_ROLES.has(body.role_key) && body.branch_ids.length === 0) {
      throw new AppError("SYS-9004", { branch_ids: "هذا الدور يتطلب فرعاً واحداً على الأقل" });
    }

    if (body.branch_ids.length > 0) {
      const owned = await prisma.branch.count({ where: { merchant_id, id: { in: body.branch_ids } } });
      if (owned !== body.branch_ids.length) throw new AppError("MERCHANT-7003");
    }

    const dup = await prisma.merchantStaff.findUnique({
      where: { merchant_id_username: { merchant_id, username: body.username } }
    });
    if (dup) throw new AppError("SYS-9004", { username: "اسم الحساب مستخدم مسبقاً" });

    const pin_hash = await hashPin(body.pin);
    const created = await prisma.$transaction(async (tx) => {
      const row = await tx.merchantStaff.create({
        data: {
          merchant_id,
          username: body.username,
          full_name: body.full_name,
          pin_hash,
          role_key: `merchant:${body.role_key}`
        }
      });
      if (body.branch_ids.length > 0) {
        await tx.staffBranchAssignment.createMany({
          data: body.branch_ids.map((branch_id) => ({ staff_id: row.id, branch_id }))
        });
      }
      await tx.auditLog.create({
        data: {
          actor_type: "merchant_staff",
          actor_id: claims.sub,
          action: "staff_created",
          entity_type: "merchant_staff",
          entity_id: row.id,
          merchant_id,
          after: { username: body.username, role_key: body.role_key, branch_ids: body.branch_ids } as never
        }
      });
      return row;
    });
    return { id: created.id, ok: true };
  });

  /** M-10 CRUD: تعديل موظف — الدور/الفروع/الاسم/PIN/الحالة (إيقاف يُلغي جلساته فوراً) */
  app.patch("/staff/:id", async (req) => {
    const claims = requireStaff(req, MANAGER_ROLES);
    const merchant_id = merchantIdOf(req);
    const id = UuidSchema.parse((req.params as { id: string }).id);
    const body = z
      .object({
        full_name: z.string().min(2).max(60).optional(),
        role_key: GrantableRoleSchema.optional(),
        branch_ids: z.array(UuidSchema).max(50).optional(),
        pin: PinSchema.optional(),
        status: z.enum(["active", "suspended"]).optional()
      })
      .parse(req.body);

    const target = await prisma.merchantStaff.findFirst({
      where: { id, merchant_id, status: { not: "removed" } },
      include: { branch_assignments: true }
    });
    if (!target) throw new AppError("MERCHANT-7003");
    // لا تعديل ذاتي (دور/إيقاف) — يمنع قفل الحساب أو تصعيده
    if (target.user_id && target.user_id === claims.sub) throw new AppError("AUTH-1006");
    // لا إدارة من هو برتبة مساوية/أعلى (مدير الفرع «دون مدراء» — docs/16§1)
    if (rankOf(target.role_key) >= actorRankOf(claims)) throw new AppError("AUTH-1006");

    const currentBranchIds = target.branch_assignments.map((a) => a.branch_id);
    const finalRole = body.role_key ?? plainRole(target.role_key);
    const finalBranches = body.branch_ids ?? currentBranchIds;
    assertStaffGrant(claims, finalRole, finalBranches);
    if (!hasFullScope(claims)) {
      // الهدف نفسه يجب أن يكون بكامله ضمن نطاق الفاعل
      const scope = new Set(claims.branch_ids ?? []);
      if (currentBranchIds.some((b) => !scope.has(b))) throw new AppError("MERCHANT-7003");
    }
    if (BRANCH_BOUND_ROLES.has(finalRole) && finalBranches.length === 0) {
      throw new AppError("SYS-9004", { branch_ids: "هذا الدور يتطلب فرعاً واحداً على الأقل" });
    }

    if (body.branch_ids && body.branch_ids.length > 0) {
      const owned = await prisma.branch.count({ where: { merchant_id, id: { in: body.branch_ids } } });
      if (owned !== body.branch_ids.length) throw new AppError("MERCHANT-7003");
    }

    const pin_hash = body.pin ? await hashPin(body.pin) : undefined;
    await prisma.$transaction(async (tx) => {
      await tx.merchantStaff.update({
        where: { id },
        data: {
          ...(body.full_name !== undefined ? { full_name: body.full_name } : {}),
          ...(body.role_key !== undefined ? { role_key: `merchant:${body.role_key}` } : {}),
          ...(body.status !== undefined ? { status: body.status } : {}),
          ...(pin_hash ? { pin_hash } : {})
        }
      });
      if (body.branch_ids) {
        await tx.staffBranchAssignment.deleteMany({ where: { staff_id: id } });
        if (body.branch_ids.length > 0) {
          await tx.staffBranchAssignment.createMany({
            data: body.branch_ids.map((branch_id) => ({ staff_id: id, branch_id }))
          });
        }
      }
      // الإيقاف نافذ فوراً: إلغاء جلسات الموظف النشطة (requireAuth يرفضها)
      if (body.status === "suspended" && target.user_id) {
        await tx.userSession.updateMany({
          where: { user_id: target.user_id, revoked_at: null },
          data: { revoked_at: new Date() }
        });
      }
      await tx.auditLog.create({
        data: {
          actor_type: "merchant_staff",
          actor_id: claims.sub,
          action: "staff_updated",
          entity_type: "merchant_staff",
          entity_id: id,
          merchant_id,
          before: {
            role_key: plainRole(target.role_key),
            status: target.status,
            branch_ids: currentBranchIds
          } as never,
          after: {
            ...(body.full_name !== undefined ? { full_name: body.full_name } : {}),
            ...(body.role_key !== undefined ? { role_key: body.role_key } : {}),
            ...(body.status !== undefined ? { status: body.status } : {}),
            ...(body.branch_ids !== undefined ? { branch_ids: body.branch_ids } : {}),
            ...(body.pin !== undefined ? { pin: "changed" } : {})
          } as never
        }
      });
    });
    return { id, ok: true };
  });

  /** M-15: التسويات وكشوفها */
  app.get("/settlements", async (req) => {
    requireStaff(req, FINANCE_VIEW);
    const merchant_id = merchantIdOf(req);
    const settlements = await prisma.merchantSettlement.findMany({
      where: { merchant_id },
      orderBy: { period_start: "desc" },
      take: 26
    });
    return settlements;
  });

  app.get("/settlements/:id/lines", async (req) => {
    requireStaff(req, FINANCE_VIEW);
    const merchant_id = merchantIdOf(req);
    const id = UuidSchema.parse((req.params as { id: string }).id);
    const settlement = await prisma.merchantSettlement.findFirst({ where: { id, merchant_id } });
    if (!settlement) throw new AppError("ORDER-4001");
    const lines = await prisma.settlementLine.findMany({
      where: { settlement_id: id },
      include: { order: { select: { display_code: true } } }
    });
    return lines.map((l) => ({
      id: l.id,
      line_type: l.line_type,
      amount_halalas: l.amount_halalas,
      order_code: l.order?.display_code ?? null
    }));
  });

  /** M-12: التقييمات المنشورة/المعلقة لفروع التاجر */
  app.get("/reviews", async (req) => {
    requireStaff(req, REPORT_ROLES);
    const merchant_id = merchantIdOf(req);
    const branches = await prisma.branch.findMany({ where: { merchant_id }, select: { id: true, name_ar: true } });
    const byId = new Map(branches.map((b) => [b.id, b.name_ar]));
    const reviews = await prisma.review.findMany({
      where: { branch_id: { in: branches.map((b) => b.id) } },
      orderBy: { created_at: "desc" },
      take: 100
    });
    return reviews.map((r) => ({
      id: r.id,
      branch_name: byId.get(r.branch_id) ?? "",
      rating_overall: r.rating_overall,
      comment: r.comment,
      status: r.status,
      created_at: r.created_at
    }));
  });

  /**
   * B-02/B-16: الوردية — فتح/إغلاق (J14).
   * قرار D9: لا جدول shifts في قائمة docs/10 المغلقة — أحداث الوردية تُسجل في audit_logs.
   */
  app.post("/shifts/open", async (req) => {
    const claims = requireStaff(req, [...MANAGER_ROLES, "cashier"]);
    const body = z
      .object({
        branch_id: UuidSchema,
        prep_minutes: z.number().int().min(5).max(90).optional(),
        notes: z.string().max(280).optional()
      })
      .parse(req.body);
    assertBranchScope(claims, body.branch_id);

    await prisma.$transaction(async (tx) => {
      await tx.branch.update({ where: { id: body.branch_id }, data: { status: "open" } });
      if (body.prep_minutes) {
        await tx.branchPickupSettings.update({
          where: { branch_id: body.branch_id },
          data: { default_prep_minutes: body.prep_minutes }
        });
      }
      await tx.auditLog.create({
        data: {
          actor_type: "merchant_staff",
          actor_id: claims.sub,
          action: "shift_opened",
          entity_type: "branch",
          entity_id: body.branch_id,
          merchant_id: claims.merchant_id ?? null,
          branch_id: body.branch_id,
          after: body as never
        }
      });
    });
    return { ok: true, status: "open" };
  });

  app.post("/shifts/close", async (req) => {
    const claims = requireStaff(req, [...MANAGER_ROLES, "cashier"]);
    const body = z
      .object({ branch_id: UuidSchema, notes: z.string().max(280).optional() })
      .parse(req.body);
    assertBranchScope(claims, body.branch_id);

    // الطلبات المفتوحة تُعرض قبل الإغلاق — الإغلاق لا يعطل تسليم القائم (BR-14 روحاً)
    const openOrders = await prisma.order.count({
      where: {
        branch_id: body.branch_id,
        order_status: {
          in: ["MERCHANT_PENDING", "MERCHANT_ACCEPTED", "PREPARING", "READY", "CUSTOMER_NOTIFIED", "CUSTOMER_ON_THE_WAY", "CUSTOMER_NEARBY", "CUSTOMER_ARRIVED", "HANDOFF_IN_PROGRESS"]
        }
      }
    });

    await prisma.$transaction(async (tx) => {
      await tx.branch.update({ where: { id: body.branch_id }, data: { status: "closed" } });
      await tx.auditLog.create({
        data: {
          actor_type: "merchant_staff",
          actor_id: claims.sub,
          action: "shift_closed",
          entity_type: "branch",
          entity_id: body.branch_id,
          merchant_id: claims.merchant_id ?? null,
          branch_id: body.branch_id,
          after: { ...body, open_orders_at_close: openOrders } as never
        }
      });
    });
    return { ok: true, status: "closed", open_orders: openOrders };
  });

  /** ملخص وردية اليوم للفرع — لشاشة الإغلاق B-16 */
  app.get("/shifts/summary", async (req) => {
    const claims = requireStaff(req, [...MANAGER_ROLES, "cashier"]);
    const q = z.object({ branch_id: UuidSchema }).parse(req.query);
    assertBranchScope(claims, q.branch_id);

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const [total, completed, rejected, open] = await Promise.all([
      prisma.order.count({ where: { branch_id: q.branch_id, created_at: { gte: startOfDay } } }),
      prisma.order.count({
        where: { branch_id: q.branch_id, order_status: "COMPLETED", completed_at: { gte: startOfDay } }
      }),
      prisma.order.count({
        where: { branch_id: q.branch_id, order_status: { in: ["MERCHANT_REJECTED", "NO_SHOW"] }, created_at: { gte: startOfDay } }
      }),
      prisma.order.count({
        where: {
          branch_id: q.branch_id,
          order_status: {
            in: ["MERCHANT_PENDING", "MERCHANT_ACCEPTED", "PREPARING", "READY", "CUSTOMER_NOTIFIED", "CUSTOMER_ON_THE_WAY", "CUSTOMER_NEARBY", "CUSTOMER_ARRIVED", "HANDOFF_IN_PROGRESS"]
          }
        }
      })
    ]);
    return { total_today: total, completed_today: completed, rejected_or_noshow: rejected, open_now: open };
  });

  // ===== M-06: إعداد الاستلام المجدول والسعات — BR-5 («فترات بسعة يحددها الفرع») =====

  app.get("/scheduled/settings", async (req) => {
    const claims = requireStaff(req, MANAGER_ROLES);
    const q = z.object({ branch_id: UuidSchema }).parse(req.query);
    assertBranchScope(claims, q.branch_id);
    const settings = await prisma.branchPickupSettings.findUnique({ where: { branch_id: q.branch_id } });
    return { branch_id: q.branch_id, scheduled_enabled: settings?.scheduled_enabled ?? false };
  });

  app.post("/scheduled/settings", async (req) => {
    const claims = requireStaff(req, MANAGER_ROLES);
    const body = z.object({ branch_id: UuidSchema, scheduled_enabled: z.boolean() }).parse(req.body);
    assertBranchScope(claims, body.branch_id);
    const merchant_id = merchantIdOf(req);
    const branch = await prisma.branch.findFirst({ where: { id: body.branch_id, merchant_id } });
    if (!branch) throw new AppError("MERCHANT-7003");

    await prisma.$transaction(async (tx) => {
      await tx.branchPickupSettings.upsert({
        where: { branch_id: body.branch_id },
        create: { branch_id: body.branch_id, scheduled_enabled: body.scheduled_enabled },
        update: { scheduled_enabled: body.scheduled_enabled }
      });
      await tx.auditLog.create({
        data: {
          actor_type: "merchant_staff",
          actor_id: claims.sub,
          action: "scheduled_toggle",
          entity_type: "branch",
          entity_id: body.branch_id,
          merchant_id,
          branch_id: body.branch_id,
          after: { scheduled_enabled: body.scheduled_enabled } as never
        }
      });
    });
    return { ok: true, scheduled_enabled: body.scheduled_enabled };
  });

  /** فترات السعة القادمة للفرع — تشمل المحجوز لعرض الإشغال */
  app.get("/scheduled/slots", async (req) => {
    const claims = requireStaff(req, MANAGER_ROLES);
    const q = z.object({ branch_id: UuidSchema }).parse(req.query);
    assertBranchScope(claims, q.branch_id);
    const slots = await prisma.branchCapacitySlot.findMany({
      where: { branch_id: q.branch_id, slot_start: { gte: new Date() } },
      orderBy: { slot_start: "asc" },
      take: 100
    });
    return slots.map((s) => ({
      id: s.id,
      slot_start: s.slot_start,
      slot_end: s.slot_end,
      capacity: s.capacity,
      booked: s.booked
    }));
  });

  /** دوام الأسبوع (branch_hours) + إعدادات التوليد — الفترات تتولّد منه لا من إدخال يومي */
  app.get("/scheduled/week", async (req) => {
    const claims = requireStaff(req, MANAGER_ROLES);
    const q = z.object({ branch_id: UuidSchema }).parse(req.query);
    assertBranchScope(claims, q.branch_id);
    const [hours, settings] = await Promise.all([
      prisma.branchHour.findMany({ where: { branch_id: q.branch_id }, orderBy: [{ day_of_week: "asc" }, { opens_at: "asc" }] }),
      prisma.branchPickupSettings.findUnique({ where: { branch_id: q.branch_id } })
    ]);
    return {
      branch_id: q.branch_id,
      days: hours.map((h) => ({ day_of_week: h.day_of_week, opens_at: h.opens_at, closes_at: h.closes_at })),
      slot_minutes: settings?.scheduled_slot_minutes ?? 30,
      capacity: settings?.scheduled_capacity ?? 6
    };
  });

  /**
   * حفظ دوام الأسبوع وتوليد الفترات منه للأيام السبعة القادمة:
   * يستبدل branch_hours كاملة، يحذف الفترات المستقبلية غير المحجوزة (مواءمة مع الدوام الجديد)،
   * ثم يولّد من القالب. المحجوزة لا تُمس. إغلاق قبل الفتح = دوام يمتد بعد منتصف الليل.
   */
  app.post("/scheduled/week", async (req) => {
    const claims = requireStaff(req, MANAGER_ROLES);
    const TimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "صيغة وقت غير صالحة — HH:MM");
    const body = z
      .object({
        branch_id: UuidSchema,
        slot_minutes: z.union([z.literal(30), z.literal(60)]).default(30),
        capacity: z.number().int().min(1).max(200),
        days: z
          .array(
            z
              .object({
                day_of_week: z.number().int().min(0).max(6), // 0=الأحد
                opens_at: TimeSchema,
                closes_at: TimeSchema
              })
              .refine((d) => d.opens_at !== d.closes_at, { message: "وقت الفتح يساوي الإغلاق" })
          )
          .max(7)
      })
      .refine((b) => new Set(b.days.map((d) => d.day_of_week)).size === b.days.length, {
        message: "يوم مكرر في الدوام"
      })
      .parse(req.body);
    assertBranchScope(claims, body.branch_id);
    const merchant_id = merchantIdOf(req);
    const branch = await prisma.branch.findFirst({ where: { id: body.branch_id, merchant_id } });
    if (!branch) throw new AppError("MERCHANT-7003");

    await prisma.$transaction(async (tx) => {
      await tx.branchHour.deleteMany({ where: { branch_id: body.branch_id } });
      if (body.days.length > 0) {
        await tx.branchHour.createMany({
          data: body.days.map((d) => ({ branch_id: body.branch_id, ...d }))
        });
      }
      await tx.branchPickupSettings.upsert({
        where: { branch_id: body.branch_id },
        create: {
          branch_id: body.branch_id,
          scheduled_slot_minutes: body.slot_minutes,
          scheduled_capacity: body.capacity
        },
        update: { scheduled_slot_minutes: body.slot_minutes, scheduled_capacity: body.capacity }
      });
      // مواءمة: الفترات المستقبلية الفارغة تُحذف ليعاد توليدها وفق الدوام الجديد — المحجوزة تبقى
      await tx.branchCapacitySlot.deleteMany({
        where: { branch_id: body.branch_id, slot_start: { gt: new Date() }, booked: 0 }
      });
      await tx.auditLog.create({
        data: {
          actor_type: "merchant_staff",
          actor_id: claims.sub,
          action: "scheduled_week_updated",
          entity_type: "branch",
          entity_id: body.branch_id,
          merchant_id,
          branch_id: body.branch_id,
          after: { days: body.days, slot_minutes: body.slot_minutes, capacity: body.capacity } as never
        }
      });
    });

    const slots = await generateBranchSlotsFromTemplate({
      branch_id: body.branch_id,
      windows: body.days,
      slotMinutes: body.slot_minutes,
      capacity: body.capacity
    });
    return { ok: true, days: body.days.length, slots };
  });

  /** حذف فترة — فقط إن لم يكن عليها حجوزات */
  app.delete("/scheduled/slots/:id", async (req) => {
    const claims = requireStaff(req, MANAGER_ROLES);
    const id = UuidSchema.parse((req.params as { id: string }).id);
    const merchant_id = merchantIdOf(req);
    const slot = await prisma.branchCapacitySlot.findUnique({
      where: { id },
      include: { branch: { select: { merchant_id: true } } }
    });
    if (!slot || slot.branch.merchant_id !== merchant_id) throw new AppError("MERCHANT-7003");
    assertBranchScope(claims, slot.branch_id);
    if (slot.booked > 0) throw new AppError("SYS-9004", { hint: "الفترة عليها حجوزات — لا يمكن حذفها" });
    await prisma.branchCapacitySlot.delete({ where: { id } });
    return { ok: true };
  });
}
