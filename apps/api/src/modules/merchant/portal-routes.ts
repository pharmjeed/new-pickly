import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "@pickly/database";
import { AppError } from "@pickly/observability";
import { UuidSchema } from "@pickly/contracts";
import { assertBranchScope, requireAuth, requireStaff } from "../../lib/auth-plugin.js";

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
              include: { availability: { where: { branch_id: q.branch_id } } }
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
          price_halalas: p.price_halalas,
          is_active: p.is_active,
          is_available: p.availability[0]?.is_available ?? true
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
}
