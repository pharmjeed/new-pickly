import { prisma } from "@pickly/database";
import { createLogger } from "@pickly/observability";
import { createPaymentAdapter } from "@pickly/payments";

/**
 * معالج الاسترجاعات المعلقة — docs/13§5 + BR-12:
 * يلتقط refunds بحالة pending، ينفذها عند البوابة (تحرير حجز أو refund)،
 * يكمل قيد الـledger، ويحوّل الطلب إلى REFUNDED/PARTIALLY_REFUNDED.
 * idempotent: refund.idempotency_key فريد + فحص الحالة قبل التنفيذ.
 */
const logger = createLogger("refund-processor");
const payments = createPaymentAdapter();

export async function processPendingRefunds(): Promise<number> {
  const pending = await prisma.refund.findMany({
    where: { status: "pending" },
    include: { intent: true, order: true },
    take: 20,
    orderBy: { created_at: "asc" }
  });

  for (const refund of pending) {
    try {
      // قفل تفاؤلي — لا يعالجها worker آخر
      const locked = await prisma.refund.updateMany({
        where: { id: refund.id, status: "pending" },
        data: { status: "processing" }
      });
      if (locked.count === 0) continue;

      // حصة محفظة بيكلي تعود للمحفظة أولاً، والباقي عبر البوابة (docs/01§1 — قرار المالك 2026-07-12)
      const wallet_part = Math.min(
        refund.amount_halalas,
        refund.intent?.wallet_applied_halalas ?? 0
      );
      const gateway_part = refund.amount_halalas - wallet_part;

      let provider_ref = wallet_part > 0 && gateway_part === 0 ? "pickly-wallet" : "no-payment";
      if (refund.intent?.provider_ref && gateway_part > 0) {
        if (refund.intent.status === "captured") {
          const res = await payments.refund(
            refund.intent.provider_ref,
            gateway_part,
            refund.idempotency_key
          );
          if (!res.ok) throw new Error("gateway refund failed");
          provider_ref = res.refund_ref;
        } else {
          // مبلغ محجوز لم يُلتقط — تحرير (docs/13§3)
          const res = await payments.cancelOrRelease(refund.intent.provider_ref);
          if (!res.ok) throw new Error("gateway release failed");
          provider_ref = "released";
        }
      }

      await prisma.$transaction(async (tx) => {
        await tx.refund.update({
          where: { id: refund.id },
          data: { status: "completed", completed_at: new Date(), provider_ref }
        });
        if (refund.intent && gateway_part > 0) {
          await tx.paymentTransaction.create({
            data: {
              intent_id: refund.intent.id,
              type: "refund",
              debit_account: "merchant_payable",
              credit_account: "customer_receivable",
              amount_halalas: gateway_part,
              idempotency_key: `ledger:${refund.idempotency_key}`
            }
          });
        }
        if (refund.intent && wallet_part > 0) {
          // قيد إيداع للمحفظة + قيد Ledger مقابل — idempotent بمفتاح مشتق
          await tx.customerWalletEntry.create({
            data: {
              user_id: refund.order.user_id,
              amount_halalas: wallet_part,
              entry_type: "credit",
              reference: `refund:${refund.id}`
            }
          });
          await tx.paymentTransaction.create({
            data: {
              intent_id: refund.intent.id,
              type: "refund",
              debit_account: "merchant_payable",
              credit_account: "customer_wallet",
              amount_halalas: wallet_part,
              idempotency_key: `ledger-wallet:${refund.idempotency_key}`
            }
          });
        }
        // REFUND_PENDING → REFUNDED (كامل) أو PARTIALLY_REFUNDED (جزئي)
        const order = await tx.order.findUniqueOrThrow({ where: { id: refund.order_id } });
        if (order.order_status === "REFUND_PENDING") {
          const full = refund.amount_halalas >= order.total_halalas;
          const to = full ? "REFUNDED" : "PARTIALLY_REFUNDED";
          await tx.order.update({ where: { id: order.id }, data: { order_status: to } });
          await tx.orderStatusHistory.create({
            data: {
              order_id: order.id,
              from_status: "REFUND_PENDING",
              to_status: to,
              actor_type: "system",
              reason: refund.reason
            }
          });
          await tx.backgroundJob.create({
            data: {
              job_type: "domain_event",
              dedupe_key: `refund.completed:${refund.id}`,
              payload: {
                event_id: crypto.randomUUID(),
                name: "refund.completed",
                version: 1,
                timestamp: new Date().toISOString(),
                aggregate_type: "refund",
                aggregate_id: refund.id,
                merchant_id: order.merchant_id,
                branch_id: order.branch_id,
                payload: { amount_halalas: refund.amount_halalas, full },
                idempotency_key: `refund.completed:${refund.id}`
              }
            }
          });
        }
      });
      logger.info({ refund_id: refund.id, amount: refund.amount_halalas }, "refund completed");
    } catch (err) {
      await prisma.refund.updateMany({
        where: { id: refund.id, status: "processing" },
        data: { status: "pending" } // يُعاد التقاطها لاحقاً
      });
      logger.error({ refund_id: refund.id, err }, "refund failed — will retry");
    }
  }
  return pending.length;
}

/** حلقة دورية خفيفة — تُستدعى من main */
export function startRefundProcessor(intervalMs = 10_000): () => void {
  let running = true;
  void (async () => {
    while (running) {
      try {
        await processPendingRefunds();
      } catch (err) {
        logger.error({ err }, "refund loop error");
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  })();
  return () => {
    running = false;
  };
}
