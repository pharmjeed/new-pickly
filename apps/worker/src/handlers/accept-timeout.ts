import { z } from "zod";
import { prisma } from "@pickly/database";
import { createLogger } from "@pickly/observability";

/**
 * BR-1: انتهاء عداد القبول دون رد = رفض آلي بسبب timeout،
 * ويُحتسب على الفرع في تقييمه التشغيلي.
 * idempotent: إن لم يعد الطلب MERCHANT_PENDING فلا شيء يُفعل.
 */
const logger = createLogger("accept-timeout");

const PayloadSchema = z.object({ order_id: z.string().uuid() });

export async function handleAcceptTimeout(payload: unknown): Promise<void> {
  const { order_id } = PayloadSchema.parse(payload);

  const order = await prisma.order.findUnique({ where: { id: order_id } });
  if (!order || order.order_status !== "MERCHANT_PENDING") return; // رُدّ عليه — لا شيء

  const intent = await prisma.paymentIntent.findUnique({ where: { order_id } });

  await prisma.$transaction(async (tx) => {
    await tx.order.update({
      where: { id: order_id },
      data: { order_status: "MERCHANT_REJECTED" }
    });
    await tx.orderStatusHistory.create({
      data: {
        order_id,
        from_status: "MERCHANT_PENDING",
        to_status: "MERCHANT_REJECTED",
        actor_type: "system",
        reason: "timeout"
      }
    });
    await tx.order.update({
      where: { id: order_id },
      data: { order_status: "REFUND_PENDING" }
    });
    await tx.orderStatusHistory.create({
      data: {
        order_id,
        from_status: "MERCHANT_REJECTED",
        to_status: "REFUND_PENDING",
        actor_type: "system",
        reason: "timeout"
      }
    });
    // الاسترجاع الكامل — التنفيذ عند البوابة تتم متابعته بمعالج refunds (مرحلة 5)
    await tx.refund.upsert({
      where: { idempotency_key: `timeout:${order_id}` },
      create: {
        order_id,
        intent_id: intent?.id ?? null,
        amount_halalas: order.total_halalas,
        includes_service_fee: true,
        reason: "merchant_timeout",
        status: "pending",
        requested_by: "system",
        idempotency_key: `timeout:${order_id}`
      },
      update: {}
    });
    await tx.backgroundJob.create({
      data: {
        job_type: "domain_event",
        dedupe_key: `merchant.order_rejected:timeout:${order_id}`,
        payload: {
          event_id: crypto.randomUUID(),
          name: "merchant.order_rejected",
          version: 1,
          timestamp: new Date().toISOString(),
          aggregate_type: "order",
          aggregate_id: order_id,
          merchant_id: order.merchant_id,
          branch_id: order.branch_id,
          payload: { reason: "timeout" },
          idempotency_key: `merchant.order_rejected:timeout:${order_id}`
        }
      }
    });
  });

  logger.warn({ order_id }, "رفض آلي: انتهى عداد القبول");
}
