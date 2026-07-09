import { prisma } from "@pickly/database";
import { EventEnvelopeSchema } from "@pickly/contracts";
import { createLogger } from "@pickly/observability";

/**
 * Outbox Publisher — docs/12§3:
 * الحدث كُتب في background_jobs (job_type='domain_event') في نفس معاملة التغيير.
 * هنا: التقاط ← معالجة ← إكمال. Retry أسّي بحد 5 ثم Dead Letter (dead_letter_jobs).
 * المعالجة الفعلية (إشعارات/تحليلات/webhooks) تُوصل في المراحل القادمة عبر handlers.
 */
const logger = createLogger("outbox");

const POLL_MS = 1000;
const BATCH = 20;

type EventHandler = (envelope: unknown) => Promise<void>;
const handlers: EventHandler[] = [];

/** تسجيل مستهلك — كل مستهلك idempotent (يفحص event_id) */
export function registerEventHandler(h: EventHandler): void {
  handlers.push(h);
}

async function processBatch(workerId: string): Promise<number> {
  // التقاط دفعة بقفل تفاؤلي — آمن مع أكثر من worker
  const jobs = await prisma.$transaction(async (tx) => {
    const candidates = await tx.backgroundJob.findMany({
      where: {
        job_type: "domain_event",
        status: "pending",
        run_at: { lte: new Date() }
      },
      orderBy: { created_at: "asc" },
      take: BATCH
    });
    if (candidates.length === 0) return [];
    const ids = candidates.map((j) => j.id);
    await tx.backgroundJob.updateMany({
      where: { id: { in: ids }, status: "pending" },
      data: { status: "processing", locked_at: new Date(), locked_by: workerId }
    });
    return candidates;
  });

  for (const job of jobs) {
    try {
      const envelope = EventEnvelopeSchema.parse(job.payload);
      for (const h of handlers) await h(envelope);
      await prisma.backgroundJob.update({
        where: { id: job.id },
        data: { status: "completed", completed_at: new Date() }
      });
      logger.debug({ event: envelope.name, id: envelope.event_id }, "event published");
    } catch (err) {
      const attempts = job.attempts + 1;
      if (attempts >= job.max_attempts) {
        // Dead Letter بتنبيه للأدمن — docs/12§3-3
        await prisma.$transaction([
          prisma.deadLetterJob.create({
            data: {
              original_job_id: job.id,
              job_type: job.job_type,
              payload: job.payload as never,
              error: err instanceof Error ? err.message : String(err),
              attempts
            }
          }),
          prisma.backgroundJob.update({
            where: { id: job.id },
            data: { status: "failed", attempts, last_error: String(err) }
          })
        ]);
        logger.error({ job_id: job.id, err }, "event moved to dead letter");
      } else {
        // Retry أسّي: 2^attempts ثوانٍ
        await prisma.backgroundJob.update({
          where: { id: job.id },
          data: {
            status: "pending",
            attempts,
            last_error: String(err),
            run_at: new Date(Date.now() + 2 ** attempts * 1000),
            locked_at: null,
            locked_by: null
          }
        });
      }
    }
  }
  return jobs.length;
}

export function startOutboxPublisher(): () => void {
  const workerId = `worker-${process.pid}`;
  let running = true;

  void (async () => {
    while (running) {
      try {
        const n = await processBatch(workerId);
        if (n === 0) await new Promise((r) => setTimeout(r, POLL_MS));
      } catch (err) {
        logger.error({ err }, "outbox loop error");
        await new Promise((r) => setTimeout(r, POLL_MS * 5));
      }
    }
  })();

  return () => {
    running = false;
  };
}
