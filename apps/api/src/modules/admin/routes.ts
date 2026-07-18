import fs from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { prisma } from "@pickly/database";
import { AppError } from "@pickly/observability";
import { UuidSchema } from "@pickly/contracts";
import { hashPin, verifyPin } from "@pickly/auth";
import { requireAuth } from "../../lib/auth-plugin.js";
import { decryptSecret, encryptSecret } from "../../lib/plate-crypto.js";
import { emitEvent } from "../../lib/events.js";
import { invalidateFlagCache } from "../../lib/flags.js";
import { notifyCustomer } from "../../lib/notify.js";
import { paymentMethodsConfig } from "../../lib/payment-methods.js";

/**
 * وحدة Super Admin — docs/16§2 RBAC، كل فعل حساس يدخل audit_logs بسبب (BR-15):
 * التجار، الطلبات، المالية، العملاء، الصحة، Audit
 * + مرحلة 2: CMS (A-13)، العروض (A-12/BR-7)، الدعم (A-15)، المخاطر (A-16)، Feature Flags (A-23).
 */

/**
 * صورة البانر (A-13): إما data URL مرفوعة من اللوحة (نطاق الطيار — التخزين المحلي/العرض،
 * الإنتاج يبدّلها بObject Storage docs/09§2) أو رابط خارجي قديم (توافق خلفي).
 * سقف ~1.4MB بعد التصغير في المتصفح؛ صيغ صور فقط للـdata URL.
 */
const BannerImageSchema = z
  .string()
  .max(1_400_000, "الصورة كبيرة — صغّرها قبل الرفع")
  .refine(
    (v) => /^https?:\/\//.test(v) || /^data:image\/(png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$/.test(v),
    "صيغة صورة غير صالحة"
  );

type AdminRole =
  | "super_admin"
  | "operations"
  | "finance"
  | "support"
  | "merchant_success"
  | "risk"
  | "read_only";

function requireAdmin(req: FastifyRequest, allowed: readonly AdminRole[]): { sub: string; role: AdminRole } {
  const claims = req.claims;
  if (!claims) throw new AppError("AUTH-1005");
  if (claims.actor_type !== "admin") throw new AppError("AUTH-1006");
  const role = claims.roles
    .find((r) => r.startsWith("admin:"))
    ?.replace("admin:", "") as AdminRole | undefined;
  if (!role) throw new AppError("AUTH-1006");
  // القراءة متاحة لكل الأدوار حين يتضمن المسموح read_only
  if (!allowed.includes(role) && !(allowed.includes("read_only") && role)) {
    throw new AppError("AUTH-1006");
  }
  return { sub: claims.sub, role };
}

const ALL_READ: readonly AdminRole[] = [
  "super_admin",
  "operations",
  "finance",
  "support",
  "merchant_success",
  "risk",
  "read_only"
];

