import { Redis } from "ioredis";
import { prisma } from "@pickly/database";
import { createLogger } from "@pickly/observability";

/**
 * مشترك إرسال Expo Push — يخدم تنبيه تابلت الفرع (branch-push) وجوال العميل
 * (customer-push): دفعات بحد Expo، تصفير التوكن الميت، وعلامة Redis
 * idempotent على كل إرسال لأن الـOutbox at-least-once.
 * الإرسال عبر Expo Push API (يوصّل لـAPNs/FCM بمفاتيح EAS — HUMAN-ACTIONS B8).
 */
const logger = createLogger("expo-push");

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

export interface PushDevice {
  id: string;
  push_token: string | null;
}

/** «marked» عُلّمت الآن · «duplicate» سبق إرسالها · «unavailable» ‏Redis معطل — نرسل بلا dedupe: تكرار محتمل أهون من تنبيه ضائع */
export type PushMark = "marked" | "duplicate" | "unavailable";

export async function markPushOnce(key: string): Promise<PushMark> {
  try {
    await redis.connect().catch(() => undefined);
    const set = await redis.set(key, "1", "EX", 86_400, "NX");
    return set === null ? "duplicate" : "marked";
  } catch {
    return "unavailable";
  }
}

/** فشل الإرسال بعد التعليم — نرفع العلامة كي يعيد retry المحاولة فعلاً */
export async function unmarkPush(key: string): Promise<void> {
  await redis.del(key).catch(() => undefined);
}

/** يرسل الرسائل بدفعات، ويصفّر توكن الجهاز الميت (حُذف التطبيق/تبدّل الجهاز) كي لا نراسله للأبد */
export async function sendExpoMessages(devices: PushDevice[], messages: unknown[]): Promise<void> {
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
  for (const [i, t] of tickets.entries()) {
    const device = devices[i];
    if (t.status === "error" && t.details?.error === "DeviceNotRegistered" && device) {
      await prisma.device.update({ where: { id: device.id }, data: { push_token: null } });
      logger.info({ device_id: device.id }, "push token ميت — صُفِّر");
    }
  }
}
