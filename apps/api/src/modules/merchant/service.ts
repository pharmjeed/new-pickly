import { prisma, type Prisma } from "@pickly/database";
import type { BranchOrderCard, OrderState } from "@pickly/contracts";
import { AppError } from "@pickly/observability";
import { emitEvent, scheduleJob } from "../../lib/events.js";
import { transitionOrder } from "../../lib/state-machine.js";
import { handoffCodeFor } from "../../lib/codes.js";
import { completeHandoff } from "../pickup/service.js";
import { payments } from "../orders/service.js";

/**
 * وحدة Branch Operations (نطاق الشريحة) — لوحة B-03:
 * بيانات العميل مقنّعة، والسيارة كاملة أثناء الطلب النشط فقط (docs/10§3-4).
 */

const ACTIVE_STATES: OrderState[] = [
  "MERCHANT_PENDING",
  "MERCHANT_ACCEPTED",
  "PREPARING",
  "READY",
  "CUSTOMER_NOTIFIED",
  "CUSTOMER_ON_THE_WAY",
  "CUSTOMER_NEARBY",
  "CUSTOMER_ARRIVED",
  "HANDOFF_IN_PROGRESS"
];

const TAB_STATES: Record<string, OrderState[]> = {
  new: ["MERCHANT_PENDING"],
  preparing: ["MERCHANT_ACCEPTED", "PREPARING"],
  ready: ["READY", "CUSTOMER_NOTIFIED", "CUSTOMER_ON_THE_WAY", "CUSTOMER_NEARBY"],
  arrived: ["CUSTOMER_ARRIVED", "HANDOFF_IN_PROGRESS"],
  completed: ["COMPLETED"],
  all: []
};

function maskPhone(phone: string): string {
  // 05X *** XX21 — README §4
  const local = phone.replace("+966", "0");
  return `${local.slice(0, 3)} *** ${local.slice(-4, -2)}${local.slice(-2)}`;
}

type OrderForCard = Prisma.OrderGetPayload<{ include: { user: true } }>;

function toCard(o: OrderForCard, etaMinutes: number | null): BranchOrderCard {
  const status = o.order_status as OrderState;
  const isActive = ACTIVE_STATES.includes(status);
  return {
    id: o.id,
    display_code: o.display_code,
    order_status: status,
    customer_first_name: (o.user.full_name ?? "عميل").split(" ")[0] ?? "عميل",
    customer_phone_masked: maskPhone(o.user.phone),
    vehicle_summary: isActive ? o.vehicle_summary : null, // الخصوصية خارج الطلب النشط
    parking_spot: o.parking_spot_label,
    items_count: 0, // يُملأ من العد أدناه
    total_halalas: o.total_halalas,
    eta_minutes: etaMinutes,
    accept_deadline_at: o.accept_deadline_at?.toISOString() ?? null,
    arrived_at: o.arrived_at?.toISOString() ?? null,
    created_at: o.created_at.toISOString()
  };
}

export class MerchantOrderService {
  async list(branch_id: string, tab: string): Promise<BranchOrderCard[]> {
    const states = TAB_STATES[tab] ?? [];
    const orders = await prisma.order.findMany({
      where: {
        branch_id,
        ...(states.length > 0
          ? { order_status: { in: states } }
          : { order_status: { in: [...ACTIVE_STATES, "COMPLETED"] } })
      },
      include: { user: true, _count: { select: { items: true } } },
      orderBy: { created_at: "desc" },
      take: 100
    });

    const cards: BranchOrderCard[] = [];
    for (const o of orders) {
      let eta: number | null = null;
      const session = await prisma.pickupSession.findUnique({
        where: { order_id: o.id },
        include: { eta_snapshots: { orderBy: { created_at: "desc" }, take: 1 } }
      });
      if (session?.eta_snapshots[0]) eta = Math.round(session.eta_snapshots[0].eta_seconds / 60);
      cards.push({ ...toCard(o, eta), items_count: o._count.items });
    }
    return cards;
  }

  private async loadBranchOrder(order_id: string, branch_ids: string[]) {
    const order = await prisma.order.findUnique({ where: { id: order_id } });
    if (!order) throw new AppError("ORDER-4001");
    if (!branch_ids.includes(order.branch_id)) throw new AppError("MERCHANT-7003");
    return order;
  }

