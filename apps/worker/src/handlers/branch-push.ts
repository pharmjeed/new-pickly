import { Redis } from "ioredis";
import { prisma } from "@pickly/database";
import { EventEnvelopeSchema } from "@pickly/contracts";
import { createLogger } from "@pickly/observability";

/**
 * Push أصلي لأجهزة الفرع (غلاف Expo) عند وصول طلب جديد — merchant.order_received:
 * صفحة اللوحة تتجمد عند قفل الجهاز فلا يصدح إنذارها المتكرر؛ الإشعار النظامي
 * يصل من نظام التشغيل نفسه ويرن حتى والشاشة مقفلة. الإرسال عبر Expo Push API
 * (يوصّل لـAPNs/FCM بمفاتيح EAS — HUMAN-ACTIONS B8).
 * idempotent عبر علامة Redis على event_id لأن الـOutbox at-least-once.
 */
const logger = createLogger("branch-push");

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const EXPO_BATCH = 100; // حد Expo لكل نداء

const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
  lazyConnect: true,
  maxRetriesPerRequest: 2
});

interface ExpoTicket {
  status: "ok" | "error";
  message?: string;
  details?: { error?: string };
}

export async function pushBranchNewOrder(raw: unknown): Promise<void> {
  const parsed = EventEnvelopeSchema.safeParse(raw);
  if (!parsed.success) return;
  const e = parsed.data;
  if (e.name !== "merchant.order_received" || !e.branch_id) return;

  const devices = await prisma.device.findMany({
    where: { branch_id: e.branch_id, push_token: { startsWith: "ExponentPushToken" } }
  });
  if (devices.length === 0) return;

  // dedupe: retry الحدث يعيد كل المستهلكين — علامة لكل event_id كي لا يرن الجهاز مرتين
  let marked = false;
  try {
    await redis.connect().catch(() => undefined);
    marked = (await redis.set(`push:branch:${e.event_id}`, "1", "EX", 86_400, "NX")) !== null;
    if (!marked) return;
  } catch {
    /* Redis معطل — نرسل بلا dedupe: تكرار محتمل أهون من إنذار ضائع */
  }

  const order = await prisma.order.findUnique({ where: { id: e.aggregate_id } });
  const body = order ? `الطلب ${order.display_code} بانتظار القبول` : "طلب بانتظار القبول";

  const messages = devices.map((d) => ({
    to: d.push_token,
    title: "🛎️ طلب جديد وصل",
    body,
    sound: "default",
    priority: "high",
    channelId: "orders", // قناة أندرويد المهيأة في الغلاف (أهمية قصوى + ظهور على شاشة القفل)
    data: { order_id: e.aggregate_id, branch_id: e.branch_id }
  }));

  try {
    const tickets: ExpoTicket[] = [];
    for (let i = 0; i < messages.length; i += EXPO_BATCH) {
      const res = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(messages.slice(i, i + EXPO_BATCH))
      });
      if (!res.ok) throw new Error(`Expo push HTTP ${res.status}`);
      const json = (await res.json()) as { data?: ExpoTicket[] };
      tickets.push(...(json.data ?? []));
    }
    // توكن ميّت (حُذف التطبيق/تبدّل الجهاز) — يُصفَّر كي لا نراسله للأبد
    for (const [i, t] of tickets.entries()) {
      const device = devices[i];
      if (t.status === "error" && t.details?.error === "DeviceNotRegistered" && device) {
        await prisma.device.update({ where: { id: device.id }, data: { push_token: null } });
        logger.info({ device_id: device.id }, "push token ميت — صُفِّر");
      }
    }
    logger.info({ branch_id: e.branch_id, devices: messages.length }, "branch new-order push sent");
  } catch (err) {
    // فشل الإرسال — نُرجع العلامة كي يعيد retry الـOutbox المحاولة فعلاً
    if (marked) await redis.del(`push:branch:${e.event_id}`).catch(() => undefined);
    throw err;
  }
}
