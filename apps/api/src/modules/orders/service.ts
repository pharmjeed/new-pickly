import { prisma, type Prisma } from "@pickly/database";
import type { CreateOrderBody, Order as OrderDto, OrderState, PickupTime } from "@pickly/contracts";
import { CUSTOMER_DISPLAY_MAP } from "@pickly/contracts";
import { AppError } from "@pickly/observability";
import { createPaymentAdapter } from "@pickly/payments";
import { generateDisplayCode, handoffCodeFor } from "../../lib/codes.js";
import { emitEvent, scheduleJob } from "../../lib/events.js";
import { requireFlag } from "../../lib/flags.js";
import { transitionOrder } from "../../lib/state-machine.js";

/** وحدة Orders — رحلة J1 (docs/03) على آلة docs/05 وقواعد docs/06 + J3 المجدول (BR-5) */

const DUAL_CONFIRMATION_THRESHOLD_HALALAS = 30_000; // BR-8: ≥300 ر.س
const FREE_CHANGE_MINUTES_DEFAULT = 60; // BR-5 — قابل للضبط br5.free_change_minutes
const UNPAID_EXPIRE_MINUTES_DEFAULT = 30; // مجدول لم يُدفع → EXPIRED

export const payments = createPaymentAdapter();

type OrderWithItems = Prisma.OrderGetPayload<{
  include: {
    items: { include: { modifiers: true } };
    vehicle: true;
    branch: { include: { brand: true } };
    scheduled_slot: true;
  };
}>;

const orderInclude = {
  items: { include: { modifiers: true } },
  vehicle: true,
  branch: { include: { brand: true } },
  scheduled_slot: true
} as const;

/** قيمة إعداد رقمي من system_settings — أحدث قيمة سارية */
async function numericSetting(key: string, fallback: number): Promise<number> {
  const row = await prisma.systemSetting.findFirst({
    where: { key, effective_at: { lte: new Date() } },
    orderBy: { effective_at: "desc" }
  });
  const v = Number(row?.value);
  return Number.isFinite(v) ? v : fallback;
}

/** رمز التسليم يظهر للعميل من الجاهزية حتى الاكتمال */
const CODE_VISIBLE_STATES: OrderState[] = [
  "READY",
  "CUSTOMER_NOTIFIED",
  "CUSTOMER_ON_THE_WAY",
  "CUSTOMER_NEARBY",
  "CUSTOMER_ARRIVED",
  "HANDOFF_IN_PROGRESS"
];

export function toOrderDto(o: OrderWithItems): OrderDto {
  const status = o.order_status as OrderState;
  return {
    id: o.id,
    display_code: o.display_code,
    order_status: status,
    branch_id: o.branch_id,
    brand_name_ar: o.branch.brand.name_ar,
    items: o.items.map((i) => ({
      id: i.id,
      name_ar_snapshot: i.name_ar_snapshot,
      quantity: i.quantity,
      unit_price_halalas_snapshot: i.unit_price_halalas_snapshot,
      modifiers_snapshot: i.modifiers.map((m) => ({
        name_ar: m.name_ar_snapshot,
        price_halalas: m.price_halalas_snapshot
      })),
      line_total_halalas: i.line_total_halalas
    })),
    subtotal_halalas: o.subtotal_halalas,
    discount_halalas: o.discount_halalas,
    vat_halalas: o.vat_halalas,
    service_fee_halalas: o.service_fee_halalas,
    total_halalas: o.total_halalas,
    vehicle: o.vehicle
      ? {
          id: o.vehicle.id,
          make_ar: o.vehicle.make_ar,
          model_ar: o.vehicle.model_ar,
          color_ar: o.vehicle.color_ar,
          plate_short: o.vehicle.plate_short,
          is_default: false
        }
      : null,
    handoff_code: CODE_VISIBLE_STATES.includes(status) ? handoffCodeFor(o.id) : null,
    prep_minutes: o.prep_minutes,
    prep_time_confirmed_at: o.prep_time_confirmed_at?.toISOString() ?? null,
    pickup_time: o.pickup_time as PickupTime,
    scheduled_slot: o.scheduled_slot
      ? {
          slot_start: o.scheduled_slot.slot_start.toISOString(),
          slot_end: o.scheduled_slot.slot_end.toISOString(),
          free_change_until: o.scheduled_slot.free_change_until.toISOString()
        }
      : null,
    created_at: o.created_at.toISOString()
  };
}

