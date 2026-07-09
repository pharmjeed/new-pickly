import { prisma } from "@pickly/database";
import { createLogger } from "@pickly/observability";

const logger = createLogger("maintenance");

/**
 * سياسة الاحتفاظ — docs/17§4 + docs/10§4:
 * pickup_location_events خام 30 يوماً بعد الإكمال ثم حذف.
 */
export async function runRetentionCleanup(): Promise<number> {
  const cutoff = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const sessions = await prisma.pickupSession.findMany({
    where: { status: { in: ["completed", "cancelled"] }, ended_at: { lt: cutoff } },
    select: { id: true }
  });
  if (sessions.length === 0) return 0;
  const { count } = await prisma.pickupLocationEvent.deleteMany({
    where: { session_id: { in: sessions.map((s) => s.id) } }
  });
  if (count > 0) logger.info({ deleted: count }, "retention: raw location events purged");
  return count;
}

/**
 * Reconciliation يومي — docs/13§4-8:
 * البوابة (payment_webhook_events) × ledger (payment_transactions) × الطلبات.
 * الفروق تفتح تنبيهاً مالياً (risk.alert_raised + analytics).
 */
export async function runReconciliation(): Promise<{ ok: boolean; issues: string[] }> {
  const since = new Date(Date.now() - 24 * 3600 * 1000);
  const issues: string[] = [];

  // 1) كل intent مُلتقط له قيد capture مطابق في الـledger
  const captured = await prisma.paymentIntent.findMany({
    where: { status: "captured", updated_at: { gte: since } },
    include: { transactions: true }
  });
  for (const intent of captured) {
    const capture = intent.transactions.find((t) => t.type === "capture");
    if (!capture) {
      issues.push(`intent ${intent.id}: captured بلا قيد capture`);
    } else if (capture.amount_halalas !== intent.amount_halalas) {
      issues.push(`intent ${intent.id}: مبلغ capture ${capture.amount_halalas} ≠ ${intent.amount_halalas}`);
    }
  }

  // 2) كل استرجاع مكتمل له قيد refund
  const refunds = await prisma.refund.findMany({
    where: { status: "completed", completed_at: { gte: since } },
    include: { intent: { include: { transactions: true } } }
  });
  for (const r of refunds) {
    if (!r.intent) continue;
    const entry = r.intent.transactions.find(
      (t) => t.type === "refund" && t.amount_halalas === r.amount_halalas
    );
    if (!entry) issues.push(`refund ${r.id}: مكتمل بلا قيد ledger مطابق`);
  }

  // 3) webhooks غير معالجة أو فاشلة
  const unprocessed = await prisma.paymentWebhookEvent.count({
    where: { received_at: { gte: since }, processed_at: null }
  });
  if (unprocessed > 0) issues.push(`${unprocessed} webhook دون معالجة خلال 24 ساعة`);

  await prisma.analyticsEvent.create({
    data: {
      name: "finance.reconciliation_run",
      props: { issues_count: issues.length, issues: issues.slice(0, 20) } as never
    }
  });

  if (issues.length > 0) {
    logger.error({ issues }, "reconciliation: فروق مالية");
    await prisma.backgroundJob.create({
      data: {
        job_type: "domain_event",
        dedupe_key: `risk.alert_raised:recon:${new Date().toISOString().slice(0, 10)}`,
        payload: {
          event_id: crypto.randomUUID(),
          name: "risk.alert_raised",
          version: 1,
          timestamp: new Date().toISOString(),
          aggregate_type: "finance",
          aggregate_id: crypto.randomUUID(),
          merchant_id: null,
          branch_id: null,
          payload: { kind: "reconciliation_mismatch", issues: issues.slice(0, 20) },
          idempotency_key: `recon:${new Date().toISOString().slice(0, 10)}`
        }
      }
    }).catch(() => undefined); // dedupe per يوم
  } else {
    logger.info("reconciliation: مطابق ✓");
  }
  return { ok: issues.length === 0, issues };
}

/** حلقة صيانة يومية (كل 6 ساعات تحسباً لإيقاف/تشغيل) */
export function startMaintenanceLoop(intervalMs = 6 * 3600_000): () => void {
  let running = true;
  void (async () => {
    while (running) {
      try {
        await runRetentionCleanup();
        await runReconciliation();
      } catch (err) {
        logger.error({ err }, "maintenance loop error");
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  })();
  return () => {
    running = false;
  };
}
