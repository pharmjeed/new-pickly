import { prisma, type Prisma } from "@pickly/database";
import type { CreateOrderBody, Order as OrderDto, OrderState } from "@pickly/contracts";
import { CUSTOMER_DISPLAY_MAP } from "@pickly/contracts";
import { AppError } from "@pickly/observability";
import { createPaymentAdapter } from "@pickly/payments";
import { generateDisplayCode, handoffCodeFor } from "../../lib/codes.js";
import { transitionOrder } from "../../lib/state-machine.js";

/** وحدة Orders — رحلة J1 (docs/03) على آلة docs/05 وقواعد docs/06 */

const DUAL_CONFIRMATION_THRESHOLD_HALALAS = 30_000; // BR-8: ≥300 ر.س

export const payments = createPaymentAdapter();

type OrderWithItems = Prisma.OrderGetPayload<{
  include: { items: { include: { modifiers: true } }; vehicle: true; branch: { include: { brand: true } } };
}>;

const orderInclude = {
  items: { include: { modifiers: true } },
  vehicle: true,
  branch: { include: { brand: true } }
} as const;

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
          ...(body.notes ? { customer_notes: body.notes } : {}),
          idempotency_key
        }
      });

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

  /** POST /v1/orders/:id/payment-intent — docs/13§3 */
  async createPaymentIntent(order_id: string, user_id: string, idempotency_key: string) {
    const order = await prisma.order.findUnique({ where: { id: order_id } });
    if (!order || order.user_id !== user_id) throw new AppError("ORDER-4001");

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
      idempotency_key
    });

    const intent = await prisma.$transaction(async (tx) => {
      const created = await tx.paymentIntent.create({
        data: {
          order_id,
          provider: payments.provider,
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
    });

    const full = await prisma.order.findUniqueOrThrow({ where: { id: order_id }, include: orderInclude });
    return toOrderDto(full);
  }
}
