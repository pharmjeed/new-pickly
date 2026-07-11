import { prisma, type Prisma } from "@pickly/database";
import type { BranchOrderCard, BranchRadarEntry, OrderState } from "@pickly/contracts";
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
  "PAYMENT_PENDING",
  "PAYMENT_FAILED",
  "PREPARING",
  "READY",
  "CUSTOMER_NOTIFIED",
  "CUSTOMER_ON_THE_WAY",
  "CUSTOMER_NEARBY",
  "CUSTOMER_ARRIVED",
  "HANDOFF_IN_PROGRESS"
];

/** بين القبول والدفع — يظهر معلوماتياً في عمود «بانتظار الدفع» مع منع التحضير (docs/06 BR-2) */
const AWAITING_PAYMENT_STATES: OrderState[] = ["MERCHANT_ACCEPTED", "PAYMENT_PENDING", "PAYMENT_FAILED"];

/** الحالات المدفوعة النشطة — نطاق رادار الوصول (docs/14§5-مكرر) */
const RADAR_STATES: OrderState[] = [
  "PREPARING",
  "READY",
  "CUSTOMER_NOTIFIED",
  "CUSTOMER_ON_THE_WAY",
  "CUSTOMER_NEARBY",
  "CUSTOMER_ARRIVED"
];

/**
 * مسار التجهيز الموازي (docs/05§3): رحلة العميل يجوز أن تسبق READY،
 * فالتبويب يُصنَّف بحقيقة الجاهزية (ready_at) لا بحالة الرحلة —
 * طلب لم يجهز يبقى «قيد التحضير» ولو انطلق العميل، والواصل يظهر في «وصلوا».
 */
const JOURNEY_EN_ROUTE: OrderState[] = ["CUSTOMER_ON_THE_WAY", "CUSTOMER_NEARBY"];
const JOURNEY_STATES: OrderState[] = [...JOURNEY_EN_ROUTE, "CUSTOMER_ARRIVED"];

const TAB_WHERE: Record<string, Prisma.OrderWhereInput> = {
  new: { order_status: "MERCHANT_PENDING" },
  // بين القبول والدفع — معلوماتي فقط، التحضير يبدأ آلياً عند نجاح الدفع
  awaiting_payment: { order_status: { in: AWAITING_PAYMENT_STATES } },
  preparing: {
    OR: [
      { order_status: "PREPARING" },
      { order_status: { in: JOURNEY_EN_ROUTE }, ready_at: null }
    ]
  },
  ready: {
    OR: [
      { order_status: { in: ["READY", "CUSTOMER_NOTIFIED"] } },
      { order_status: { in: JOURNEY_EN_ROUTE }, ready_at: { not: null } }
    ]
  },
  arrived: { order_status: { in: ["CUSTOMER_ARRIVED", "HANDOFF_IN_PROGRESS"] } },
  completed: { order_status: "COMPLETED" }
};

function maskPhone(phone: string): string {
  // 05X *** XX21 — README §4
  const local = phone.replace("+966", "0");
  return `${local.slice(0, 3)} *** ${local.slice(-4, -2)}${local.slice(-2)}`;
}

type OrderForCard = Prisma.OrderGetPayload<{ include: { user: true; scheduled_slot: true } }>;

/** مهلتا ما بعد القبول — 5 دقائق لكلٍّ (docs/06 BR-2) لعرض عداد «بانتظار الدفع» */
const POST_ACCEPT_WINDOW_MS = 5 * 60_000;

function toCard(o: OrderForCard, etaMinutes: number | null): BranchOrderCard {
  const status = o.order_status as OrderState;
  const isActive = ACTIVE_STATES.includes(status);
  const prepConfirmDeadline =
    status === "MERCHANT_ACCEPTED" && o.prep_minutes !== null && !o.prep_time_confirmed_at && o.accepted_at
      ? new Date(o.accepted_at.getTime() + POST_ACCEPT_WINDOW_MS)
      : null;
  const paymentDeadline =
    o.prep_time_confirmed_at && AWAITING_PAYMENT_STATES.includes(status)
      ? new Date(o.prep_time_confirmed_at.getTime() + POST_ACCEPT_WINDOW_MS)
      : null;
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
    pickup_time: (o.pickup_time as "asap" | "later" | "scheduled") ?? "asap",
    scheduled_slot_start: o.scheduled_slot?.slot_start.toISOString() ?? null,
    prep_minutes: o.prep_minutes,
    prep_time_confirmed_at: o.prep_time_confirmed_at?.toISOString() ?? null,
    prep_confirm_deadline_at: prepConfirmDeadline?.toISOString() ?? null,
    payment_deadline_at: paymentDeadline?.toISOString() ?? null,
    preparing_at: o.preparing_at?.toISOString() ?? null,
    ready_at: o.ready_at?.toISOString() ?? null,
    created_at: o.created_at.toISOString()
  };
}