export class OrderService {
  /** POST /v1/orders — Idempotency-Key إلزامي (docs/05§4-6) */
  async create(user_id: string, body: CreateOrderBody, idempotency_key: string): Promise<OrderDto> {
    const existing = await prisma.order.findUnique({
      where: { idempotency_key },
      include: orderInclude
    });
    if (existing) return toOrderDto(existing); // تحديث الصفحة لا ينشئ طلباً ثانياً

    const cart = await prisma.cart.findUnique({
      where: { id: body.cart_id },
      include: {
        items: { include: { modifiers: { include: { modifier: true } }, product: true } },
        branch: true
      }
    });
    if (!cart || cart.user_id !== user_id) throw new AppError("CART-3001");
    if (cart.items.length === 0) throw new AppError("CART-3001", { hint: "السلة فارغة" });

    const quote = await prisma.pricingQuote.findUnique({ where: { id: body.quote_id } });
    if (!quote || quote.cart_id !== cart.id) throw new AppError("CART-3004");
    if (quote.expires_at < new Date()) throw new AppError("CART-3004");

    const vehicle = await prisma.vehicle.findUnique({ where: { id: body.vehicle_id } });
    if (!vehicle || vehicle.user_id !== user_id) throw new AppError("SYS-9004", { field: "vehicle_id" });

    if (cart.branch.status === "closed") throw new AppError("CATALOG-2002");
    if (cart.branch.status === "paused") throw new AppError("CATALOG-2004");

    // ===== BR-5: التحقق من الجدولة قبل فتح المعاملة =====
    let freeChangeMinutes = FREE_CHANGE_MINUTES_DEFAULT;
    if (body.pickup_time === "scheduled") {
      await requireFlag("scheduled_orders");
      if (!body.slot_id) throw new AppError("SYS-9004", { field: "slot_id", hint: "الفترة مطلوبة للطلب المجدول" });
      const settings = await prisma.branchPickupSettings.findUnique({
        where: { branch_id: cart.branch_id }
      });
      if (!settings?.scheduled_enabled) throw new AppError("ORDER-4007");
      freeChangeMinutes = await numericSetting("br5.free_change_minutes", FREE_CHANGE_MINUTES_DEFAULT);
    }
    const unpaidExpireMinutes = await numericSetting(
      "br5.unpaid_expire_minutes",
      UNPAID_EXPIRE_MINUTES_DEFAULT
    );

    const vehicle_summary = [vehicle.model_ar ?? vehicle.make_ar, vehicle.color_ar, vehicle.plate_short]
      .filter(Boolean)
      .join(" · ");

    const order = await prisma.$transaction(async (tx) => {
      let display_code = generateDisplayCode();
      // ضمان التفرد — إعادة توليد عند التصادم
      while (await tx.order.findUnique({ where: { display_code } })) {
        display_code = generateDisplayCode();
      }

      const created = await tx.order.create({
        data: {
          display_code,
          user_id,
          merchant_id: cart.branch.merchant_id,
          branch_id: cart.branch_id,
          cart_id: cart.id,
          quote_id: quote.id,
          order_status: "CHECKOUT_PENDING",
          subtotal_halalas: quote.subtotal_halalas,
          discount_halalas: quote.discount_halalas,
          vat_halalas: quote.vat_halalas,
          service_fee_halalas: quote.service_fee_halalas,
          total_halalas: quote.total_halalas,
          vehicle_id: vehicle.id,
          vehicle_summary,
          handoff_code_hash: "hmac-derived", // الرمز مشتق HMAC من order_id — lib/codes.ts
          requires_dual_confirmation: quote.total_halalas >= DUAL_CONFIRMATION_THRESHOLD_HALALAS,
          pickup_time: body.pickup_time,
          ...(cart.coupon_id && quote.discount_halalas > 0 ? { coupon_id: cart.coupon_id } : {}),
          ...(body.notes ? { customer_notes: body.notes } : {}),
          idempotency_key
        }
      });

      // BR-5: حجز السعة ذرّياً — booked < capacity شرط في نفس UPDATE (لا سباق)
      if (body.pickup_time === "scheduled" && body.slot_id) {
        const bookedCount = await tx.$executeRaw`
          UPDATE branch_capacity_slots
          SET booked = booked + 1
          WHERE id = ${body.slot_id}::uuid
            AND branch_id = ${cart.branch_id}::uuid
            AND booked < capacity
            AND slot_start > now()`;
        if (bookedCount !== 1) throw new AppError("ORDER-4006");

        const slot = await tx.branchCapacitySlot.findUniqueOrThrow({ where: { id: body.slot_id } });
        await tx.scheduledPickupSlot.create({
          data: {
            order_id: created.id,
            slot_start: slot.slot_start,
            slot_end: slot.slot_end,
            free_change_until: new Date(slot.slot_start.getTime() - freeChangeMinutes * 60_000)
          }
        });
        // مجدول لم يُدفع خلال المهلة → EXPIRED ويُحرَّر الحجز (docs/05)
        await scheduleJob(
          tx,
          "scheduled_expire",
          { order_id: created.id, slot_id: body.slot_id },
          new Date(Date.now() + unpaidExpireMinutes * 60_000),
          `scheduled_expire:${created.id}`
        );
      }

      // BR-7: تسجيل استخدام الكوبون — order_id فريد يمنع التكرار
      if (cart.coupon_id && quote.discount_halalas > 0) {
        await tx.couponRedemption.create({
          data: {
            coupon_id: cart.coupon_id,
            user_id,
            order_id: created.id,
            amount_halalas: quote.discount_halalas
          }
        });
      }

      // لقطات العناصر — المنيو يتغير والطلب لا (docs/10§4)
      for (const item of cart.items) {
        const mods = item.modifiers.reduce((s, m) => s + m.price_halalas, 0);
        const createdItem = await tx.orderItem.create({
          data: {
            order_id: created.id,
            product_id: item.product_id,
            name_ar_snapshot: item.product.name_ar,
            quantity: item.quantity,
            unit_price_halalas_snapshot: item.unit_price_halalas,
            line_total_halalas: (item.unit_price_halalas + mods) * item.quantity,
            ...(item.notes ? { notes: item.notes } : {})
          }
        });
        for (const m of item.modifiers) {
          await tx.orderItemModifier.create({
            data: {
              order_item_id: createdItem.id,
              name_ar_snapshot: m.modifier.name_ar,
              price_halalas_snapshot: m.price_halalas
            }
          });
        }
      }

      await tx.orderStatusHistory.create({
        data: {
          order_id: created.id,
          from_status: null,
          to_status: "CHECKOUT_PENDING",
          actor_type: "customer",
          actor_id: user_id
        }
      });

      await tx.cart.update({ where: { id: cart.id }, data: { status: "checked_out" } });
      return created;
    });

    const full = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      include: orderInclude
    });
    return toOrderDto(full);
  }

  /** POST /v1/orders/:id/payment-intent — docs/13§3 (method: بطاقة أو محفظة C-33) */
  async createPaymentIntent(
    order_id: string,
    user_id: string,
    idempotency_key: string,
    method: "card" | "wallet" = "card"
  ) {
    const order = await prisma.order.findUnique({ where: { id: order_id } });
    if (!order || order.user_id !== user_id) throw new AppError("ORDER-4001");
    if (method === "wallet") await requireFlag("wallet_payments");

    const existingIntent = await prisma.paymentIntent.findUnique({ where: { order_id } });
    if (existingIntent && existingIntent.idempotency_key === idempotency_key) {
      return {
        intent_id: existingIntent.id,
        provider: existingIntent.provider,
        client_secret: existingIntent.client_secret ?? "",
        amount_halalas: existingIntent.amount_halalas,
        currency: "SAR" as const,
        status: existingIntent.status === "requires_payment" ? ("requires_payment" as const) : ("processing" as const)
      };
    }
    if (existingIntent) throw new AppError("ORDER-4002", { hint: "intent موجود لهذا الطلب" });

    const providerIntent = await payments.createIntent({
      amount_halalas: order.total_halalas,
      currency: "SAR",
      order_ref: order.display_code,
      idempotency_key,
      method
    });

    const intent = await prisma.$transaction(async (tx) => {
      const created = await tx.paymentIntent.create({
        data: {
          order_id,
          provider: payments.provider,
          method,
          provider_ref: providerIntent.provider_ref,
          amount_halalas: order.total_halalas,
          status: "requires_payment",
          supports_capture: providerIntent.supports_capture,
          client_secret: providerIntent.client_secret,
          idempotency_key
        }
      });
      if (order.order_status === "CHECKOUT_PENDING") {
        await transitionOrder(tx, order, "PAYMENT_PENDING", {
          actor_type: "system"
        });
      }
      return created;
    });

    return {
      intent_id: intent.id,
      provider: intent.provider,
      client_secret: intent.client_secret ?? "",
      amount_halalas: intent.amount_halalas,
      currency: "SAR" as const,
      status: "requires_payment" as const
    };
  }

  async get(order_id: string, user_id: string): Promise<OrderDto> {
    const order = await prisma.order.findUnique({ where: { id: order_id }, include: orderInclude });
    if (!order || order.user_id !== user_id) throw new AppError("ORDER-4001");
    return toOrderDto(order);
  }

  /** موافقة العميل على وقت التجهيز المتوقع الذي حدده الفرع عند القبول — الفرع لا يبدأ التجهيز قبلها */
  async confirmPrepTime(order_id: string, user_id: string): Promise<OrderDto> {
    const order = await prisma.order.findUnique({ where: { id: order_id }, include: orderInclude });
    if (!order || order.user_id !== user_id) throw new AppError("ORDER-4001");
    if (order.prep_time_confirmed_at) return toOrderDto(order); // idempotent — تكرار الضغط لا يغيّر شيئاً

    const status = order.order_status as OrderState;
    // مقبولة من القبول حتى ما قبل التسليم — بعدها لا معنى للموافقة
    const confirmable: OrderState[] = [
      "MERCHANT_ACCEPTED",
      "PREPARING",
      "READY",
      "CUSTOMER_NOTIFIED",
      "CUSTOMER_ON_THE_WAY",
      "CUSTOMER_NEARBY",
      "CUSTOMER_ARRIVED"
    ];
    if (!confirmable.includes(status)) throw new AppError("ORDER-4002", { from: status, to: status });

    const updated = await prisma.order.update({
      where: { id: order_id },
      data: { prep_time_confirmed_at: new Date() },
      include: orderInclude
    });
    return toOrderDto(updated);
  }

  /** تعديل فترة المجدول — مجاني قبل free_change_until (BR-5) */
  async reschedule(order_id: string, user_id: string, slot_id: string): Promise<OrderDto> {
    const order = await prisma.order.findUnique({
      where: { id: order_id },
      include: { scheduled_slot: true }
    });
    if (!order || order.user_id !== user_id) throw new AppError("ORDER-4001");
    if (order.pickup_time !== "scheduled" || !order.scheduled_slot) {
      throw new AppError("SYS-9004", { hint: "الطلب ليس مجدولاً" });
    }
    if (new Date() >= order.scheduled_slot.free_change_until) throw new AppError("ORDER-4008");
    // بعد دخول مسار ASAP لا تعديل
    if (!["CHECKOUT_PENDING", "PAYMENT_PENDING", "PAYMENT_AUTHORIZED", "ORDER_SUBMITTED"].includes(order.order_status)) {
      throw new AppError("ORDER-4008");
    }

    const freeChangeMinutes = await numericSetting("br5.free_change_minutes", FREE_CHANGE_MINUTES_DEFAULT);
    const oldStart = order.scheduled_slot.slot_start;

    await prisma.$transaction(async (tx) => {
      const bookedCount = await tx.$executeRaw`
        UPDATE branch_capacity_slots
        SET booked = booked + 1
        WHERE id = ${slot_id}::uuid
          AND branch_id = ${order.branch_id}::uuid
          AND booked < capacity
          AND slot_start > now()`;
      if (bookedCount !== 1) throw new AppError("ORDER-4006");

      // تحرير الفترة السابقة
      await tx.$executeRaw`
        UPDATE branch_capacity_slots
        SET booked = GREATEST(booked - 1, 0)
        WHERE branch_id = ${order.branch_id}::uuid AND slot_start = ${oldStart}`;

      const slot = await tx.branchCapacitySlot.findUniqueOrThrow({ where: { id: slot_id } });
      await tx.scheduledPickupSlot.update({
        where: { order_id },
        data: {
          slot_start: slot.slot_start,
          slot_end: slot.slot_end,
          free_change_until: new Date(slot.slot_start.getTime() - freeChangeMinutes * 60_000)
        }
      });

      // الطلب المدفوع ينتظر دخول الفترة — جدولة الدخول للموعد الجديد
      if (order.order_status === "ORDER_SUBMITTED") {
        await scheduleJob(
          tx,
          "scheduled_slot_entry",
          { order_id },
          slot.slot_start,
          `slot_entry:${order_id}:${slot.slot_start.getTime()}`
        );
      }
    });

    const full = await prisma.order.findUniqueOrThrow({ where: { id: order_id }, include: orderInclude });
    return toOrderDto(full);
  }

  /** رد العميل على تعديل الفرع — BR-4: بديل / حذف مع استرجاع جزئي / إلغاء */
  async respondToChange(
    order_id: string,
    user_id: string,
    input: { change_request_id: string; decision: "accept_substitute" | "remove_item" | "cancel" }
  ): Promise<OrderDto> {
    const order = await prisma.order.findUnique({ where: { id: order_id } });
    if (!order || order.user_id !== user_id) throw new AppError("ORDER-4001");

    const adj = await prisma.orderAdjustment.findUnique({ where: { id: input.change_request_id } });
    if (!adj || adj.order_id !== order_id) throw new AppError("ORDER-4001");
    if (adj.status !== "awaiting_customer") throw new AppError("ORDER-4005", { status: adj.status });

    const intent = await prisma.paymentIntent.findUnique({ where: { order_id } });

    await prisma.$transaction(async (tx) => {
      if (input.decision === "accept_substitute") {
        if (!adj.substitute_product_id) throw new AppError("SYS-9004", { hint: "لا بديل مقترحاً" });
        // لا تعديل سعر أحادي الجانب — البديل بنفس القيمة أو أقل في الطيار
        await tx.orderAdjustment.update({
          where: { id: adj.id },
          data: { status: "accepted_substitute", resolved_at: new Date() }
        });
      } else if (input.decision === "remove_item") {
        await tx.orderAdjustment.update({
          where: { id: adj.id },
          data: { status: "item_removed", resolved_at: new Date() }
        });
        // استرجاع جزئي لقيمة العنصر — refund_items يمنع التكرار
        const refund = await tx.refund.create({
          data: {
            order_id,
            intent_id: intent?.id ?? null,
            amount_halalas: adj.refund_halalas,
            includes_service_fee: false,
            reason: "item_removed_br4",
            status: "pending",
            requested_by: "customer",
            requester_id: user_id,
            idempotency_key: `br4:${adj.id}`
          }
        });
        const item = await tx.orderItem.findUniqueOrThrow({ where: { id: adj.order_item_id } });
        await tx.refundItem.create({
          data: {
            refund_id: refund.id,
            order_item_id: item.id,
            quantity: item.quantity,
            amount_halalas: adj.refund_halalas
          }
        });
      } else {
        // إلغاء الطلب كاملاً — يُحتسب على الفرع (نقصه سبب الإلغاء)
        await tx.orderAdjustment.update({
          where: { id: adj.id },
          data: { status: "cancelled_order", resolved_at: new Date() }
        });
        await transitionOrder(tx, order, "CANCELLATION_REQUESTED", { actor_type: "customer", actor_id: user_id }, { reason: "br4_item_unavailable" });
        await transitionOrder(
          tx,
          { ...order, order_status: "CANCELLATION_REQUESTED" as const },
          "CANCELLED",
          { actor_type: "system" },
          { reason: "br4_item_unavailable", data: { cancelled_at: new Date() } }
        );
        await tx.cancellation.create({
          data: { order_id, requested_by: "customer", reason: "br4_item_unavailable", charged_to: "merchant" }
        });
        await tx.refund.create({
          data: {
            order_id,
            intent_id: intent?.id ?? null,
            amount_halalas: order.total_halalas,
            includes_service_fee: true,
            reason: "br4_cancel_full",
            status: "pending",
            requested_by: "customer",
            requester_id: user_id,
            idempotency_key: `br4cancel:${adj.id}`
          }
        });
        const cancelled = await tx.order.findUniqueOrThrow({ where: { id: order_id } });
        await transitionOrder(tx, cancelled, "REFUND_PENDING", { actor_type: "system" }, { reason: "br4_cancel_full" });
      }

      await emitEvent(tx, {
        name: "order.change_resolved",
        aggregate_type: "order",
        aggregate_id: order_id,
        merchant_id: order.merchant_id,
        branch_id: order.branch_id,
        payload: { adjustment_id: adj.id, decision: input.decision }
      });
    });

    const full = await prisma.order.findUniqueOrThrow({ where: { id: order_id }, include: orderInclude });
    return toOrderDto(full);
  }

  /** إلغاء العميل — مصفوفة BR-2 */
  async cancel(order_id: string, user_id: string, reason: string): Promise<OrderDto> {
    const order = await prisma.order.findUnique({ where: { id: order_id } });
    if (!order || order.user_id !== user_id) throw new AppError("ORDER-4001");

    const status = order.order_status as OrderState;
    // بعد بدء التحضير لا إلغاء من العميل (يجوز استثناء بموافقة الفرع — خارج الشريحة)
    if (["PREPARING", "READY", "CUSTOMER_NOTIFIED", "CUSTOMER_ON_THE_WAY", "CUSTOMER_NEARBY", "CUSTOMER_ARRIVED", "HANDOFF_IN_PROGRESS", "COMPLETED"].includes(status)) {
      throw new AppError("ORDER-4003");
    }
    if (CUSTOMER_DISPLAY_MAP[status] === null && !["MERCHANT_PENDING", "ORDER_SUBMITTED"].includes(status)) {
      throw new AppError("ORDER-4003");
    }

    await prisma.$transaction(async (tx) => {
      await transitionOrder(tx, order, "CANCELLATION_REQUESTED", { actor_type: "customer", actor_id: user_id }, { reason });
      const fresh = { ...order, order_status: "CANCELLATION_REQUESTED" as const };
      await transitionOrder(tx, fresh, "CANCELLED", { actor_type: "system" }, {
        reason,
        data: { cancelled_at: new Date() }
      });
      await tx.cancellation.create({
        data: {
          order_id: order.id,
          requested_by: "customer",
          reason,
          charged_to: "none" // قبل القبول: تحرير كامل — BR-2
        }
      });
      // BR-5: إلغاء مجدول قبل فترته يحرّر السعة المحجوزة
      if (order.pickup_time === "scheduled") {
        const slot = await tx.scheduledPickupSlot.findUnique({ where: { order_id: order.id } });
        if (slot && slot.slot_start > new Date()) {
          await tx.$executeRaw`
            UPDATE branch_capacity_slots
            SET booked = GREATEST(booked - 1, 0)
            WHERE branch_id = ${order.branch_id}::uuid AND slot_start = ${slot.slot_start}`;
        }
      }
    });

    const full = await prisma.order.findUniqueOrThrow({ where: { id: order_id }, include: orderInclude });
    return toOrderDto(full);
  }
}
