import type { FastifyInstance } from "fastify";
import { prisma } from "@pickly/database";
import { AppError } from "@pickly/observability";
import { MockPaymentAdapter } from "@pickly/payments";
import { emitEvent } from "../../lib/events.js";
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
        done(null, { raw: body as string, parsed: JSON.parse(body as string) });
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

/**
 * مطابقة المبلغ والعملة والطلب قبل أي تحويل حالة — docs/13§4-5.
 * الدفع بعد القبول (docs/05§3): نجاح الدفع هو «لحظة الصفر» —
 * PAYMENT_PENDING → AUTHORIZED → PREPARING، وعداد دقائق التجهيز يبدأ من الآن.
 */
async function handlePaymentEvent(
  event_type: string,
  provider_ref: string,
  amount_halalas: number
): Promise<void> {
  const intent = await prisma.paymentIntent.findFirst({
    where: { provider_ref },
    include: { order: true }
  });
  if (!intent) throw new AppError("ORDER-4001", { provider_ref });
  if (intent.amount_halalas !== amount_halalas) throw new AppError("PAY-5004");

  const order = intent.order;

  if (event_type === "payment.authorized") {
    // سباق نادر: المهلة أنهت الطلب قبل وصول الـwebhook — لا نبدأ تحضيراً؛ نسجل استرجاعاً معلقاً
    if (order.order_status === "EXPIRED") {
      await prisma.$transaction(async (tx) => {
        await tx.paymentIntent.update({ where: { id: intent.id }, data: { status: "authorized" } });
        await tx.refund.upsert({
          where: { idempotency_key: `expired_paid:${order.id}` },
          create: {
            order_id: order.id,
            intent_id: intent.id,
            amount_halalas,
            includes_service_fee: true,
            reason: "paid_after_expiry",
            status: "pending",
            requested_by: "system",
            idempotency_key: `expired_paid:${order.id}`
          },
          update: {}
        });
      });
      return;
    }

    // Capture فوري — الفرع قَبِل مسبقاً (docs/13§3)؛ نداء شبكة خارج المعاملة
    let captured = false;
    if (intent.supports_capture) {
      captured = (await payments.capture(provider_ref, amount_halalas)).ok;
    }

    await prisma.$transaction(async (tx) => {
      await tx.paymentIntent.update({
        where: { id: intent.id },
        data: { status: captured ? "captured" : "authorized" }
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
      if (captured) {
        await tx.paymentTransaction.create({
          data: {
            intent_id: intent.id,
            type: "capture",
            debit_account: "gateway_pending",
            credit_account: "merchant_payable",
            amount_halalas,
            provider_ref
          }
        });
      }

      // لحظة الصفر: PAYMENT_PENDING → AUTHORIZED → PREPARING (معاملة واحدة)
      // preparing_at = لحظة الدفع — منها يُحسب عداد دقائق التجهيز المتفق عليها
      await transitionOrder(tx, order, "PAYMENT_AUTHORIZED", { actor_type: "system" });
      await transitionOrder(
        tx,
        { ...order, order_status: "PAYMENT_AUTHORIZED" },
        "PREPARING",
        { actor_type: "system" },
        { data: { preparing_at: new Date() }, payload: { paid: true, prep_minutes: order.prep_minutes } }
      );
      await emitEvent(tx, {
        name: "payment.authorized",
        aggregate_type: "payment_intent",
        aggregate_id: intent.id,
        merchant_id: order.merchant_id,
        branch_id: order.branch_id,
        payload: { amount_halalas }
      });
    });
  } else if (event_type === "payment.failed") {
    await prisma.$transaction(async (tx) => {
      await tx.paymentIntent.update({ where: { id: intent.id }, data: { status: "failed" } });
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
