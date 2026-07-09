import { config } from "dotenv";
// محلياً يُحمَّل .env من جذر الـmonorepo؛ في السحابة البيئة تأتي من Secret Manager
config({ path: [".env", "../../.env"] });

const { createLogger } = await import("@pickly/observability");
const { registerJobHandler, startOutboxPublisher } = await import("./outbox-publisher.js");
const { handleAcceptTimeout } = await import("./handlers/accept-timeout.js");

registerJobHandler("accept_timeout", handleAcceptTimeout);

/**
 * Worker — Background Workers (docs/09§3):
 * - Outbox Publisher: يلتقط أحداث النطاق من background_jobs وينشرها (docs/12§3-1).
 * - Workers قادمة (مراحل 2+): عداد القبول BR-1، No-show BR-3، التسويات، retention.
 * القاعدة: كل Job idempotent وقابل لإعادة التشغيل بأمان (docs/09§6-7).
 */
const logger = createLogger("worker");

const stop = startOutboxPublisher();

logger.info("Pickly worker يعمل — outbox publisher نشط");

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    logger.info({ sig }, "إيقاف worker");
    stop();
    process.exit(0);
  });
}
