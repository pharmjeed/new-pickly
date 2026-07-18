import { z } from "zod";
import { prisma } from "@pickly/database";
import { createLogger } from "@pickly/observability";
import { pushCustomerTemplate } from "./customer-push.js";

/**
 * BR-3 عدم الحضور:
 * تذكير عند 15 دقيقة من الجاهزية ← عند 45 دقيقة: NO_SHOW.
 * الافتراضي في الطيار: استرجاع قيمة الطلب واستبقاء رسم الخدمة.
 * تكرار (3 في 30 يوماً) ← إشارة مخاطر.
 * idempotent: يفحص الحالة قبل أي فعل.
 */
const logger = createLogger("no-show");
const PayloadSchema = z.object({ order_id: z.string().uuid() });

/** الحالات التي ما زال العميل فيها لم يستلم بعد الجاهزية */
const WAITING_STATES = ["READY", "CUSTOMER_NOTIFIED"];

export async function handleNoShowReminder(payload: unknown): Promise<void> {
  const { order_id } = PayloadSchema.parse(payload);
  const order = await prisma.order.findUnique({ where: { id: order_id } });
  if (!order || !WAITING_STATES.includes(order.order_status)) return; // تحرك — لا تذكير

  await prisma.$transaction(async (tx) => {
    const notification = await tx.notification.create({
      data: {
        user_id: order.user_id,
        order_id,
        template_key: "no_show_reminder",
        channel: "push",
        title_ar: "طلبك بانتظارك",
        body_ar: "طلبك جاهز من فترة — إذا تأخرت أكثر قد يُلغى وفق السياسة"
      }
    });
    await tx.notificationDelivery.create({
      data: { notification_id: notification.id, channel: "push", status: "sent", sent_at: new Date() }
    });
  });
  // Push نظامي يرن حتى والتطبيق مقفل — فشله لا يعيد المعالج (صف الإشعار أعلاه بلا dedupe)
  await pushCustomerTemplate({
    user_id: order.user_id,
    template_key: "no_show_reminder",
    vars: { display_code: order.display_code },
    dedupe_key: `noshow_reminder:${order_id}`,
    order_id
  }).catch((err: unknown) => logger.warn({ order_id, err }, "no-show push failed"));
  logger.info({ order_id }, "no-show reminder sent");
}

export async function handleNoShowCheck(payload: unknown): Promise<void> {
  const { order_id } = PayloadSchema.parse(payload);
  const order = await prisma.order.findUnique({ where: { id: order_id } });
  if (!order || !WAITING_STATES.includes(order.order_status)) return;

  const intent = await prisma.paymentIntent.findUnique({ where: { order_id } });

  await prisma.$transaction(async (tx) => {
    await tx.order.update({ where: { id: order_id }, data: { order_status: "NO_SHOW" } });
    await tx.orderStatusHistory.create({
      data: {
        order_id,
        from_status: order.order_status as never,
        to_status: "NO_SHOW",
        actor_type: "system",
        reason: "no_show_threshold_45m"
      }
    });
    await tx.order.update({ where: { id: order_id }, data: { order_status: "REFUND_PENDING" } });
    await tx.orderStatusHistory.create({
      data: {
        order_id,
        from_status: "NO_SHOW",
        to_status: "REFUND_PENDING",
        actor_type: "system",
        reason: "no_show_policy_refund"
      }
    });
    // الطيار: قيمة الطلب تُسترجع ورسم الخدمة يُستبقى — BR-3
    await tx.refund.upsert({
      where: { idempotency_key: `noshow:${order_id}` },
      create: {
        order_id,
        intent_id: intent?.id ?? null,
        amount_halalas: order.total_halalas - order.service_fee_halalas,
        includes_service_fee: false,
        reason: "no_show",
        status: "pending",
        requested_by: "system",
        idempotency_key: `noshow:${order_id}`
      },
      update: {}
    });
    // إشارة مخاطر عند التكرار — 3 خلال 30 يوماً
    const profile = await tx.customerProfile.update({
      where: { user_id: order.user_id },
      data: { no_show_count_30d: { increment: 1 } }
    });
    if (profile.no_show_count_30d >= 3) {
      await tx.customerProfile.update({
        where: { user_id: order.user_id },
        data: { risk_flagged_at: new Date() }
      });
      await tx.backgroundJob.create({
        data: {
          job_type: "domain_event",
          dedupe_key: `risk.alert_raised:noshow:${order.user_id}:${order_id}`,
          payload: {
            event_id: crypto.randomUUID(),
            name: "risk.alert_raised",
            version: 1,
            timestamp: new Date().toISOString(),
            aggregate_type: "customer",
            aggregate_id: order.user_id,
            merchant_id: null,
            branch_id: null,
            payload: { kind: "repeat_no_show", count: profile.no_show_count_30d },
            idempotency_key: `risk:noshow:${order.user_id}:${order_id}`
          }
        }
      });
    }
  });
  logger.warn({ order_id }, "order marked NO_SHOW");
}
