import type { FastifyInstance } from "fastify";
import { prisma, type Prisma } from "@pickly/database";
import { AppError } from "@pickly/observability";
import { MockPaymentAdapter } from "@pickly/payments";
import { applyPaymentEvent } from "../../lib/payment-events.js";
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
    // المحاكي يوقّع بترويسة؛ ميسر تضع السر داخل الجسم (secret_token) — المحوّل يعرف أيهما
    const signature = req.headers["x-pickly-signature"] as string | undefined;

    const verified = payments.verifyWebhook(raw, signature);
    if (!verified) throw new AppError("PAY-5003");

    // تخزين خام + idempotent — التكرار يعيد 200 دون معالجة
    const existing = await prisma.paymentWebhookEvent.findUnique({
      where: { provider_event_ref: { provider, event_ref: verified.event_ref } }
    });
    if (existing) return reply.status(200).send({ received: true, duplicate: true });

    // السر لا يُخزن: ميسر تضعه في الجسم — نُسقطه قبل الحفظ الخام (docs/17)
    const { secret_token: _secret, ...payload } = JSON.parse(raw) as Prisma.JsonObject;
    void _secret;

    const stored = await prisma.paymentWebhookEvent.create({
      data: {
        provider,
        event_ref: verified.event_ref,
        signature: signature ?? null,
        payload
      }
    });

    try {
      await applyPaymentEvent(
        verified.event_type,
        verified.provider_ref,
        verified.amount_halalas,
        verified.metadata
      );
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
