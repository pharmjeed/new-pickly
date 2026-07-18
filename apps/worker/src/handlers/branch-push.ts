import { prisma } from "@pickly/database";
import { EventEnvelopeSchema } from "@pickly/contracts";
import { createLogger } from "@pickly/observability";
import { markPushOnce, sendExpoMessages, unmarkPush } from "./expo-push.js";

/**
 * Push أصلي لأجهزة الفرع (غلاف Expo) عند وصول طلب جديد — merchant.order_received:
 * صفحة اللوحة تتجمد عند قفل الجهاز فلا يصدح إنذارها المتكرر؛ الإشعار النظامي
 * يصل من نظام التشغيل نفسه ويرن حتى والشاشة مقفلة.
 * idempotent عبر علامة Redis على event_id لأن الـOutbox at-least-once.
 */
const logger = createLogger("branch-push");

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
  const redisKey = `push:branch:${e.event_id}`;
  const mark = await markPushOnce(redisKey);
  if (mark === "duplicate") return;

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
    await sendExpoMessages(devices, messages);
    logger.info({ branch_id: e.branch_id, devices: messages.length }, "branch new-order push sent");
  } catch (err) {
    // فشل الإرسال — نُرجع العلامة كي يعيد retry الـOutbox المحاولة فعلاً
    if (mark === "marked") await unmarkPush(redisKey);
    throw err;
  }
}