  /** قبول — BR-1: يجوز مع تعديل وقت التجهيز + Capture (docs/13§3) */
  async accept(order_id: string, branch_ids: string[], staff_user_id: string, prepOverride?: number) {
    const order = await this.loadBranchOrder(order_id, branch_ids);
    if (order.order_status !== "MERCHANT_PENDING") throw new AppError("MERCHANT-7001");

    const settings = await prisma.branchPickupSettings.findUnique({
      where: { branch_id: order.branch_id }
    });
    const prep = prepOverride ?? settings?.default_prep_minutes ?? 15;

    // Capture خارج المعاملة (نداء شبكة) ثم الانتقال — فشله يبقي الطلب PENDING
    const intent = await prisma.paymentIntent.findUnique({ where: { order_id } });
    if (intent?.provider_ref && intent.supports_capture) {
      const captured = await payments.capture(intent.provider_ref, intent.amount_halalas);
      if (!captured.ok) throw new AppError("SYS-9002", { hint: "capture failed" });
    }

    await prisma.$transaction(async (tx) => {
      if (intent) {
        await tx.paymentIntent.update({ where: { id: intent.id }, data: { status: "captured" } });
        await tx.paymentTransaction.create({
          data: {
            intent_id: intent.id,
            type: "capture",
            debit_account: "gateway_pending",
            credit_account: "merchant_payable",
            amount_halalas: intent.amount_halalas,
            provider_ref: intent.provider_ref
          }
        });
      }
      await transitionOrder(
        tx,
        order,
        "MERCHANT_ACCEPTED",
        { actor_type: "merchant_staff", actor_id: staff_user_id },
        { data: { accepted_at: new Date(), prep_minutes: prep }, payload: { prep_minutes: prep } }
      );
    });
    return this.card(order_id);
  }

  /** رفض بسبب مغلق → استرجاع/تحرير آلي (J5) */
  async reject(order_id: string, branch_ids: string[], staff_user_id: string, reason: string) {
    const order = await this.loadBranchOrder(order_id, branch_ids);
    if (order.order_status !== "MERCHANT_PENDING") throw new AppError("MERCHANT-7001");

    const intent = await prisma.paymentIntent.findUnique({ where: { order_id } });

    await prisma.$transaction(async (tx) => {
      await transitionOrder(
        tx,
        order,
        "MERCHANT_REJECTED",
        { actor_type: "merchant_staff", actor_id: staff_user_id },
        { reason, payload: { reason } }
      );
      await transitionOrder(
        tx,
        { ...order, order_status: "MERCHANT_REJECTED" },
        "REFUND_PENDING",
        { actor_type: "system" },
        { reason }
      );
      await tx.refund.create({
        data: {
          order_id,
          intent_id: intent?.id ?? null,
          amount_halalas: order.total_halalas,
          includes_service_fee: true, // رفض الفرع: استرجاع كامل — BR-2
          reason: `merchant_reject:${reason}`,
          status: "pending",
          requested_by: "system",
          idempotency_key: `reject:${order_id}`
        }
      });
    });

    // التنفيذ عند البوابة ثم الإكمال — تحرير الحجز أو استرجاع (docs/13§3)
    if (intent?.provider_ref) {
      const released = intent.status === "captured"
        ? await payments.refund(intent.provider_ref, order.total_halalas, `reject:${order_id}`)
        : { ok: (await payments.cancelOrRelease(intent.provider_ref)).ok, refund_ref: "release" };
      if (released.ok) {
        await prisma.$transaction(async (tx) => {
          await tx.refund.updateMany({
            where: { order_id, status: "pending" },
            data: { status: "completed", completed_at: new Date(), provider_ref: released.refund_ref }
          });
          await tx.paymentTransaction.create({
            data: {
              intent_id: intent.id,
              type: "refund",
              debit_account: "merchant_payable",
              credit_account: "customer_receivable",
              amount_halalas: order.total_halalas,
              idempotency_key: `refund:reject:${order_id}`
            }
          });
          const fresh = await tx.order.findUniqueOrThrow({ where: { id: order_id } });
          await transitionOrder(tx, fresh, "REFUNDED", { actor_type: "system" });
        });
      }
    }
    return this.card(order_id);
  }

  async preparing(order_id: string, branch_ids: string[], staff_user_id: string) {
    const order = await this.loadBranchOrder(order_id, branch_ids);
    await prisma.$transaction(async (tx) => {
      await transitionOrder(tx, order, "PREPARING", {
        actor_type: "merchant_staff",
        actor_id: staff_user_id
      });
    });
    return this.card(order_id);
  }

