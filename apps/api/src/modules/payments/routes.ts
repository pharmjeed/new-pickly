import type { FastifyInstance } from "fastify";
import { prisma } from "@pickly/database";
import { AppError } from "@pickly/observability";
import { MockPaymentAdapter } from "@pickly/payments";
import { emitEvent, scheduleJob } from "../../lib/events.js";
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

      // PAYMENT_PENDING → AUTHORIZED → ORDER_SUBMITTED → MERCHANT_PENDING (معاملة واحدة)
      await transitionOrder(tx, order, "PAYMENT_AUTHORIZED", { actor_type: "system" });
      await transitionOrder(
        tx,
        { ...order, order_status: "PAYMENT_AUTHORIZED" },
        "ORDER_SUBMITTED",
        { actor_type: "system" }
      );
      await emitEvent(tx, {
        name: "payment.authorized",
        aggregate_type: "payment_intent",
        aggregate_id: intent.id,
        merchant_id: order.merchant_id,
        branch_id: order.branch_id,
        payload: { amount_halalas }
      });

      // BR-5: المجدول المدفوع ينتظر عند ORDER_SUBMITTED — دخول الفترة يحوّله لمسار ASAP
      const slot = order.scheduled_slot;
      if (order.pickup_time === "scheduled" && slot && slot.slot_start > new Date()) {
        await scheduleJob(
          tx,
          "scheduled_slot_entry",
          { order_id: order.id },
          slot.slot_start,
          `slot_entry:${order.id}:${slot.slot_start.getTime()}`
        );
        // تذكير «حان وقت التوجه» قبل الفترة (J3 — docs/03)
        const remindAt = new Date(slot.slot_start.getTime() - 15 * 60_000);
        if (remindAt > new Date()) {
          await scheduleJob(
            tx,
            "scheduled_reminder",
            { order_id: order.id },
            remindAt,
            `scheduled_reminder:${order.id}:${slot.slot_start.getTime()}`
          );
        }
        return;
      }

      // عداد قبول الفرع — BR-1
      const settings = await tx.branchPickupSettings.findUnique({
        where: { branch_id: order.branch_id }
      });
      const windowSec = settings?.accept_window_seconds ?? 180;
      const deadline = new Date(Date.now() + windowSec * 1000);
      await transitionOrder(
        tx,
        { ...order, order_status: "ORDER_SUBMITTED" },
        "MERCHANT_PENDING",
        { actor_type: "system" },
        { data: { accept_deadline_at: deadline } }
      );
      await scheduleJob(
        tx,
        "accept_timeout",
        { order_id: order.id },
        deadline,
        `accept_timeout:${order.id}`
      );
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
