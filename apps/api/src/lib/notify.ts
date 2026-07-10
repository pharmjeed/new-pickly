import type { Prisma } from "@pickly/database";

/**
 * إشعارات العميل — docs/15: قالب من notification_templates + صف notifications
 * + تسليم inapp فوري (صندوق C-62). Push الفعلي عبر Adapter (FCM بعد A6).
 */
export function renderTemplate(text: string, vars: Record<string, string | number> = {}): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_, k: string) => String(vars[k] ?? ""));
}

export async function notifyCustomer(
  tx: Prisma.TransactionClient,
  input: {
    user_id: string;
    template_key: string;
    order_id?: string | null;
    vars?: Record<string, string | number>;
    /** dedupe — لا إشعار مكرر لنفس الحدث */
    dedupe_key?: string;
  }
): Promise<void> {
  if (input.dedupe_key) {
    const dup = await tx.notification.findFirst({
      where: { template_key: input.template_key, payload: { path: ["dedupe_key"], equals: input.dedupe_key } }
    });
    if (dup) return;
  }

  const tpl = await tx.notificationTemplate.findUnique({ where: { key: input.template_key } });
  if (tpl && !tpl.is_active) return;

  const notification = await tx.notification.create({
    data: {
      user_id: input.user_id,
      order_id: input.order_id ?? null,
      template_key: input.template_key,
      channel: "inapp",
      title_ar: renderTemplate(tpl?.title_ar ?? input.template_key, input.vars),
      body_ar: renderTemplate(tpl?.body_ar ?? "", input.vars),
      ...(input.dedupe_key ? { payload: { dedupe_key: input.dedupe_key } } : {})
    }
  });
  await tx.notificationDelivery.create({
    data: {
      notification_id: notification.id,
      channel: "inapp",
      status: "delivered",
      sent_at: new Date(),
      delivered_at: new Date()
    }
  });
}