  /** جاهز → إشعار العميل (READY → CUSTOMER_NOTIFIED آلياً) */
  async ready(order_id: string, branch_ids: string[], staff_user_id: string) {
    const order = await this.loadBranchOrder(order_id, branch_ids);
    await prisma.$transaction(async (tx) => {
      await transitionOrder(
        tx,
        order,
        "READY",
        { actor_type: "merchant_staff", actor_id: staff_user_id },
        { data: { ready_at: new Date() } }
      );
      // الإشعار يُبث حدثاً — worker يرسل push «طلبك جاهز»
      await transitionOrder(
        tx,
        { ...order, order_status: "READY" },
        "CUSTOMER_NOTIFIED",
        { actor_type: "system" }
      );
      // BR-3: تذكير عند 15 دقيقة ثم فحص No-show عند 45 دقيقة
      await scheduleJob(
        tx,
        "no_show_reminder",
        { order_id: order.id },
        new Date(Date.now() + 15 * 60_000),
        `no_show_reminder:${order.id}`
      );
      await scheduleJob(
        tx,
        "no_show_check",
        { order_id: order.id },
        new Date(Date.now() + 45 * 60_000),
        `no_show_check:${order.id}`
      );
    });
    return this.card(order_id);
  }

  /** «خرج الموظف» — لا HANDOFF قبل READY (PICKUP-6005) */
  async handoffStart(order_id: string, branch_ids: string[], staff_user_id: string) {
    const order = await this.loadBranchOrder(order_id, branch_ids);
    if (order.order_status !== "CUSTOMER_ARRIVED") {
      throw new AppError("ORDER-4002", { from: order.order_status, to: "HANDOFF_IN_PROGRESS" });
    }
    if (!order.ready_at) throw new AppError("PICKUP-6005");

    await prisma.$transaction(async (tx) => {
      const staff = await tx.merchantStaff.findFirst({ where: { user_id: staff_user_id } });
      if (staff) {
        await tx.handoffAssignment.create({
          data: { order_id, staff_id: staff.id, started_at: new Date() }
        });
      }
      await transitionOrder(tx, order, "HANDOFF_IN_PROGRESS", {
        actor_type: "merchant_staff",
        actor_id: staff_user_id
      });
      await emitEvent(tx, {
        name: "handoff.started",
        aggregate_type: "order",
        aggregate_id: order_id,
        merchant_id: order.merchant_id,
        branch_id: order.branch_id,
        payload: { staff_name: staff?.full_name ?? null }
      });
    });
    return this.card(order_id);
  }

  /** «تم التسليم» بتحقق — BR-8 */
  async handoffComplete(
    order_id: string,
    branch_ids: string[],
    staff_user_id: string,
    verification: { method: "code" | "qr" | "customer_button" | "board"; code?: string | undefined }
  ) {
    const order = await this.loadBranchOrder(order_id, branch_ids);
    if (order.order_status !== "HANDOFF_IN_PROGRESS") {
      throw new AppError("ORDER-4002", { from: order.order_status, to: "COMPLETED" });
    }
    if (verification.method === "code" || verification.method === "qr") {
      if (verification.code !== handoffCodeFor(order_id)) throw new AppError("PICKUP-6003");
    }

    await prisma.$transaction(async (tx) => {
      await tx.handoffConfirmation.create({
        data: {
          order_id,
          method: verification.method,
          confirmed_by: "merchant_staff",
          actor_id: staff_user_id
        }
      });

      if (order.requires_dual_confirmation) {
        const customerConfirm = await tx.handoffConfirmation.findFirst({
          where: { order_id, confirmed_by: "customer" }
        });
        if (!customerConfirm) throw new AppError("PICKUP-6004");
      }
      await completeHandoff(tx, order, { actor_type: "merchant_staff", actor_id: staff_user_id });
    });
    return this.card(order_id);
  }

  /** طابور الوصول — الترتيب BR-9 */
  async arrivalQueue(branch_id: string) {
    const settings = await prisma.branchPickupSettings.findUnique({ where: { branch_id } });
    const target = settings?.service_target_seconds ?? 120;
    const entries = await prisma.arrivalQueueEntry.findMany({
      where: { branch_id, served_at: null },
      include: { order: true },
      orderBy: [{ priority: "desc" }, { entered_at: "asc" }]
    });
    return entries.map((e, idx) => {
      const waiting = Math.round((Date.now() - e.entered_at.getTime()) / 1000);
      return {
        order_id: e.order_id,
        display_code: e.order.display_code,
        position: idx + 1,
        vehicle_summary: e.order.vehicle_summary,
        parking_spot: e.order.parking_spot_label,
        waiting_seconds: waiting,
        service_target_exceeded: waiting > target
      };
    });
  }

