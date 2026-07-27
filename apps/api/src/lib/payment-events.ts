import { prisma, type Prisma } from "@pickly/database";
import { AppError } from "@pickly/observability";
import { emitEvent } from "./events.js";
import { proceedAfterAuthorization } from "./payment-flow.js";
import { transitionOrder } from "./state-machine.js";

/**
 * تطبيق نتيجة البوابة على النية والطلب والـLedger — المصدر الوحيد للحقيقة
 * (docs/13§4-4: الحالة النهائية من الخادم/webhook لا من التطبيق).
 *
 * يستدعيه ثلاثة مسارات ولذلك هو idempotent بالكامل:
 * 1. webhook البوابة  2. نتيجة `charge` المباشرة  3. مزامنة صفحة العودة.
 * الحماية: انتقال الطلب لا يقع إلا وهو في PAYMENT_PENDING، وقيود الـLedger
 * بمفاتيح idempotency فريدة تُسقط المكرر (skipDuplicates).
 */

export type PaymentEventType =
  | "payment.authorized"
  | "payment.captured"
  | "payment.failed"
  | "payment.cancelled"
  | "payment.refunded";

/** مطابقة المبلغ والعملة والطلب قبل أي تحويل حالة — docs/13§4-5 */
export async function applyPaymentEvent(
  event_type: string,
  provider_ref: string,
  amount_halalas: number,
  metadata?: Record<string, string>
): Promise<void> {
  const include = { order: { include: { scheduled_slot: true } } };
  let intent = await prisma.paymentIntent.findFirst({ where: { provider_ref }, include });

  // شبكة أمان: انقطع الاتصال بعد إنشاء العملية وقبل حفظ المرجع عندنا؟
  // البوابة تحمل order_id في بياناتها المرافقة — نتبنّى المرجع الآن.
  if (!intent && metadata?.order_id) {
    const byOrder = await prisma.paymentIntent.findUnique({
      where: { order_id: metadata.order_id },
      include
    });
    if (byOrder && !byOrder.provider_ref && byOrder.amount_halalas === amount_halalas) {
      await prisma.paymentIntent.update({ where: { id: byOrder.id }, data: { provider_ref } });
      intent = { ...byOrder, provider_ref };
    }
  }

  if (!intent) throw new AppError("ORDER-4001", { provider_ref });
  if (intent.amount_halalas !== amount_halalas) throw new AppError("PAY-5004");

  const order = intent.order;

  if (event_type === "payment.authorized" || event_type === "payment.captured") {
    const captured = event_type === "payment.captured";
    await prisma.$transaction(async (tx) => {
      // لا نتراجع بحالة النية: captured لا يعود authorized بحدث متأخر
      if (!(intent.status === "captured" && !captured)) {
        await tx.paymentIntent.update({
          where: { id: intent.id },
          data: { status: captured ? "captured" : "authorized" }
        });
      }

      // Ledger: قيد مزدوج — docs/13§4-6 (مفاتيح فريدة تمنع التكرار)
      const entries: Prisma.PaymentTransactionCreateManyInput[] = [
        {
          intent_id: intent.id,
          type: "authorization",
          debit_account: "customer_receivable",
          credit_account: "gateway_pending",
          amount_halalas,
          provider_ref,
          idempotency_key: `auth:${intent.idempotency_key}`
        }
      ];
      if (captured) {
        entries.push({
          intent_id: intent.id,
          type: "capture",
          debit_account: "gateway_pending",
          credit_account: "merchant_payable",
          amount_halalas,
          provider_ref,
          idempotency_key: `capture:${intent.idempotency_key}`
        });
      }
      // حصة محفظة بيكلي (خُصمت عند إنشاء الـintent) تدخل الـLedger عند التفويض
      if (intent.wallet_applied_halalas > 0) {
        entries.push({
          intent_id: intent.id,
          type: "wallet_redemption",
          debit_account: "customer_wallet",
          credit_account: "merchant_payable",
          amount_halalas: intent.wallet_applied_halalas,
          provider_ref,
          idempotency_key: `wallet:${intent.idempotency_key}`
        });
      }
      await tx.paymentTransaction.createMany({ data: entries, skipDuplicates: true });

      // PAYMENT_PENDING → AUTHORIZED → ORDER_SUBMITTED → MERCHANT_PENDING (معاملة واحدة)
      // الحدث المتأخر (capture بعد قبول الفرع) لا يعيد تشغيل المسار
      if (order.order_status === "PAYMENT_PENDING") {
        await proceedAfterAuthorization(tx, intent, order);
      }
    });
    return;
  }

  if (event_type === "payment.failed") {
    // فشل متأخر بعد أن مضى الطلب لا يُرجعه للخلف — نُسقط الحدث بأمان
    if (order.order_status !== "PAYMENT_PENDING") return;
    await prisma.$transaction(async (tx) => {
      await tx.paymentIntent.update({ where: { id: intent.id }, data: { status: "failed" } });
      // فشل البوابة يرد حصة المحفظة المحجوزة — قيد إيداع مقابل
      if (intent.wallet_applied_halalas > 0) {
        await tx.customerWalletEntry.create({
          data: {
            user_id: order.user_id,
            amount_halalas: intent.wallet_applied_halalas,
            entry_type: "credit",
            reference: `order:${order.display_code}:failed`
          }
        });
        await tx.paymentIntent.update({
          where: { id: intent.id },
          data: { wallet_applied_halalas: 0 }
        });
      }
      await transitionOrder(tx, order, "PAYMENT_FAILED", { actor_type: "system" });
      await emitEvent(tx, {
        name: "payment.failed",
        aggregate_type: "payment_intent",
        aggregate_id: intent.id,
        merchant_id: order.merchant_id,
        branch_id: order.branch_id,
        payload: { amount_halalas }
      });
    });
    return;
  }

  if (event_type === "payment.cancelled") {
    // تحرير الحجز — الاسترجاعات لها مسارها (worker/refund-processor)
    if (intent.status === "authorized" || intent.status === "requires_payment") {
      await prisma.paymentIntent.update({ where: { id: intent.id }, data: { status: "cancelled" } });
    }
  }
}