export class MerchantOrderService {
  async list(branch_id: string, tab: string): Promise<BranchOrderCard[]> {
    const tabWhere = TAB_WHERE[tab] ?? { order_status: { in: [...ACTIVE_STATES, "COMPLETED"] } };
    const orders = await prisma.order.findMany({
      where: { branch_id, ...tabWhere },
      include: { user: true, scheduled_slot: true, _count: { select: { items: true } } },
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

  /**
   * قبول — BR-1: تحديد وقت التجهيز المتوقع (10/15/20/25 د).
   * الدفع بعد القبول (docs/05§3): لا Capture هنا — لا مال بعد؛
   * القبول يفتح مهلة موافقة العميل على الوقت (5 د) وانتهاؤها = EXPIRED.
   */
  async accept(order_id: string, branch_ids: string[], staff_user_id: string, prepOverride?: number) {
    const order = await this.loadBranchOrder(order_id, branch_ids);
    if (order.order_status !== "MERCHANT_PENDING") throw new AppError("MERCHANT-7001");

    const settings = await prisma.branchPickupSettings.findUnique({
      where: { branch_id: order.branch_id }
    });
    const prep = prepOverride ?? settings?.default_prep_minutes ?? 15;

    await prisma.$transaction(async (tx) => {
      const acceptedAt = new Date();
      await transitionOrder(
        tx,
        order,
        "MERCHANT_ACCEPTED",
        { actor_type: "merchant_staff", actor_id: staff_user_id },
        { data: { accepted_at: acceptedAt, prep_minutes: prep }, payload: { prep_minutes: prep } }
      );
      await scheduleJob(
        tx,
        "prep_confirm_timeout",
        { order_id },
        new Date(acceptedAt.getTime() + POST_ACCEPT_WINDOW_MS),
        `prep_confirm_timeout:${order_id}`
      );
    });
    return this.card(order_id);
  }

  /**
   * رفض بسبب مغلق (J5) — الدفع بعد القبول: الرفض يسبق قبض أي مبلغ،
   * فلا استرجاع إلا لطلب قديم دُفع قبل تغيير المسار (حارس توافق خلفي).
   */
  async reject(order_id: string, branch_ids: string[], staff_user_id: string, reason: string) {
    const order = await this.loadBranchOrder(order_id, branch_ids);
    if (order.order_status !== "MERCHANT_PENDING") throw new AppError("MERCHANT-7001");

    const intent = await prisma.paymentIntent.findUnique({ where: { order_id } });
    const paid = intent !== null && ["authorized", "captured"].includes(intent.status);

    await prisma.$transaction(async (tx) => {
      await transitionOrder(
        tx,
        order,
        "MERCHANT_REJECTED",
        { actor_type: "merchant_staff", actor_id: staff_user_id },
        { reason, payload: { reason } }
      );
      if (paid && intent) {
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
            intent_id: intent.id,
            amount_halalas: order.total_halalas,
            includes_service_fee: true, // رفض الفرع: استرجاع كامل — BR-2
            reason: `merchant_reject:${reason}`,
            status: "pending",
            requested_by: "system",
            idempotency_key: `reject:${order_id}`
          }
        });
      }
    });

    // حارس التوافق الخلفي: تنفيذ الاسترجاع عند البوابة لطلب مدفوع بالمسار القديم
    if (paid && intent?.provider_ref) {
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

  /**
   * «بدء التجهيز» اليدوي — بعد تغيير المسار يبقى للمسار الموازي فقط
   * (عميل انطلق وطلبه لم يُعلَّم preparing_at)؛ التحضير الاعتيادي يبدأ آلياً عند الدفع.
   */
  async preparing(order_id: string, branch_ids: string[], staff_user_id: string) {
    const order = await this.loadBranchOrder(order_id, branch_ids);
    // لا تجهيز قبل الدفع — الطلب بين القبول والدفع معلوماتي فقط (docs/06 BR-2)
    if (AWAITING_PAYMENT_STATES.includes(order.order_status as OrderState)) {
      throw new AppError("ORDER-4009");
    }
    const status = order.order_status as OrderState;
    await prisma.$transaction(async (tx) => {
      if (JOURNEY_STATES.includes(status)) {
        // العميل سبق التجهيز (docs/05§3): المسار يتقدم بالحقائق لا بالحالة —
        // order_status تبقى لرحلة العميل، وpreparing_at يسجل بدء التحضير
        if (order.ready_at || order.preparing_at) {
          throw new AppError("ORDER-4002", { from: status, to: "PREPARING" });
        }
        await tx.order.update({ where: { id: order.id }, data: { preparing_at: new Date() } });
        await emitEvent(tx, {
          name: "order.preparing",
          aggregate_type: "order",
          aggregate_id: order.id,
          merchant_id: order.merchant_id,
          branch_id: order.branch_id,
          payload: { parallel_to: status }
        });
      } else {
        await transitionOrder(
          tx,
          order,
          "PREPARING",
          { actor_type: "merchant_staff", actor_id: staff_user_id },
          { data: { preparing_at: new Date() } }
        );
      }
    });
    return this.card(order_id);
  }

  /** جاهز → إشعار العميل (READY → CUSTOMER_NOTIFIED آلياً) */
  async ready(order_id: string, branch_ids: string[], staff_user_id: string) {
    const order = await this.loadBranchOrder(order_id, branch_ids);
    const status = order.order_status as OrderState;
    await prisma.$transaction(async (tx) => {
      if (JOURNEY_STATES.includes(status)) {
        // العميل في الطريق أو واصل: الجاهزية حقيقة تُسجَّل دون تغيير حالة الرحلة،
        // ولا إشعار «انطلق» ولا مهام No-show — العميل متحرك أصلاً
        if (order.ready_at) throw new AppError("ORDER-4002", { from: status, to: "READY" });
        await tx.order.update({
          where: { id: order.id },
          data: { ready_at: new Date(), preparing_at: order.preparing_at ?? new Date() }
        });
        await emitEvent(tx, {
          name: "order.ready",
          aggregate_type: "order",
          aggregate_id: order.id,
          merchant_id: order.merchant_id,
          branch_id: order.branch_id,
          payload: { parallel_to: status }
        });
        return;
      }
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

  /**
   * رادار الوصول — docs/14§5-مكرر: لكل طلب مدفوع نشط سطر يقارن
   * المتبقي لوصول العميل (أحدث لقطة ETA) بما مضى من دقائق التجهيز (من preparing_at).
   * لا استدعاء خرائط هنا — نقرأ لقطات ETA المخزنة من رحلة العميل فقط.
   */
  async radar(branch_id: string): Promise<BranchRadarEntry[]> {
    const orders = await prisma.order.findMany({
      where: { branch_id, order_status: { in: RADAR_STATES } },
      include: { user: true },
      orderBy: { preparing_at: "asc" },
      take: 100
    });

    const entries: BranchRadarEntry[] = [];
    for (const o of orders) {
      const session = await prisma.pickupSession.findUnique({
        where: { order_id: o.id },
        include: { eta_snapshots: { orderBy: { created_at: "desc" }, take: 1 } }
      });
      const snap = session?.status === "active" || session?.status === "arrived" ? session.eta_snapshots[0] : null;
      entries.push({
        order_id: o.id,
        display_code: o.display_code,
        order_status: o.order_status as OrderState,
        customer_first_name: (o.user.full_name ?? "عميل").split(" ")[0] ?? "عميل",
        vehicle_summary: o.vehicle_summary,
        prep_minutes: o.prep_minutes,
        preparing_at: o.preparing_at?.toISOString() ?? null,
        ready_at: o.ready_at?.toISOString() ?? null,
        arrived_at: o.arrived_at?.toISOString() ?? null,
        trip_active: session?.status === "active" || session?.status === "arrived",
        eta_minutes: snap ? Math.round(snap.eta_seconds / 60) : null,
        eta_updated_at: snap?.created_at.toISOString() ?? null
      });
    }
    return entries;
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
    // الدفع بعد القبول: نقص المنتج يُبلغ بعد الدفع (PREPARING) وقبل الجاهزية —
    // قبل الدفع لا تعديل مالي؛ يكفي الرفض أو انتهاء المهلة
    if (order.order_status !== "PREPARING" || order.ready_at) {
      throw new AppError("MERCHANT-7004", { hint: "التعديل أثناء التحضير وقبل الجاهزية" });
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
      include: { user: true, scheduled_slot: true, _count: { select: { items: true } } }
    });
    return { ...toCard(o, null), items_count: o._count.items };
  }
}
