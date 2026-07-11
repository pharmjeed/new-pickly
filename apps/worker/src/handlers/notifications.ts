import { prisma, type Prisma } from "@pickly/database";
import { EventEnvelopeSchema } from "@pickly/contracts";
import { createLogger } from "@pickly/observability";

/**
 * إشعارات العميل من أحداث النطاق — docs/15 (CN-01…CN-12):
 * مستهلك Outbox يكتب صف notifications (inapp) من القالب المناسب.
 * idempotent عبر dedupe_key = event_id في payload الإشعار.
 * Push الفعلي عبر Adapter (FCM بعد HUMAN-ACTIONS A6).
 */
const logger = createLogger("notifications");

export async function notifyInApp(
  tx: Prisma.TransactionClient,
  input: {
    user_id: string;
    order_id?: string | null;
    template_key: string;
    vars?: Record<string, string>;
    dedupe_key: string;
  }
): Promise<void> {
  const dup = await tx.notification.findFirst({
    where: { template_key: input.template_key, payload: { path: ["dedupe_key"], equals: input.dedupe_key } }
  });
  if (dup) return;
  const tpl = await tx.notificationTemplate.findUnique({ where: { key: input.template_key } });
  if (tpl && !tpl.is_active) return;
  const render = (s: string) => s.replace(/\{\{(\w+)\}\}/g, (_, k: string) => input.vars?.[k] ?? "");
  const n = await tx.notification.create({
    data: {
      user_id: input.user_id,
      order_id: input.order_id ?? null,
      template_key: input.template_key,
      channel: "inapp",
      title_ar: render(tpl?.title_ar ?? input.template_key),
      body_ar: render(tpl?.body_ar ?? ""),
      payload: { dedupe_key: input.dedupe_key }
    }
  });
  await tx.notificationDelivery.create({
    data: {
      notification_id: n.id,
      channel: "inapp",
      status: "delivered",
      sent_at: new Date(),
      delivered_at: new Date()
    }
  });
}

/** حدث نطاق ← مفتاح قالب (docs/15§2) */
const EVENT_TEMPLATES: Record<string, string> = {
  "order.created": "order_submitted",
  "merchant.order_accepted": "order_accepted",
  "merchant.order_rejected": "order_rejected",
  // الدفع بعد القبول: نجاح الدفع يبدأ التحضير — نطمئن العميل وننطلقه (CN-04)
  "order.preparing": "order_preparing",
  "handoff.started": "handoff_started",
  "order.completed": "order_completed",
  "refund.completed": "refund_completed"
};

export async function writeCustomerNotifications(raw: unknown): Promise<void> {
  const envelope = EventEnvelopeSchema.parse(raw);

  let template_key = EVENT_TEMPLATES[envelope.name];
  if (envelope.name === "order.ready") template_key = "order_ready"; // يُبدَّل لـlater_ready أدناه
  if (!template_key) return;
  if (envelope.aggregate_type !== "order" && envelope.name !== "refund.completed") return;

  // الطلب صاحب الحدث — refund.completed قد يكون aggregate آخر يحمل order_id في الحمولة
  const order_id =
    envelope.aggregate_type === "order"
      ? envelope.aggregate_id
      : typeof envelope.payload.order_id === "string"
        ? envelope.payload.order_id
        : null;
  if (!order_id) return;

  const order = await prisma.order.findUnique({ where: { id: order_id } });
  if (!order) return;

  // «سأتحرك لاحقاً»: عند الجاهزية نطمئنه أن الطلب محفوظ ويتحرك وقت ما يناسبه (FR-C06)
  if (envelope.name === "order.ready" && order.pickup_time === "later") {
    template_key = "later_ready";
  }

  await prisma.$transaction(async (tx) => {
    await notifyInApp(tx, {
      user_id: order.user_id,
      order_id,
      template_key,
      vars: {
        display_code: order.display_code,
        // قالب القبول يعرض الوقت المتوقع ويطلب الموافقة والدفع (CN-02)
        prep_minutes: order.prep_minutes !== null ? String(order.prep_minutes) : ""
      },
      dedupe_key: envelope.event_id
    });
  });
  logger.debug({ order_id, template_key }, "notification written");
}