  /** وضع الازدحام — BR-10: ينعكس فوراً على الاكتشاف والسلة */
  async setBusyMode(
    branch_id: string,
    staff_user_id: string,
    input: {
      prep_delta_minutes?: 10 | 20 | 30 | undefined;
      pause?: boolean | undefined;
      order_cap?: number | undefined;
      close_pickup_only?: boolean | undefined;
      customer_message?: string | undefined;
    }
  ) {
    const branch = await prisma.branch.findUnique({ where: { id: branch_id } });
    if (!branch) throw new AppError("CATALOG-2001");

    const newStatus = input.pause
      ? ("paused" as const)
      : input.prep_delta_minutes || input.order_cap || input.close_pickup_only
        ? ("busy" as const)
        : ("open" as const);

    await prisma.$transaction(async (tx) => {
      await tx.branch.update({
        where: { id: branch_id },
        data: {
          status: newStatus,
          busy_message: input.customer_message ?? null
        }
      });
      if (input.prep_delta_minutes) {
        const settings = await tx.branchPickupSettings.findUnique({ where: { branch_id } });
        await tx.branchPickupSettings.update({
          where: { branch_id },
          data: {
            default_prep_minutes: (settings?.default_prep_minutes ?? 15) + input.prep_delta_minutes
          }
        });
      }
      // فعل إداري حساس — audit (docs/16§4)
      await tx.auditLog.create({
        data: {
          actor_type: "merchant_staff",
          actor_id: staff_user_id,
          action: "busy_mode_set",
          entity_type: "branch",
          entity_id: branch_id,
          merchant_id: branch.merchant_id,
          branch_id,
          after: input as never
        }
      });
    });
    return { status: newStatus, busy_message: input.customer_message ?? null };
  }

  /** نقص منتج بعد القبول — BR-4: موافقة العميل الصريحة، مهلة 5 دقائق */
  async reportItemIssue(
    order_id: string,
    branch_ids: string[],
    staff_user_id: string,
    input: { order_item_id: string; issue: "out_of_stock" | "partial"; substitute_product_id?: string | undefined; note?: string | undefined }
  ) {
    const order = await this.loadBranchOrder(order_id, branch_ids);
    if (!["MERCHANT_ACCEPTED", "PREPARING"].includes(order.order_status)) {
      throw new AppError("MERCHANT-7004", { hint: "التعديل بعد القبول وقبل الجاهزية" });
    }
    const item = await prisma.orderItem.findUnique({ where: { id: input.order_item_id } });
    if (!item || item.order_id !== order_id) throw new AppError("ORDER-4001");

    const deadlineMinutes = 5; // BR-4
    const adjustment = await prisma.$transaction(async (tx) => {
      const adj = await tx.orderAdjustment.create({
        data: {
          order_id,
          order_item_id: input.order_item_id,
          issue: input.issue,
          substitute_product_id: input.substitute_product_id ?? null,
          customer_deadline_at: new Date(Date.now() + deadlineMinutes * 60_000),
          refund_halalas: item.line_total_halalas
        }
      });
      await emitEvent(tx, {
        name: "order.change_requested",
        aggregate_type: "order",
        aggregate_id: order_id,
        merchant_id: order.merchant_id,
        branch_id: order.branch_id,
        payload: { adjustment_id: adj.id, item_name: item.name_ar_snapshot, issue: input.issue }
      });
      await tx.auditLog.create({
        data: {
          actor_type: "merchant_staff",
          actor_id: staff_user_id,
          action: "item_issue_reported",
          entity_type: "order",
          entity_id: order_id,
          merchant_id: order.merchant_id,
          branch_id: order.branch_id,
          after: { adjustment_id: adj.id, ...input } as never
        }
      });
      return adj;
    });
    return { adjustment_id: adjustment.id, customer_deadline_at: adjustment.customer_deadline_at };
  }

  private async card(order_id: string): Promise<BranchOrderCard> {
    const o = await prisma.order.findUniqueOrThrow({
      where: { id: order_id },
      include: { user: true, _count: { select: { items: true } } }
    });
    return { ...toCard(o, null), items_count: o._count.items };
  }
}
