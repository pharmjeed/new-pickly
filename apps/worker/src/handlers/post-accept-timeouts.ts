import { z } from "zod";
import { prisma } from "@pickly/database";
import { createLogger } from "@pickly/observability";
import { notifyInApp } from "./notifications.js";

/**
 * مهلتا ما بعد القبول — docs/06 BR-2 (قرار المالك 2026-07-11: 5 دقائق لكلٍّ):
 * - prep_confirm_timeout: قبول الفرع دون موافقة العميل على الوقت → EXPIRED.
 * - payment_timeout: موافقة دون إتمام الدفع → EXPIRED.
 * لا أثر مالي — كلاهما يسبق قبض أي مبلغ. idempotent: تفحص الحالة قبل أي فعل.
 */
const logger = createLogger("post-accept-timeouts");

const PayloadSchema = z.object({ order_id: z.string().uuid() });

type OrderRow = NonNullable<Awaited<ReturnType<typeof prisma.order.findUnique>>>;

async function expireOrder(
  order: OrderRow,
  reason: "prep_confirm_timeout" | "payment_timeout",
  template_key: string
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.order.update({ where: { id: order.id }, data: { order_status: "EXPIRED" } });
    await tx.orderStatusHistory.create({
      data: {
        order_id: order.id,
        from_status: order.order_status,
        to_status: "EXPIRED",
        actor_type: "system",
        reason
      }
    });
    // BR-5: مجدول انتهت مهلته يحرّر سعته المحجوزة
    const slot = await tx.scheduledPickupSlot.findUnique({ where: { order_id: order.id } });
    if (slot && slot.slot_start > new Date()) {
      const branch = await tx.order.findUniqueOrThrow({ where: { id: order.id }, select: { branch_id: true } });
      await tx.$executeRaw`
        UPDATE branch_capacity_slots
        SET booked = GREATEST(booked - 1, 0)
        WHERE branch_id = ${branch.branch_id}::uuid AND slot_start = ${slot.slot_start}`;
    }
    await notifyInApp(tx, {
      user_id: order.user_id,
      order_id: order.id,
      template_key,
      vars: { display_code: order.display_code },
      dedupe_key: `${reason}:${order.id}`
    });
  });
  logger.warn({ order_id: order.id, reason }, "انتهت المهلة — الطلب EXPIRED بلا أثر مالي");
}

/** انتهاء مهلة موافقة العميل على وقت التجهيز (5 د من القبول) */
export async function handlePrepConfirmTimeout(payload: unknown): Promise<void> {
  const { order_id } = PayloadSchema.parse(payload);
  const order = await prisma.order.findUnique({ where: { id: order_id } });
  if (!order) return;
  if (order.order_status !== "MERCHANT_ACCEPTED") return; // تقدّم أو أُلغي — لا شيء
  if (order.prep_time_confirmed_at) return; // وافق — مهلة الدفع تتولى الباقي
  await expireOrder(order, "prep_confirm_timeout", "order_expired_unconfirmed");
}

/** انتهاء مهلة إتمام الدفع (5 د من الموافقة) */
export async function handlePaymentTimeout(payload: unknown): Promise<void> {
  const { order_id } = PayloadSchema.parse(payload);
  const order = await prisma.order.findUnique({ where: { id: order_id } });
  if (!order) return;
  if (!["MERCHANT_ACCEPTED", "PAYMENT_PENDING", "PAYMENT_FAILED"].includes(order.order_status)) return;
  // سباق: webhook النجاح قد يكون في الطريق — دفعٌ مكتمل يعني ألا ننهي شيئاً
  const intent = await prisma.paymentIntent.findUnique({ where: { order_id } });
  if (intent && ["authorized", "captured"].includes(intent.status)) return;
  await expireOrder(order, "payment_timeout", "order_expired_unpaid");
}
