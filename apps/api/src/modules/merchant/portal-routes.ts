import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "@pickly/database";
import { AppError } from "@pickly/observability";
import { HalalaSchema, UuidSchema } from "@pickly/contracts";
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
const MENU_ROLES = [...MANAGER_ROLES, "cashier"] as const; // الكاشير: توفر فرعه فقط
const FINANCE_VIEW = ["owner", "general_manager", "finance"] as const;
const REPORT_ROLES = [...MANAGER_ROLES, "finance", "analyst"] as const;

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
        const links = await tx.productModifierGroup.findMany({ where: { product_id: id } });
        const groupIds = links.map((l) => l.group_id);
        await tx.productModifierGroup.deleteMany({ where: { product_id: id } });
        if (groupIds.length > 0) {
          await tx.modifier.deleteMany({ where: { group_id: { in: groupIds } } });
          await tx.modifierGroup.deleteMany({ where: { id: { in: groupIds } } });
        }
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
        const links = await tx.productModifierGroup.findMany({ where: { product_id: id } });
        const groupIds = links.map((l) => l.group_id);
        await tx.productModifierGroup.deleteMany({ where: { product_id: id } });
        if (groupIds.length > 0) {
          await tx.modifier.deleteMany({ where: { group_id: { in: groupIds } } });
          await tx.modifierGroup.deleteMany({ where: { id: { in: groupIds } } });
        }
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

  /** M-10: الطاقم */
  app.get("/staff", async (req) => {
    requireStaff(req, MANAGER_ROLES);
    const merchant_id = merchantIdOf(req);
    const staff = await prisma.merchantStaff.findMany({
      where: { merchant_id, status: { not: "removed" } },
      include: { branch_assignments: { include: { branch: true } } }
    });
    return staff.map((s) => ({
      id: s.id,
      username: s.username,
      full_name: s.full_name,
      role_key: s.role_key,
      status: s.status,
      branches: s.branch_assignments.map((a) => a.branch.name_ar)
    }));
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

  /** إنشاء فترات يوم كامل دفعة واحدة — فترات متساوية بسعة موحدة */
  app.post("/scheduled/slots", async (req) => {
    const claims = requireStaff(req, MANAGER_ROLES);
    const body = z
      .object({
        branch_id: UuidSchema,
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        from_hour: z.number().int().min(0).max(23),
        to_hour: z.number().int().min(1).max(24),
        slot_minutes: z.union([z.literal(30), z.literal(60)]).default(30),
        capacity: z.number().int().min(1).max(200)
      })
      .refine((b) => b.to_hour > b.from_hour, { message: "نطاق ساعات غير صالح" })
      .parse(req.body);
    assertBranchScope(claims, body.branch_id);
    const merchant_id = merchantIdOf(req);
    const branch = await prisma.branch.findFirst({ where: { id: body.branch_id, merchant_id } });
    if (!branch) throw new AppError("MERCHANT-7003");

    const day = new Date(`${body.date}T00:00:00`);
    const starts: Date[] = [];
    for (let h = body.from_hour; h < body.to_hour; h++) {
      for (let m = 0; m < 60; m += body.slot_minutes) {
        const start = new Date(day);
        start.setHours(h, m, 0, 0);
        if (start > new Date()) starts.push(start);
      }
    }
    // upsert لكل فترة — (branch_id, slot_start) فريد؛ سعة الفترات القائمة تُحدَّث دون مساس بالمحجوز
    let created = 0;
    for (const start of starts) {
      const end = new Date(start.getTime() + body.slot_minutes * 60_000);
      await prisma.branchCapacitySlot.upsert({
        where: { branch_id_slot_start: { branch_id: body.branch_id, slot_start: start } },
        create: { branch_id: body.branch_id, slot_start: start, slot_end: end, capacity: body.capacity },
        update: { slot_end: end, capacity: body.capacity }
      });
      created++;
    }
    return { ok: true, slots: created };
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
