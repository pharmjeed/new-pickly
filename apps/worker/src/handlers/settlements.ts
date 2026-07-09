import { prisma } from "@pickly/database";
import { createLogger } from "@pickly/observability";

/**
 * توليد التسويات — docs/13§6:
 * دورة أسبوعية لكل تاجر: إجمالي المبيعات − الاسترجاعات − حصة العروض −
 * رسوم Pickly − رسوم الدفع + البقشيش = صافي المستحق ← payout + كشف سطري.
 * idempotent: تسوية واحدة لكل (تاجر × فترة).
 */
const logger = createLogger("settlements");

const WEEK_MS = 7 * 24 * 3600 * 1000;

/** رسوم Pickly في الطيار = رسم الخدمة المحصل من العميل (باقة pilot_basic بلا نسبة) */
export async function generateDueSettlements(now = new Date()): Promise<number> {
  const merchants = await prisma.merchant.findMany({ where: { status: "approved" } });
  let generated = 0;

  for (const merchant of merchants) {
    const last = await prisma.merchantSettlement.findFirst({
      where: { merchant_id: merchant.id },
      orderBy: { period_end: "desc" }
    });
    const periodStart = last?.period_end ?? new Date(now.getTime() - WEEK_MS);
    const periodEnd = new Date(periodStart.getTime() + WEEK_MS);
    if (periodEnd > now) continue; // الدورة لم تكتمل بعد

    const orders = await prisma.order.findMany({
      where: {
        merchant_id: merchant.id,
        order_status: { in: ["COMPLETED", "PARTIALLY_REFUNDED"] },
        completed_at: { gte: periodStart, lt: periodEnd }
      },
      include: { refunds: { where: { status: "completed" } } }
    });

    const refundsInPeriod = await prisma.refund.findMany({
      where: {
        status: "completed",
        completed_at: { gte: periodStart, lt: periodEnd },
        order: { merchant_id: merchant.id }
      }
    });

    if (orders.length === 0 && refundsInPeriod.length === 0) {
      // فترة فارغة — سجل تسوية صفرية لتقدم المؤشر (بلا payout)
      await prisma.merchantSettlement.create({
        data: {
          merchant_id: merchant.id,
          period_start: periodStart,
          period_end: periodEnd,
          gross_halalas: 0,
          refunds_halalas: 0,
          promo_share_halalas: 0,
          pickly_fees_halalas: 0,
          payment_fees_halalas: 0,
          tips_halalas: 0,
          net_halalas: 0,
          status: "generated"
        }
      });
      continue;
    }

    const gross = orders.reduce((s, o) => s + o.total_halalas, 0);
    const pickly_fees = orders.reduce((s, o) => s + o.service_fee_halalas, 0);
    const refundsSum = refundsInPeriod.reduce((s, r) => s + r.amount_halalas, 0);
    const tips = orders.reduce((s, o) => s + o.tip_halalas, 0);
    const promo_share = 0; // كوبونات الطيار مؤجلة
    const payment_fees = 0; // نموذج (ب): رسوم البوابة على التاجر تُقيد عند ربط المزود الفعلي
    const net = gross - refundsSum - promo_share - pickly_fees - payment_fees + tips;

    await prisma.$transaction(async (tx) => {
      const settlement = await tx.merchantSettlement.create({
        data: {
          merchant_id: merchant.id,
          period_start: periodStart,
          period_end: periodEnd,
          gross_halalas: gross,
          refunds_halalas: refundsSum,
          promo_share_halalas: promo_share,
          pickly_fees_halalas: pickly_fees,
          payment_fees_halalas: payment_fees,
          tips_halalas: tips,
          net_halalas: net,
          status: "generated"
        }
      });
      for (const o of orders) {
        await tx.settlementLine.create({
          data: {
            settlement_id: settlement.id,
            order_id: o.id,
            line_type: "sale",
            amount_halalas: o.total_halalas
          }
        });
        if (o.service_fee_halalas > 0) {
          await tx.settlementLine.create({
            data: {
              settlement_id: settlement.id,
              order_id: o.id,
              line_type: "pickly_fee",
              amount_halalas: -o.service_fee_halalas
            }
          });
        }
        if (o.tip_halalas > 0) {
          await tx.settlementLine.create({
            data: {
              settlement_id: settlement.id,
              order_id: o.id,
              line_type: "tip",
              amount_halalas: o.tip_halalas
            }
          });
        }
      }
      for (const r of refundsInPeriod) {
        await tx.settlementLine.create({
          data: {
            settlement_id: settlement.id,
            order_id: r.order_id,
            line_type: "refund",
            amount_halalas: -r.amount_halalas
          }
        });
      }
      if (net > 0) {
        await tx.merchantPayout.create({
          data: { merchant_id: merchant.id, settlement_id: settlement.id, amount_halalas: net }
        });
      }
      await tx.backgroundJob.create({
        data: {
          job_type: "domain_event",
          dedupe_key: `settlement.generated:${settlement.id}`,
          payload: {
            event_id: crypto.randomUUID(),
            name: "settlement.generated",
            version: 1,
            timestamp: new Date().toISOString(),
            aggregate_type: "settlement",
            aggregate_id: settlement.id,
            merchant_id: merchant.id,
            branch_id: null,
            payload: { net_halalas: net, orders: orders.length },
            idempotency_key: `settlement.generated:${settlement.id}`
          }
        }
      });
    });
    generated++;
    logger.info({ merchant: merchant.name_ar, net }, "settlement generated");
  }
  return generated;
}

/** فحص دوري كل ساعة — الدورات المستحقة تُولَّد تلقائياً */
export function startSettlementScheduler(intervalMs = 3600_000): () => void {
  let running = true;
  void (async () => {
    while (running) {
      try {
        await generateDueSettlements();
      } catch (err) {
        logger.error({ err }, "settlement loop error");
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  })();
  return () => {
    running = false;
  };
}
