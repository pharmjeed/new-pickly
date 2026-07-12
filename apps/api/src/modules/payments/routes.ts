import type { FastifyInstance } from "fastify";
import { prisma } from "@pickly/database";
import { AppError } from "@pickly/observability";
import { MockPaymentAdapter } from "@pickly/payments";
import { emitEvent } from "../../lib/events.js";
import { proceedAfterAuthorization } from "../../lib/payment-flow.js";
import { transitionOrder } from "../../lib/state-machine.js";
import { payments } from "../orders/service.js";

/**
 * وحدة Payments (نطاق الشريحة) — docs/13§4:
 * webhook موقع يُتحقق إلزامياً، يُخزن خاماً، idempotent،
 * الحالة النهائية من الخادم/webhook لا من التطبيق.
 */
export async function paymentRoutes(app: FastifyInstance): Promise<void> {
  // نحتاج الجسم الخام للتحقق من التوقيع
  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (_req, body, done) => {
      try {
        const raw = body as string;
        // جسم فارغ بترويسة JSON (زر الدفع بلا حمولة) لا يُسقط الطلب بـ500
        done(null, { raw, parsed: raw ? JSON.parse(raw) : {} });
      } catch (e) {
        done(e as Error);
      }
    }
  );

  app.post("/webhooks/payments/:provider", async (req, reply) => {
    const provider = (req.params as { provider: string }).provider;
    if (provider !== payments.provider) throw new AppError("PAY-5003", { provider });

    const { raw } = req.body as { raw: string };
    const signature = req.headers["x-pickly-signature"] as string | undefined;

    const verified = payments.verifyWebhook(raw, signature);
    if (!verified) throw new AppError("PAY-5003");

    // تخزين خام + idempotent — التكرار يعيد 200 دون معالجة
    const existing = await prisma.paymentWebhookEvent.findUnique({
      where: { provider_event_ref: { provider, event_ref: verified.event_ref } }
    });
    if (existing) return reply.status(200).send({ received: true, duplicate: true });

    const stored = await prisma.paymentWebhookEvent.create({
      data: {
        provider,
        event_ref: verified.event_ref,
        signature: signature ?? null,
        payload: JSON.parse(raw)
      }
    });

    try {
      await handlePaymentEvent(verified.event_type, verified.provider_ref, verified.amount_halalas);
      await prisma.paymentWebhookEvent.update({
        where: { id: stored.id },
        data: { processed_at: new Date() }
      });
    } catch (err) {
      await prisma.paymentWebhookEvent.update({
        where: { id: stored.id },
        data: { process_error: err instanceof Error ? err.message : String(err) }
      });
      throw err;
    }
    return reply.status(200).send({ received: true });
  });

  // ===== بوابة sandbox تطويرية — تحاكي إتمام العميل للدفع (3DS) =====
  // نفس مسار الإنتاج تماماً: النتيجة تصل عبر webhook موقع.
  if (process.env.NODE_ENV !== "production" && payments instanceof MockPaymentAdapter) {
    const mock: MockPaymentAdapter = payments;

    const confirmAndWebhook = async (provider_ref: string, amount_halalas: number) => {
      const result = await mock.confirmPayment(provider_ref);
      const { body, signature } = mock.buildWebhookPayload(
        result === "authorized" ? "payment.authorized" : "payment.failed",
        provider_ref,
        amount_halalas
      );
      const res = await app.inject({
        method: "POST",
        url: "/v1/webhooks/payments/mock",
        headers: { "content-type": "application/json", "x-pickly-signature": signature },
        payload: body
      });
      return { gateway_result: result, webhook_status: res.statusCode };
    };

    app.post("/dev/mock-gateway/:providerRef/pay", async (req) => {
      const provider_ref = (req.params as { providerRef: string }).providerRef;
      const intent = await prisma.paymentIntent.findFirst({ where: { provider_ref } });
      if (!intent) throw new AppError("ORDER-4001");
      return confirmAndWebhook(provider_ref, intent.amount_halalas);
    });

    /** صيغة الواجهات: الدفع بمعرف الطلب — لا تكشف provider_ref للعميل */
    app.post("/dev/mock-gateway/by-order/:orderId/pay", async (req) => {
      const order_id = (req.params as { orderId: string }).orderId;
      const intent = await prisma.paymentIntent.findUnique({ where: { order_id } });
      if (!intent?.provider_ref) throw new AppError("ORDER-4001");
      return confirmAndWebhook(intent.provider_ref, intent.amount_halalas);
    });
  }
}

/** مطابقة المبلغ والعملة والطلب قبل أي تحويل حالة — docs/13§4-5 */
async function handlePaymentEvent(
  event_type: string,
  provider_ref: string,
  amount_halalas: number
): Promise<void> {
  const intent = await prisma.paymentIntent.findFirst({
    where: { provider_ref },
    include: { order: { include: { scheduled_slot: true } } }
  });
  if (!intent) throw new AppError("ORDER-4001", { provider_ref });
  if (intent.amount_halalas !== amount_halalas) throw new AppError("PAY-5004");

  const order = intent.order;

  if (event_type === "payment.authorized") {
    await prisma.$transaction(async (tx) => {
      await tx.paymentIntent.update({
        where: { id: intent.id },
        data: { status: "authorized" }
      });
      // Ledger: قيد مزدوج — docs/13§4-6
      await tx.paymentTransaction.create({
        data: {
          intent_id: intent.id,
          type: "authorization",
          debit_account: "customer_receivable",
          credit_account: "gateway_pending",
          amount_halalas,
          provider_ref
        }
      });
      // حصة محفظة بيكلي (خُصمت عند إنشاء الـintent) تدخل الـLedger عند التفويض
      if (intent.wallet_applied_halalas > 0) {
        await tx.paymentTransaction.create({
          data: {
            intent_id: intent.id,
            type: "wallet_redemption",
            debit_account: "customer_wallet",
            credit_account: "merchant_payable",
            amount_halalas: intent.wallet_applied_halalas,
            idempotency_key: `wallet:${intent.idempotency_key}`
          }
        });
      }

      // PAYMENT_PENDING → AUTHORIZED → ORDER_SUBMITTED → MERCHANT_PENDING (معاملة واحدة)
      await proceedAfterAuthorization(tx, intent, order);
    });
  } else if (event_type === "payment.failed") {
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
  }
}
