import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { prisma } from "@pickly/database";
import { AppError } from "@pickly/observability";
import { UuidSchema } from "@pickly/contracts";
import { requireAuth } from "../../lib/auth-plugin.js";

/**
 * وحدة Super Admin — نطاق الطيار (docs/21§3):
 * التجار، الطلبات، المالية، العملاء/المخاطر (مراجعة يدوية)، الصحة، Audit.
 * المؤجل: CMS الكامل، Feature Flags UI، محرك مخاطر آلي، العروض المشتركة.
 * RBAC: docs/16§2 — كل فعل حساس يدخل audit_logs بسبب (BR-15).
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
}