async function audit(
  actor_id: string,
  action: string,
  entity_type: string,
  entity_id: string,
  reason: string,
  extra?: Record<string, unknown>
): Promise<void> {
  await prisma.auditLog.create({
    data: {
      actor_type: "admin",
      actor_id,
      action,
      entity_type,
      entity_id,
      reason,
      after: (extra ?? {}) as never
    }
  });
}

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  /** A-01: نظرة عامة */
  app.get("/overview", async (req) => {
    requireAdmin(req, ALL_READ);
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const [merchants, pendingMerchants, ordersToday, activeOrders, refundsPending, deadLetters, unprocessedWebhooks] =
      await Promise.all([
        prisma.merchant.count({ where: { status: "approved" } }),
        prisma.merchant.count({ where: { status: "pending_review" } }),
        prisma.order.count({ where: { created_at: { gte: startOfDay } } }),
        prisma.order.count({
          where: {
            order_status: {
              in: ["MERCHANT_PENDING", "MERCHANT_ACCEPTED", "PREPARING", "READY", "CUSTOMER_NOTIFIED", "CUSTOMER_ON_THE_WAY", "CUSTOMER_NEARBY", "CUSTOMER_ARRIVED", "HANDOFF_IN_PROGRESS"]
            }
          }
        }),
        prisma.refund.count({ where: { status: { in: ["pending", "processing"] } } }),
        prisma.deadLetterJob.count({ where: { resolved_at: null } }),
        prisma.paymentWebhookEvent.count({ where: { processed_at: null } })
      ]);
    return {
      merchants,
      pending_merchants: pendingMerchants,
      orders_today: ordersToday,
      active_orders: activeOrders,
      refunds_pending: refundsPending,
      dead_letters: deadLetters,
      unprocessed_webhooks: unprocessedWebhooks
    };
  });

  /** A-04: التجار + قبول/تعليق */
  app.get("/merchants", async (req) => {
    requireAdmin(req, ALL_READ);
    const merchants = await prisma.merchant.findMany({
      include: { _count: { select: { branches: true, orders: true } } },
      orderBy: { created_at: "desc" }
    });
    return merchants.map((m) => ({
      id: m.id,
      name_ar: m.name_ar,
      status: m.status,
      plan_key: m.plan_key,
      branches: m._count.branches,
      orders: m._count.orders,
      created_at: m.created_at
    }));
  });

  /**
   * إنشاء تاجر مباشرة من اللوحة: تاجر معتمد + علامة + حساب مالك بدور merchant:owner.
   * المالك يدخل بوابة التاجر بجواله عبر OTP وينشئ فروعه ومنيوه من هناك (M-04/M-08).
   */
  app.post("/merchants", async (req) => {
    const { sub } = requireAdmin(req, ["super_admin", "merchant_success"]);
    const body = z
      .object({
        name_ar: z.string().trim().min(2).max(80),
        brand_name_ar: z.string().trim().min(2).max(80).nullable().default(null),
        cuisine_ar: z.string().trim().max(40).nullable().default(null),
        owner_name: z.string().trim().min(2).max(80),
        owner_phone: z.string().trim(),
        reason: z.string().min(3)
      })
      .parse(req.body);

    const phone = body.owner_phone.startsWith("05") ? `+966${body.owner_phone.slice(1)}` : body.owner_phone;
    if (!/^\+9665\d{8}$/.test(phone)) throw new AppError("SYS-9004", { hint: "جوال المالك بصيغة 05XXXXXXXX" });

    const dupName = await prisma.merchant.findFirst({ where: { name_ar: body.name_ar } });
    if (dupName) throw new AppError("SYS-9004", { hint: "يوجد تاجر بنفس الاسم" });

    const ownerRole = await prisma.role.findUnique({ where: { key: "merchant:owner" } });
    if (!ownerRole) throw new AppError("SYS-9004", { hint: "دور merchant:owner غير مهيأ — شغّل الseed" });

    // جوال مالك مرتبط بعميل يكسر دخوله كعميل (actor_type يُحسب من الأدوار) — نرفض بوضوح
    const existing = await prisma.user.findUnique({
      where: { phone },
      include: { user_roles: true }
    });
    if (existing?.actor_type === "customer")
      throw new AppError("SYS-9004", { hint: "الجوال مسجل كعميل — استخدم جوالاً آخر للمالك" });
    if (existing && existing.user_roles.length > 0)
      throw new AppError("SYS-9004", { hint: "الجوال مرتبط بحساب آخر بالفعل" });

    const merchant = await prisma.$transaction(async (tx) => {
      const m = await tx.merchant.create({
        data: { name_ar: body.name_ar, status: "approved", plan_key: "pilot_basic" }
      });
      await tx.brand.create({
        data: {
          merchant_id: m.id,
          name_ar: body.brand_name_ar ?? body.name_ar,
          cuisine_ar: body.cuisine_ar
        }
      });
      const owner =
        existing ??
        (await tx.user.create({
          data: { phone, full_name: body.owner_name, actor_type: "merchant_staff" }
        }));
      await tx.userRole.create({
        data: { user_id: owner.id, role_id: ownerRole.id, merchant_id: m.id }
      });
      return m;
    });
    await audit(sub, "merchant_created", "merchant", merchant.id, body.reason, {
      owner_phone: phone,
      owner_name: body.owner_name
    });
    return { id: merchant.id, name_ar: merchant.name_ar, owner_phone: phone };
  });

  /**
   * A-04ب: ملف التاجر الكامل — كل ما يخص التاجر في رد واحد:
   * البيانات القانونية والبنكية (آخر 4 من IBAN فقط — الكامل يبقى مشفراً docs/16§4)،
   * العلامات والفروع والفريق، مؤشرات الطلبات والمبيعات، آخر الطلبات،
   * التسويات والحوالات، وسجل قرارات المنصة على هذا التاجر.
   */
  app.get("/merchants/:id", async (req) => {
    const { role } = requireAdmin(req, ALL_READ);
    const id = UuidSchema.parse((req.params as { id: string }).id);
    const merchant = await prisma.merchant.findUnique({
      where: { id },
      include: {
        legal_profile: true,
        bank_accounts: { orderBy: [{ is_primary: "desc" }, { created_at: "asc" }] },
        brands: { include: { _count: { select: { branches: true } } }, orderBy: { created_at: "asc" } },
        branches: {
          include: { brand: { select: { name_ar: true } }, _count: { select: { orders: true } } },
          orderBy: { created_at: "asc" }
        },
        staff: {
          include: { branch_assignments: { include: { branch: { select: { name_ar: true } } } } },
          orderBy: { created_at: "asc" }
        }
      }
    });
    if (!merchant) throw new AppError("ORDER-4001");

    /**
     * كلمة مرور الموظف تظهر للسوبر أدمن فقط. الموظفون الأقدم من عمود pin_encrypted:
     * في بيئة العرض (OTP_DEV_FIXED_CODE) نجرب PIN التطوير الموحد ونعبّئ العمود مرة واحدة؛
     * ما تعذّر فكه يظهر «—» حتى يعيّن الأدمن رمزاً جديداً.
     */
    const staffPins = new Map<string, string | null>();
    if (role === "super_admin") {
      const devPin = process.env.OTP_DEV_FIXED_CODE ? "1234" : null;
      for (const s of merchant.staff) {
        let pin = decryptSecret(s.pin_encrypted);
        if (!pin && devPin && (await verifyPin(devPin, s.pin_hash))) {
          pin = devPin;
          await prisma.merchantStaff.update({
            where: { id: s.id },
            data: { pin_encrypted: encryptSecret(devPin) }
          });
        }
        staffPins.set(s.id, pin);
      }
    }

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    // مبيعات = الطلبات التي اكتملت (تشمل ما دخل مسار استرجاع بعد الاكتمال) — الدقة المالية عند التسويات
    const SALE_STATUSES = ["COMPLETED", "REFUND_PENDING", "PARTIALLY_REFUNDED", "REFUNDED"] as const;
    const [
      ordersTotal,
      ordersToday,
      ordersCompleted,
      ordersMissed,
      sales,
      lastOrder,
      recentOrders,
      settlements,
      payouts,
      auditTrail
    ] = await Promise.all([
      prisma.order.count({ where: { merchant_id: id } }),
      prisma.order.count({ where: { merchant_id: id, created_at: { gte: startOfDay } } }),
      prisma.order.count({ where: { merchant_id: id, order_status: { in: [...SALE_STATUSES] } } }),
      prisma.order.count({
        where: { merchant_id: id, order_status: { in: ["CANCELLED", "NO_SHOW", "EXPIRED", "MERCHANT_REJECTED"] } }
      }),
      prisma.order.aggregate({
        where: { merchant_id: id, order_status: { in: [...SALE_STATUSES] } },
        _sum: { total_halalas: true }
      }),
      prisma.order.findFirst({
        where: { merchant_id: id },
        orderBy: { created_at: "desc" },
        select: { created_at: true }
      }),
      prisma.order.findMany({
        where: { merchant_id: id },
        include: { branch: { select: { name_ar: true } } },
        orderBy: { created_at: "desc" },
        take: 10
      }),
      prisma.merchantSettlement.findMany({ where: { merchant_id: id }, orderBy: { period_start: "desc" }, take: 6 }),
      prisma.merchantPayout.findMany({ where: { merchant_id: id }, orderBy: { created_at: "desc" }, take: 6 }),
      prisma.auditLog.findMany({
        where: { entity_type: "merchant", entity_id: id },
        orderBy: { created_at: "desc" },
        take: 10
      })
    ]);

    return {
      id: merchant.id,
      name_ar: merchant.name_ar,
      name_en: merchant.name_en,
      status: merchant.status,
      plan_key: merchant.plan_key,
      settlement_cycle: merchant.settlement_cycle,
      trial_ends_at: merchant.trial_ends_at,
      created_at: merchant.created_at,
      legal: merchant.legal_profile
        ? {
            legal_name: merchant.legal_profile.legal_name,
            cr_number: merchant.legal_profile.cr_number,
            vat_number: merchant.legal_profile.vat_number,
            address: merchant.legal_profile.address
          }
        : null,
      bank_accounts: merchant.bank_accounts.map((b) => ({
        id: b.id,
        bank_name: b.bank_name,
        iban_short: b.iban_short,
        is_primary: b.is_primary
      })),
      brands: merchant.brands.map((b) => ({
        id: b.id,
        name_ar: b.name_ar,
        cuisine_ar: b.cuisine_ar,
        is_active: b.is_active,
        branches: b._count.branches
      })),
      branches: merchant.branches.map((b) => ({
        id: b.id,
        name_ar: b.name_ar,
        brand: b.brand.name_ar,
        branch_code: b.branch_code,
        status: b.status,
        city: b.city,
        address_short: b.address_short,
        phone: b.phone,
        is_active: b.is_active,
        orders: b._count.orders
      })),
      staff: merchant.staff.map((s) => ({
        id: s.id,
        full_name: s.full_name,
        username: s.username,
        role_key: s.role_key,
        status: s.status,
        branches: s.branch_assignments.map((a) => a.branch.name_ar),
        // للسوبر أدمن فقط: null = غير قابلة للعرض (سبقت العمود المشفر)، undefined = دور بلا صلاحية
        pin: role === "super_admin" ? (staffPins.get(s.id) ?? null) : undefined
      })),
      stats: {
        orders_total: ordersTotal,
        orders_today: ordersToday,
        orders_completed: ordersCompleted,
        orders_missed: ordersMissed,
        sales_halalas: sales._sum.total_halalas ?? 0,
        last_order_at: lastOrder?.created_at ?? null
      },
      recent_orders: recentOrders.map((o) => ({
        id: o.id,
        display_code: o.display_code,
        order_status: o.order_status,
        branch: o.branch.name_ar,
        total_halalas: o.total_halalas,
        created_at: o.created_at
      })),
      settlements: settlements.map((s) => ({
        id: s.id,
        period_start: s.period_start,
        period_end: s.period_end,
        gross_halalas: s.gross_halalas,
        net_halalas: s.net_halalas,
        status: s.status
      })),
      payouts: payouts.map((p) => ({
        id: p.id,
        amount_halalas: p.amount_halalas,
        bank_ref: p.bank_ref,
        status: p.status,
        created_at: p.created_at
      })),
      audit_trail: auditTrail.map((a) => ({
        id: a.id,
        action: a.action,
        reason: a.reason,
        created_at: a.created_at
      }))
    };
  });

  app.post("/merchants/:id/approve", async (req) => {
    const { sub } = requireAdmin(req, ["super_admin", "merchant_success"]);
    const id = UuidSchema.parse((req.params as { id: string }).id);
    const body = z.object({ reason: z.string().min(3) }).parse(req.body);
    await prisma.merchant.update({ where: { id }, data: { status: "approved" } });
    await audit(sub, "merchant_approved", "merchant", id, body.reason);
    return { ok: true };
  });

  app.post("/merchants/:id/suspend", async (req) => {
    const { sub, role } = requireAdmin(req, ["super_admin", "risk"]);
    const id = UuidSchema.parse((req.params as { id: string }).id);
    const body = z.object({ reason: z.string().min(3) }).parse(req.body);
    await prisma.merchant.update({ where: { id }, data: { status: "suspended" } });
    await audit(sub, "merchant_suspended", "merchant", id, body.reason, { by_role: role });
    return { ok: true };
  });

  /**
   * A-04ب: تغيير كلمة مرور (PIN) موظف تاجر من ملف التاجر — سوبر أدمن فقط،
   * بسبب إلزامي يدخل سجل التدقيق (BR-15). التحقق يبقى على argon2، والعرض عبر النسخة المشفرة.
   */
  app.post("/merchants/:id/staff/:staffId/pin", async (req) => {
    const { sub } = requireAdmin(req, ["super_admin"]);
    const params = req.params as { id: string; staffId: string };
    const merchantId = UuidSchema.parse(params.id);
    const staffId = UuidSchema.parse(params.staffId);
    const body = z
      .object({
        pin: z.string().regex(/^\d{4,6}$/, "الرمز السري 4-6 أرقام"),
        reason: z.string().min(3)
      })
      .parse(req.body);

    const staff = await prisma.merchantStaff.findFirst({
      where: { id: staffId, merchant_id: merchantId, status: { not: "removed" } }
    });
    if (!staff) throw new AppError("ORDER-4001");

    await prisma.merchantStaff.update({
      where: { id: staffId },
      data: { pin_hash: await hashPin(body.pin), pin_encrypted: encryptSecret(body.pin) }
    });
    await audit(sub, "staff_pin_reset", "merchant_staff", staffId, body.reason, {
      merchant_id: merchantId,
      username: staff.username
    });
    return { ok: true };
  });

  /** A-07: الطلبات (سجل كامل — تجاوز عزل للقراءة، مسموح للأدمن بطبيعته) */
  app.get("/orders", async (req) => {
    requireAdmin(req, ALL_READ);
    const q = z
      .object({
        status: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(100).default(50)
      })
      .parse(req.query);
    const orders = await prisma.order.findMany({
      where: q.status ? { order_status: q.status as never } : {},
      include: { branch: { include: { brand: true } }, user: true },
      orderBy: { created_at: "desc" },
      take: q.limit
    });
    return orders.map((o) => ({
      id: o.id,
      display_code: o.display_code,
      order_status: o.order_status,
      brand: o.branch.brand.name_ar,
      branch: o.branch.name_ar,
      customer_phone_masked: `${o.user.phone.slice(0, 7)}****`,
      total_halalas: o.total_halalas,
      created_at: o.created_at
    }));
  });

  /** A-08: الخط الزمني للطلب */
  app.get("/orders/:id/timeline", async (req) => {
    requireAdmin(req, ALL_READ);
    const id = UuidSchema.parse((req.params as { id: string }).id);
    const history = await prisma.orderStatusHistory.findMany({
      where: { order_id: id },
      orderBy: { created_at: "asc" }
    });
    if (history.length === 0) throw new AppError("ORDER-4001");
    return history.map((h) => ({
      from: h.from_status,
      to: h.to_status,
      actor: h.actor_type,
      reason: h.reason,
      at: h.created_at
    }));
  });

  /** A-11: الاسترجاعات + قرار (Finance بلا سقف — docs/16§2) */
  app.get("/refunds", async (req) => {
    requireAdmin(req, ALL_READ);
    const refunds = await prisma.refund.findMany({
      include: { order: { select: { display_code: true } } },
      orderBy: { created_at: "desc" },
      take: 100
    });
    return refunds.map((r) => ({
      id: r.id,
      order_code: r.order.display_code,
      amount_halalas: r.amount_halalas,
      reason: r.reason,
      status: r.status,
      requested_by: r.requested_by,
      created_at: r.created_at
    }));
  });

  app.post("/refunds/:id/decision", async (req) => {
    const { sub } = requireAdmin(req, ["super_admin", "finance"]);
    const id = UuidSchema.parse((req.params as { id: string }).id);
    const body = z
      .object({ decision: z.enum(["approve", "reject"]), reason: z.string().min(3) })
      .parse(req.body);
    const refund = await prisma.refund.findUnique({ where: { id } });
    if (!refund) throw new AppError("ORDER-4001");
    if (refund.status !== "pending") throw new AppError("ORDER-4002", { status: refund.status });

    if (body.decision === "reject") {
      await prisma.refund.update({ where: { id }, data: { status: "rejected" } });
    }
    // approve: تبقى pending — refund-processor في الـworker ينفذها عند البوابة
    await audit(sub, `refund_${body.decision}`, "refund", id, body.reason);
    return { ok: true, status: body.decision === "reject" ? "rejected" : "pending" };
  });

  /** A-13: العملاء + حظر/رفع (Risk) */
  app.get("/customers", async (req) => {
    requireAdmin(req, ALL_READ);
    const users = await prisma.user.findMany({
      where: { actor_type: "customer" },
      include: { customer_profile: true, _count: { select: { orders: true } } },
      orderBy: { created_at: "desc" },
      take: 100
    });
    return users.map((u) => ({
      id: u.id,
      phone_masked: `${u.phone.slice(0, 7)}****`,
      full_name: u.full_name,
      status: u.status,
      orders: u._count.orders,
      no_show_count_30d: u.customer_profile?.no_show_count_30d ?? 0,
      risk_flagged: Boolean(u.customer_profile?.risk_flagged_at)
    }));
  });

  app.post("/customers/:id/block", async (req) => {
    const { sub } = requireAdmin(req, ["super_admin", "risk"]);
    const id = UuidSchema.parse((req.params as { id: string }).id);
    const body = z
      .object({ action: z.enum(["block", "unblock"]), reason: z.string().min(3) })
      .parse(req.body);
    await prisma.user.update({
      where: { id },
      data: { status: body.action === "block" ? "blocked" : "active" }
    });
    await audit(sub, `customer_${body.action}`, "user", id, body.reason);
    return { ok: true };
  });

  /** A-24/A-26: الصحة — jobs وdead letters وwebhooks */
  app.get("/health-ops", async (req) => {
    requireAdmin(req, ["super_admin", "operations", "read_only"]);
    const [pendingJobs, failedJobs, deadLetters, recentEvents] = await Promise.all([
      prisma.backgroundJob.count({ where: { status: "pending" } }),
      prisma.backgroundJob.count({ where: { status: "failed" } }),
      prisma.deadLetterJob.findMany({ where: { resolved_at: null }, take: 20, orderBy: { moved_at: "desc" } }),
      prisma.backgroundJob.findMany({
        where: { job_type: "domain_event", status: "completed" },
        orderBy: { created_at: "desc" },
        take: 10,
        select: { payload: true, created_at: true }
      })
    ]);
    return {
      jobs_pending: pendingJobs,
      jobs_failed: failedJobs,
      dead_letters: deadLetters.map((d) => ({ id: d.id, job_type: d.job_type, error: d.error, moved_at: d.moved_at })),
      recent_events: recentEvents.map((e) => ({
        name: (e.payload as { name?: string }).name ?? "?",
        at: e.created_at
      }))
    };
  });

  /** A-22: سجل العمليات */
  app.get("/audit-logs", async (req) => {
    requireAdmin(req, ALL_READ);
    const logs = await prisma.auditLog.findMany({ orderBy: { created_at: "desc" }, take: 100 });
    return logs.map((l) => ({
      id: l.id,
      actor_type: l.actor_type,
      action: l.action,
      entity_type: l.entity_type,
      entity_id: l.entity_id,
      reason: l.reason,
      created_at: l.created_at
    }));
  });

  /** التسويات عبر كل التجار (Finance) */
  app.get("/settlements", async (req) => {
    requireAdmin(req, ["super_admin", "finance", "read_only"]);
    const settlements = await prisma.merchantSettlement.findMany({
      include: { merchant: { select: { name_ar: true } } },
      orderBy: { period_start: "desc" },
      take: 50
    });
    return settlements.map((s) => ({
      id: s.id,
      merchant: s.merchant.name_ar,
      period_start: s.period_start,
      period_end: s.period_end,
      net_halalas: s.net_halalas,
      status: s.status
    }));
  });

  // ===== A-23: Feature Flags — FR-A11 =====

  app.get("/flags", async (req) => {
    requireAdmin(req, ALL_READ);
    const flags = await prisma.featureFlag.findMany({ orderBy: { key: "asc" } });
    return flags.map((f) => ({
      key: f.key,
      enabled: f.enabled,
      updated_by: f.updated_by,
      updated_at: f.updated_at
    }));
  });

  app.post("/flags/:key", async (req) => {
    const { sub } = requireAdmin(req, ["super_admin", "operations"]);
    const key = z.string().min(2).max(64).parse((req.params as { key: string }).key);
    const body = z.object({ enabled: z.boolean(), reason: z.string().min(3) }).parse(req.body);
    const flag = await prisma.featureFlag.upsert({
      where: { key },
      create: { key, enabled: body.enabled, updated_by: sub },
      update: { enabled: body.enabled, updated_by: sub }
    });
    invalidateFlagCache();
    await audit(sub, "feature_flag_set", "feature_flag", flag.id, body.reason, { key, enabled: body.enabled });
    return { key: flag.key, enabled: flag.enabled };
  });

  // ===== A-15: الدعم — تذاكر ببيانات الطلب مدمجة (FR-A09) =====

  app.get("/support-tickets", async (req) => {
    requireAdmin(req, ALL_READ);
    const q = z.object({ status: z.string().optional() }).parse(req.query);
    const tickets = await prisma.supportTicket.findMany({
      where: q.status ? { status: q.status as never } : {},
      include: {
        user: { select: { phone: true, full_name: true } },
        _count: { select: { messages: true } }
      },
      orderBy: { updated_at: "desc" },
      take: 100
    });
    const orderIds = tickets.flatMap((t) => (t.order_id ? [t.order_id] : []));
    const orders = await prisma.order.findMany({
      where: { id: { in: orderIds } },
      select: { id: true, display_code: true }
    });
    const codeOf = new Map(orders.map((o) => [o.id, o.display_code]));
    return tickets.map((t) => ({
      id: t.id,
      subject: t.subject,
      status: t.status,
      priority: t.priority,
      customer_phone_masked: t.user ? `${t.user.phone.slice(0, 7)}****` : null,
      customer_name: t.user?.full_name ?? null,
      order_code: t.order_id ? (codeOf.get(t.order_id) ?? null) : null,
      messages: t._count.messages,
      created_at: t.created_at,
      updated_at: t.updated_at
    }));
  });

  app.get("/support-tickets/:id", async (req) => {
    requireAdmin(req, ALL_READ);
    const id = UuidSchema.parse((req.params as { id: string }).id);
    const ticket = await prisma.supportTicket.findUnique({
      where: { id },
      include: {
        user: { select: { phone: true, full_name: true } },
        messages: { orderBy: { created_at: "asc" } }
      }
    });
    if (!ticket) throw new AppError("SYS-9004", { hint: "التذكرة غير موجودة" });
    return {
      id: ticket.id,
      subject: ticket.subject,
      status: ticket.status,
      priority: ticket.priority,
      customer_phone_masked: ticket.user ? `${ticket.user.phone.slice(0, 7)}****` : null,
      customer_name: ticket.user?.full_name ?? null,
      order_id: ticket.order_id,
      messages: ticket.messages.map((m) => ({
        id: m.id,
        author: m.author,
        body: m.body,
        created_at: m.created_at
      }))
    };
  });

  app.post("/support-tickets/:id/reply", async (req) => {
    const { sub } = requireAdmin(req, ["super_admin", "support", "operations"]);
    const id = UuidSchema.parse((req.params as { id: string }).id);
    const body = z.object({ body: z.string().trim().min(1).max(2000) }).parse(req.body);
    const ticket = await prisma.supportTicket.findUnique({ where: { id } });
    if (!ticket) throw new AppError("SYS-9004", { hint: "التذكرة غير موجودة" });

    await prisma.$transaction(async (tx) => {
      await tx.supportMessage.create({
        data: { ticket_id: id, author: "admin", author_id: sub, body: body.body }
      });
      await tx.supportTicket.update({ where: { id }, data: { status: "pending_customer" } });
      if (ticket.user_id) {
        await notifyCustomer(tx, {
          user_id: ticket.user_id,
          template_key: "support_reply",
          order_id: ticket.order_id,
          vars: { subject: ticket.subject },
          dedupe_key: `support_reply:${id}:${Date.now()}`
        });
      }
    });
    return { ok: true };
  });

  app.post("/support-tickets/:id/status", async (req) => {
    const { sub } = requireAdmin(req, ["super_admin", "support", "operations"]);
    const id = UuidSchema.parse((req.params as { id: string }).id);
    const body = z
      .object({
        status: z.enum(["open", "pending_customer", "pending_merchant", "resolved", "closed"]),
        reason: z.string().min(3)
      })
      .parse(req.body);
    const ticket = await prisma.supportTicket.findUnique({ where: { id } });
    if (!ticket) throw new AppError("SYS-9004", { hint: "التذكرة غير موجودة" });
    await prisma.supportTicket.update({ where: { id }, data: { status: body.status } });
    await audit(sub, "support_ticket_status", "support_ticket", id, body.reason, { status: body.status });
    return { ok: true };
  });

  // ===== A-12: العروض والكوبونات — BR-7 (تكلفة العرض تُنسب لطرفها) =====

  app.get("/coupons", async (req) => {
    requireAdmin(req, ALL_READ);
    const coupons = await prisma.coupon.findMany({
      include: {
        merchant: { select: { name_ar: true } },
        _count: { select: { redemptions: true } }
      },
      orderBy: { created_at: "desc" },
      take: 100
    });
    return coupons.map((c) => ({
      id: c.id,
      code: c.code,
      type: c.type,
      value: c.value,
      min_order_halalas: c.min_order_halalas,
      max_uses_total: c.max_uses_total,
      max_uses_per_user: c.max_uses_per_user,
      new_users_only: c.new_users_only,
      starts_at: c.starts_at,
      ends_at: c.ends_at,
      merchant: c.merchant?.name_ar ?? null,
      merchant_share_bp: c.merchant_share_bp,
      is_active: c.is_active,
      redemptions: c._count.redemptions
    }));
  });

  app.post("/coupons", async (req) => {
    const { sub } = requireAdmin(req, ["super_admin", "operations"]);
    const body = z
      .object({
        code: z.string().trim().min(2).max(32).transform((s) => s.toUpperCase()),
        type: z.enum(["amount", "percent"]),
        value: z.number().int().positive(),
        min_order_halalas: z.number().int().positive().nullable().default(null),
        max_uses_total: z.number().int().positive().nullable().default(null),
        max_uses_per_user: z.number().int().positive().nullable().default(null),
        new_users_only: z.boolean().default(false),
        starts_at: z.string().datetime().nullable().default(null),
        ends_at: z.string().datetime().nullable().default(null),
        merchant_id: UuidSchema.nullable().default(null),
        merchant_share_bp: z.number().int().min(0).max(10000).default(0),
        reason: z.string().min(3)
      })
      .parse(req.body);
    if (body.type === "percent" && body.value > 100) throw new AppError("SYS-9004", { hint: "نسبة > 100%" });

    const coupon = await prisma.coupon.create({
      data: {
        code: body.code,
        type: body.type,
        value: body.value,
        min_order_halalas: body.min_order_halalas,
        max_uses_total: body.max_uses_total,
        max_uses_per_user: body.max_uses_per_user,
        new_users_only: body.new_users_only,
        starts_at: body.starts_at ? new Date(body.starts_at) : null,
        ends_at: body.ends_at ? new Date(body.ends_at) : null,
        merchant_id: body.merchant_id,
        merchant_share_bp: body.merchant_share_bp
      }
    });
    await audit(sub, "coupon_created", "coupon", coupon.id, body.reason, { code: coupon.code });
    return { id: coupon.id, code: coupon.code };
  });

  app.post("/coupons/:id/toggle", async (req) => {
    const { sub } = requireAdmin(req, ["super_admin", "operations"]);
    const id = UuidSchema.parse((req.params as { id: string }).id);
    const body = z.object({ is_active: z.boolean(), reason: z.string().min(3) }).parse(req.body);
    await prisma.coupon.update({ where: { id }, data: { is_active: body.is_active } });
    await audit(sub, "coupon_toggled", "coupon", id, body.reason, { is_active: body.is_active });
    return { ok: true };
  });

  app.get("/promotions", async (req) => {
    requireAdmin(req, ALL_READ);
    const promos = await prisma.promotion.findMany({
      include: {
        merchant: { select: { name_ar: true } },
        rules: true,
        _count: { select: { coupons: true } }
      },
      orderBy: { name_ar: "asc" },
      take: 50
    });
    return promos.map((p) => ({
      id: p.id,
      name_ar: p.name_ar,
      merchant: p.merchant?.name_ar ?? null,
      starts_at: p.starts_at,
      ends_at: p.ends_at,
      is_active: p.is_active,
      coupons: p._count.coupons,
      rules: p.rules.map((r) => ({ key: r.rule_key, value: r.rule_value }))
    }));
  });

  app.post("/promotions", async (req) => {
    const { sub } = requireAdmin(req, ["super_admin", "operations"]);
    const body = z
      .object({
        name_ar: z.string().trim().min(2).max(80),
        merchant_id: UuidSchema.nullable().default(null),
        starts_at: z.string().datetime().nullable().default(null),
        ends_at: z.string().datetime().nullable().default(null),
        rules: z.array(z.object({ rule_key: z.string().min(2), rule_value: z.unknown() })).default([]),
        reason: z.string().min(3)
      })
      .parse(req.body);
    const promo = await prisma.promotion.create({
      data: {
        name_ar: body.name_ar,
        merchant_id: body.merchant_id,
        starts_at: body.starts_at ? new Date(body.starts_at) : null,
        ends_at: body.ends_at ? new Date(body.ends_at) : null,
        rules: { create: body.rules.map((r) => ({ rule_key: r.rule_key, rule_value: r.rule_value as never })) }
      }
    });
    await audit(sub, "promotion_created", "promotion", promo.id, body.reason);
    return { id: promo.id };
  });

  // ===== A-13: CMS — قوالب الإشعارات (docs/15§48) + بانرات (system_settings) =====

  app.get("/cms/templates", async (req) => {
    requireAdmin(req, ALL_READ);
    const templates = await prisma.notificationTemplate.findMany({ orderBy: { key: "asc" } });
    return templates.map((t) => ({
      key: t.key,
      channel: t.channel,
      title_ar: t.title_ar,
      body_ar: t.body_ar,
      is_active: t.is_active
    }));
  });

  app.post("/cms/templates/:key", async (req) => {
    const { sub } = requireAdmin(req, ["super_admin", "operations"]);
    const key = z.string().min(2).max(64).parse((req.params as { key: string }).key);
    const body = z
      .object({
        title_ar: z.string().trim().min(1).max(120),
        body_ar: z.string().trim().min(1).max(500),
        is_active: z.boolean().default(true),
        reason: z.string().min(3)
      })
      .parse(req.body);
    const tpl = await prisma.notificationTemplate.upsert({
      where: { key },
      create: { key, channel: "push", title_ar: body.title_ar, body_ar: body.body_ar, is_active: body.is_active },
      update: { title_ar: body.title_ar, body_ar: body.body_ar, is_active: body.is_active }
    });
    await audit(sub, "cms_template_saved", "notification_template", tpl.id, body.reason, { key });
    return { ok: true };
  });

  app.get("/cms/banners", async (req) => {
    requireAdmin(req, ALL_READ);
    const setting = await prisma.systemSetting.findFirst({
      where: { key: "cms.banners" },
      orderBy: { effective_at: "desc" }
    });
    return { banners: setting?.value ?? [] };
  });

  /** البانرات تُحفظ صفاً جديداً — system_settings سجل تاريخي (key, effective_at) */
  app.post("/cms/banners", async (req) => {
    const { sub } = requireAdmin(req, ["super_admin", "operations"]);
    const body = z
      .object({
        banners: z.array(
          z.object({
            title_ar: z.string().trim().min(1).max(80),
            body_ar: z.string().max(200).nullable().default(null),
            image_url: BannerImageSchema.nullable().default(null),
            link: z.string().max(500).nullable().default(null)
          })
        ),
        reason: z.string().min(3)
      })
      .parse(req.body);
    const setting = await prisma.systemSetting.create({
      data: { key: "cms.banners", value: body.banners as never, created_by: sub }
    });
    await audit(sub, "cms_banners_saved", "system_setting", setting.id, body.reason, {
      count: body.banners.length
    });
    return { ok: true };
  });

  // ===== تصنيفات المطاعم C-09 — قائمة بترتيبها في system_settings:cms.categories =====

  app.get("/cms/categories", async (req) => {
    requireAdmin(req, ALL_READ);
    const setting = await prisma.systemSetting.findFirst({
      where: { key: "cms.categories" },
      orderBy: { effective_at: "desc" }
    });
    return { categories: setting?.value ?? [] };
  });

  /** تُحفظ صفاً جديداً — system_settings سجل تاريخي (key, effective_at) */
  app.post("/cms/categories", async (req) => {
    const { sub } = requireAdmin(req, ["super_admin", "operations"]);
    const body = z
      .object({
        categories: z
          .array(
            z.object({
              name_ar: z.string().trim().min(1).max(40),
              is_active: z.boolean().default(true)
            })
          )
          .max(30)
          .refine(
            (cats) => new Set(cats.map((c) => c.name_ar)).size === cats.length,
            "أسماء التصنيفات يجب أن تكون فريدة"
          ),
        reason: z.string().min(3)
      })
      .parse(req.body);
    const setting = await prisma.systemSetting.create({
      data: { key: "cms.categories", value: body.categories as never, created_by: sub }
    });
    await audit(sub, "cms_categories_saved", "system_setting", setting.id, body.reason, {
      count: body.categories.length
    });
    return { ok: true };
  });

  // ===== رسوم خدمة بيكلي — قيمة الرسم وحصة التاجر منه (system_settings:pricing.service_fee) =====

  app.get("/pricing/service-fee", async (req) => {
    requireAdmin(req, ALL_READ);
    const setting = await prisma.systemSetting.findFirst({
      where: { key: "pricing.service_fee" },
      orderBy: { effective_at: "desc" }
    });
    if (setting) {
      const v = setting.value as { amount_halalas?: number; merchant_share_halalas?: number };
      return {
        amount_halalas: v.amount_halalas ?? 0,
        merchant_share_halalas: v.merchant_share_halalas ?? 0
      };
    }
    const fee = await prisma.fee.findUnique({ where: { key: "pickly_service_fee" } });
    return { amount_halalas: fee?.amount_halalas ?? 0, merchant_share_halalas: 0 };
  });

  /** يُحفظ صفاً جديداً — system_settings سجل تاريخي؛ يسري على التسعيرات الجديدة فوراً */
  app.post("/pricing/service-fee", async (req) => {
    const { sub } = requireAdmin(req, ["super_admin", "finance"]);
    const body = z
      .object({
        amount_halalas: z.number().int().min(0).max(10_000),
        merchant_share_halalas: z.number().int().min(0),
        reason: z.string().min(3)
      })
      .refine((b) => b.merchant_share_halalas <= b.amount_halalas, {
        message: "حصة التاجر لا تتجاوز قيمة الرسم"
      })
      .parse(req.body);
    const setting = await prisma.systemSetting.create({
      data: {
        key: "pricing.service_fee",
        value: {
          amount_halalas: body.amount_halalas,
          merchant_share_halalas: body.merchant_share_halalas
        } as never,
        created_by: sub
      }
    });
    await audit(sub, "pricing_service_fee_saved", "system_setting", setting.id, body.reason, {
      amount_halalas: body.amount_halalas,
      merchant_share_halalas: body.merchant_share_halalas
    });
    return { ok: true };
  });

  // ===== طرق الدفع الظاهرة للعميل — system_settings:payments.methods (قرار المالك 2026-07-12) =====

  app.get("/payments/methods", async (req) => {
    requireAdmin(req, ALL_READ);
    return { methods: await paymentMethodsConfig() };
  });

  /** تُحفظ صفاً جديداً — system_settings سجل تاريخي (key, effective_at) */
  app.post("/payments/methods", async (req) => {
    const { sub } = requireAdmin(req, ["super_admin", "finance"]);
    const body = z
      .object({
        methods: z
          .array(
            z.object({
              key: z.enum(["apple_pay", "card", "stc_pay"]),
              name_ar: z.string().trim().min(1).max(60),
              desc_ar: z.string().max(160).nullable().default(null),
              badge_ar: z.string().max(20).nullable().default(null),
              is_active: z.boolean().default(true)
            })
          )
          .min(1)
          .max(10)
          .refine(
            (ms) => new Set(ms.map((m) => m.key)).size === ms.length,
            "لا تكرار لنفس الطريقة"
          )
          .refine((ms) => ms.some((m) => m.is_active), "طريقة واحدة فعالة على الأقل"),
        reason: z.string().min(3)
      })
      .parse(req.body);
    const setting = await prisma.systemSetting.create({
      data: { key: "payments.methods", value: body.methods as never, created_by: sub }
    });
    await audit(sub, "payment_methods_saved", "system_setting", setting.id, body.reason, {
      active: body.methods.filter((m) => m.is_active).map((m) => m.key)
    });
    return { ok: true };
  });

  // ===== نصف قطر تفعيل «وصلت» — العميل لا يؤكد الوصول إلا داخله (system_settings:ops.arrival_radius_m) =====

  app.get("/ops/arrival-radius", async (req) => {
    requireAdmin(req, ALL_READ);
    const setting = await prisma.systemSetting.findFirst({
      where: { key: "ops.arrival_radius_m" },
      orderBy: { effective_at: "desc" }
    });
    const v = Number(setting?.value);
    return { radius_m: Number.isFinite(v) && v > 0 ? v : 500 };
  });

  /** يُحفظ صفاً جديداً — system_settings سجل تاريخي (key, effective_at)؛ يسري على الطلبات الحية فوراً */
  app.post("/ops/arrival-radius", async (req) => {
    const { sub } = requireAdmin(req, ["super_admin", "operations"]);
    const body = z
      .object({
        radius_m: z.number().int().min(50).max(5000),
        reason: z.string().min(3)
      })
      .parse(req.body);
    const setting = await prisma.systemSetting.create({
      data: { key: "ops.arrival_radius_m", value: body.radius_m as never, created_by: sub }
    });
    await audit(sub, "ops_arrival_radius_saved", "system_setting", setting.id, body.reason, {
      radius_m: body.radius_m
    });
    return { ok: true, radius_m: body.radius_m };
  });

  // ===== خريطة الملاحة (OSRM) — تحديث بضغطة من السوبر أدمن =====
  // آمن: الـAPI يُسقِط إشارة nav-map.request في مجلد OPS المشترك، ومراقب systemd على
  // المضيف (خارج أي حاوية ويب) ينزّل الخريطة ويعالجها ويعيد تشغيل الخدمة، ويكتب الحالة.

  const opsDir = process.env.OPS_DIR ?? "/ops";
  const navStatusPath = path.join(opsDir, "nav-map.status.json");
  const navRequestPath = path.join(opsDir, "nav-map.request");

  const readNavStatus = async (): Promise<{ state: string; step: string; message: string; at: string }> => {
    try {
      const j = JSON.parse(await fs.readFile(navStatusPath, "utf8")) as Partial<{
        state: string;
        step: string;
        message: string;
        at: string;
      }>;
      return { state: j.state ?? "idle", step: j.step ?? "", message: j.message ?? "", at: j.at ?? "" };
    } catch {
      return { state: "idle", step: "", message: "لم يُحدَّث بعد", at: "" };
    }
  };

  app.get("/ops/nav-map", async (req) => {
    requireAdmin(req, ALL_READ);
    return readNavStatus();
  });

  /** يُسقِط إشارة التحديث ليلتقطها مراقب المضيف؛ يرفض التكرار أثناء تحديث جارٍ */
  app.post("/ops/nav-map/rebuild", async (req) => {
    const { sub } = requireAdmin(req, ["super_admin", "operations"]);
    const body = z.object({ reason: z.string().min(3) }).parse(req.body);
    const status = await readNavStatus();
    if (status.state === "running") {
      return { ok: false, running: true, message: "التحديث جارٍ بالفعل — انتظر اكتماله", status };
    }
    const at = new Date().toISOString();
    await fs.writeFile(navRequestPath, JSON.stringify({ requested_by: sub, at }));
    // حالة تفاؤلية فورية حتى يبدأ المراقب ويكتب تقدّمه الفعلي
    await fs.writeFile(navStatusPath, JSON.stringify({ state: "running", step: "queued", message: "بدأ التحديث…", at }));
    await audit(sub, "ops_nav_map_rebuild", "system", "osrm", body.reason);
    return { ok: true };
  });

  // ===== محفظة بيكلي — رصيد العملاء: عرض + إيداع/خصم بسبب مُدقق (docs/01§1) =====

  app.get("/wallet", async (req) => {
    requireAdmin(req, ALL_READ);
    const { phone } = z.object({ phone: z.string().min(9).max(15) }).parse(req.query);
    const normalized = phone.startsWith("05") ? `+966${phone.slice(1)}` : phone;
    const user = await prisma.user.findUnique({ where: { phone: normalized } });
    if (!user) throw new AppError("SYS-9004", { hint: "لا عميل بهذا الجوال" });
    const [agg, entries] = await Promise.all([
      prisma.customerWalletEntry.aggregate({
        where: { user_id: user.id },
        _sum: { amount_halalas: true }
      }),
      prisma.customerWalletEntry.findMany({
        where: { user_id: user.id },
        orderBy: { created_at: "desc" },
        take: 20
      })
    ]);
    return {
      user_id: user.id,
      phone: user.phone,
      full_name: user.full_name,
      balance_halalas: agg._sum.amount_halalas ?? 0,
      entries: entries.map((e) => ({
        id: e.id,
        amount_halalas: e.amount_halalas,
        entry_type: e.entry_type,
        reference: e.reference,
        created_at: e.created_at.toISOString()
      }))
    };
  });

  /** إيداع (موجب) أو خصم (سالب) — الرصيد لا يهبط تحت الصفر؛ كل حركة بسبب في التدقيق */
  app.post("/wallet/adjust", async (req) => {
    const { sub } = requireAdmin(req, ["super_admin", "finance"]);
    const body = z
      .object({
        user_id: UuidSchema,
        amount_halalas: z
          .number()
          .int()
          .refine((v) => v !== 0, "المبلغ لا يكون صفراً")
          .refine((v) => Math.abs(v) <= 500_000, "الحد الأقصى للحركة 5000 ر.س"),
        reason: z.string().min(3)
      })
      .parse(req.body);
    const user = await prisma.user.findUnique({ where: { id: body.user_id } });
    if (!user) throw new AppError("SYS-9004", { hint: "العميل غير موجود" });

    const entry = await prisma.$transaction(async (tx) => {
      const agg = await tx.customerWalletEntry.aggregate({
        where: { user_id: body.user_id },
        _sum: { amount_halalas: true }
      });
      const balance = agg._sum.amount_halalas ?? 0;
      if (balance + body.amount_halalas < 0)
        throw new AppError("PAY-5006", { hint: "الخصم يتجاوز رصيد المحفظة" });
      return tx.customerWalletEntry.create({
        data: {
          user_id: body.user_id,
          amount_halalas: body.amount_halalas,
          entry_type: body.amount_halalas > 0 ? "credit" : "debit",
          reference: "admin"
        }
      });
    });
    await audit(sub, "wallet_adjusted", "customer_wallet_entry", entry.id, body.reason, {
      user_id: body.user_id,
      amount_halalas: body.amount_halalas
    });
    return { ok: true, entry_id: entry.id };
  });

  // ===== العلامات: إسناد تصنيف كل مطعم (brand.cuisine_ar) — تصفية C-09 تعتمد عليه =====

  app.get("/brands", async (req) => {
    requireAdmin(req, ALL_READ);
    const brands = await prisma.brand.findMany({
      include: { merchant: { select: { name_ar: true } } },
      orderBy: { created_at: "asc" }
    });
    return brands.map((b) => ({
      id: b.id,
      name_ar: b.name_ar,
      merchant_name_ar: b.merchant.name_ar,
      cuisine_ar: b.cuisine_ar,
      is_active: b.is_active
    }));
  });

  app.post("/brands/:id/cuisine", async (req) => {
    const { sub } = requireAdmin(req, ["super_admin", "operations"]);
    const id = UuidSchema.parse((req.params as { id: string }).id);
    const body = z
      .object({
        cuisine_ar: z.string().trim().max(40).nullable(),
        reason: z.string().min(3)
      })
      .parse(req.body);
    const brand = await prisma.brand.update({
      where: { id },
      data: { cuisine_ar: body.cuisine_ar || null }
    });
    await audit(sub, "brand_cuisine_set", "brand", brand.id, body.reason, {
      cuisine_ar: body.cuisine_ar
    });
    return { ok: true };
  });

  // ===== A-16: المخاطر — إشارات docs/17§6 محسوبة من البيانات القائمة =====

  app.get("/risk/alerts", async (req) => {
    requireAdmin(req, ["super_admin", "risk", "operations", "read_only"]);
    const monthAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000);

    const [flagged, noShows, refundGroups, disputes] = await Promise.all([
      prisma.customerProfile.findMany({
        where: { risk_flagged_at: { not: null } },
        include: { user: { select: { phone: true, full_name: true, status: true } } }
      }),
      prisma.customerProfile.findMany({
        where: { no_show_count_30d: { gte: 2 } },
        include: { user: { select: { phone: true, full_name: true, status: true } } }
      }),
      prisma.refund.groupBy({
        by: ["requester_id"],
        where: { requested_by: "customer", requester_id: { not: null }, created_at: { gte: monthAgo } },
        _count: { _all: true },
        having: { requester_id: { _count: { gte: 3 } } }
      }),
      prisma.disputeCase.findMany({ where: { status: "open" }, take: 20, orderBy: { created_at: "desc" } })
    ]);

    const refundUserIds = refundGroups.flatMap((g) => (g.requester_id ? [g.requester_id] : []));
    const refundUsers = await prisma.user.findMany({
      where: { id: { in: refundUserIds } },
      select: { id: true, phone: true, full_name: true, status: true }
    });
    const refundCountOf = new Map(refundGroups.map((g) => [g.requester_id, g._count._all]));

    type Alert = {
      user_id: string | null;
      phone_masked: string | null;
      name: string | null;
      signal: string;
      severity: "high" | "medium";
      detail: string;
      user_status: string | null;
    };
    const alerts: Alert[] = [
      ...flagged.map((p): Alert => ({
        user_id: p.user_id,
        phone_masked: `${p.user.phone.slice(0, 7)}****`,
        name: p.user.full_name,
        signal: "risk_flagged",
        severity: "high",
        detail: `مُعلَّم يدوياً/آلياً منذ ${p.risk_flagged_at?.toISOString().slice(0, 10)}`,
        user_status: p.user.status
      })),
      ...noShows.map((p): Alert => ({
        user_id: p.user_id,
        phone_masked: `${p.user.phone.slice(0, 7)}****`,
        name: p.user.full_name,
        signal: "no_show_repeat",
        severity: p.no_show_count_30d >= 3 ? "high" : "medium",
        detail: `${p.no_show_count_30d} حالات عدم حضور خلال 30 يوماً (BR-3)`,
        user_status: p.user.status
      })),
      ...refundUsers.map((u): Alert => ({
        user_id: u.id,
        phone_masked: `${u.phone.slice(0, 7)}****`,
        name: u.full_name,
        signal: "refund_abuse",
        severity: "medium",
        detail: `${refundCountOf.get(u.id) ?? 0} طلبات استرجاع خلال 30 يوماً (docs/17§6)`,
        user_status: u.status
      })),
      ...disputes.map((d): Alert => ({
        user_id: null,
        phone_masked: null,
        name: null,
        signal: "open_dispute",
        severity: "medium",
        detail: `نزاع مفتوح (${d.kind}) بمبلغ ${d.amount_halalas ?? 0} هللة`,
        user_status: null
      }))
    ];
    return alerts;
  });

  app.post("/risk/customers/:id/flag", async (req) => {
    const { sub } = requireAdmin(req, ["super_admin", "risk"]);
    const id = UuidSchema.parse((req.params as { id: string }).id);
    const body = z.object({ action: z.enum(["flag", "clear"]), reason: z.string().min(3) }).parse(req.body);

    await prisma.$transaction(async (tx) => {
      await tx.customerProfile.upsert({
        where: { user_id: id },
        create: { user_id: id, risk_flagged_at: body.action === "flag" ? new Date() : null },
        update: { risk_flagged_at: body.action === "flag" ? new Date() : null }
      });
      if (body.action === "flag") {
        await emitEvent(tx, {
          name: "risk.alert_raised",
          aggregate_type: "user",
          aggregate_id: id,
          payload: { source: "admin_manual", reason: body.reason }
        });
      }
    });
    await audit(sub, `risk_${body.action}`, "user", id, body.reason);
    return { ok: true };
  });
}
