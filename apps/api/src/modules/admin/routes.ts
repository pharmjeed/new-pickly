import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { prisma } from "@pickly/database";
import { AppError } from "@pickly/observability";
import { UuidSchema } from "@pickly/contracts";
import { requireAuth } from "../../lib/auth-plugin.js";
import { emitEvent } from "../../lib/events.js";
import { invalidateFlagCache } from "../../lib/flags.js";
import { notifyCustomer } from "../../lib/notify.js";

/**
 * وحدة Super Admin — docs/16§2 RBAC، كل فعل حساس يدخل audit_logs بسبب (BR-15):
 * التجار، الطلبات، المالية، العملاء، الصحة، Audit
 * + مرحلة 2: CMS (A-13)، العروض (A-12/BR-7)، الدعم (A-15)، المخاطر (A-16)، Feature Flags (A-23).
 */

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
            image_url: z.string().max(500).nullable().default(null),
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
