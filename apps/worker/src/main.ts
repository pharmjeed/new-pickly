import "dotenv/config";
import { createLogger } from "@pickly/observability";
import { startOutboxPublisher } from "./outbox-publisher.js";

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
