import { Redis } from "ioredis";
import { EventEnvelopeSchema } from "@pickly/contracts";
import { createLogger } from "@pickly/observability";

/**
 * ناشر الـRealtime — يستهلك أحداث الـOutbox ويبثها لقنوات Redis (rt:*)
 * التي تعيد بوابة الـAPI بثها للـWS (docs/11§9 + خريطة docs/12§4).
 * idempotent بطبيعته: إعادة النشر لنفس الحدث تعيد نفس الحمولة (القنوات نشر فقط).
 */
const logger = createLogger("rt-publisher");

const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
  lazyConnect: true,
  maxRetriesPerRequest: 2
});

export async function publishToRealtime(rawEnvelope: unknown): Promise<void> {
  const parsed = EventEnvelopeSchema.safeParse(rawEnvelope);
  if (!parsed.success) return;
  const e = parsed.data;

  await redis.connect().catch(() => undefined);

  const payload = JSON.stringify({
    type: "event",
    name: e.name,
    aggregate_id: e.aggregate_id,
    payload: e.payload,
    at: e.timestamp
  });

  const channels: string[] = [];
  if (e.aggregate_type === "order") channels.push(`rt:order:${e.aggregate_id}`);
  if (e.branch_id) channels.push(`rt:branch:${e.branch_id}:board`);
  if (e.merchant_id) channels.push(`rt:merchant:${e.merchant_id}:alerts`);
  // تنبيهات مركز العمليات A-02
  if (["risk.alert_raised", "webhook.failed", "notification.failed", "settlement.generated"].includes(e.name)) {
    channels.push("rt:admin:live-ops");
  }

  for (const ch of channels) {
    try {
      await redis.publish(ch, payload);
    } catch (err) {
      logger.warn({ ch, err }, "rt publish failed (غير قاتل — REST هو مصدر الحقيقة)");
    }
  }
}
