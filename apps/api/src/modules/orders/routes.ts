import type { FastifyInstance } from "fastify";
import {
  CancelOrderBodySchema,
  ChangeResponseBodySchema,
  ConfirmPaymentBodySchema,
  CreateOrderBodySchema,
  CreatePaymentIntentBodySchema,
  RescheduleOrderBodySchema,
  UuidSchema
} from "@pickly/contracts";
import { idempotencyKeyOf, requireAuth, requireCustomer } from "../../lib/auth-plugin.js";
import { OrderService } from "./service.js";

/** docs/11§4 — الطلب والدفع (جانب العميل) */
export async function orderRoutes(app: FastifyInstance): Promise<void> {
  const service = new OrderService();
  app.addHook("preHandler", requireAuth);

  app.post("/", async (req) => {
    const claims = requireCustomer(req);
    const key = idempotencyKeyOf(req);
    const body = CreateOrderBodySchema.parse(req.body);
    return service.create(claims.sub, body, key);
  });

  app.get("/:id", async (req) => {
    const claims = requireCustomer(req);
    const id = UuidSchema.parse((req.params as { id: string }).id);
    return service.get(id, claims.sub);
  });

  app.post("/:id/payment-intent", async (req) => {
    const claims = requireCustomer(req);
    const key = idempotencyKeyOf(req);
    const id = UuidSchema.parse((req.params as { id: string }).id);
    const body = CreatePaymentIntentBodySchema.parse(req.body ?? {});
    return service.createPaymentIntent(id, claims.sub, key, body.method, body.use_wallet, body.card_id);
  });

  /**
   * تنفيذ الدفع لدى البوابة الحقيقية (ميسر) — خطوة ثانية بعد نية الدفع:
   * توكن البطاقة يصل من المتصفح (رقم البطاقة لا يمر علينا)، أو جوال STC Pay.
   * النتيجة قد تكون requires_action فيُحوَّل العميل لتحدي 3DS.
   */
  app.post("/:id/payment/confirm", async (req) => {
    const claims = requireCustomer(req);
    idempotencyKeyOf(req);
    const id = UuidSchema.parse((req.params as { id: string }).id);
    const body = ConfirmPaymentBodySchema.parse(req.body ?? {});
    return service.confirmPayment(id, claims.sub, body);
  });

  /** مزامنة حالة الدفع من البوابة — تستدعيها صفحة العودة بعد 3DS */
  app.post("/:id/payment/sync", async (req) => {
    const claims = requireCustomer(req);
    const id = UuidSchema.parse((req.params as { id: string }).id);
    return service.syncPayment(id, claims.sub);
  });

  /** تعديل فترة المجدول قبل مهلة التعديل المجاني — BR-5 */
  app.post("/:id/reschedule", async (req) => {
    const claims = requireCustomer(req);
    idempotencyKeyOf(req);
    const id = UuidSchema.parse((req.params as { id: string }).id);
    const body = RescheduleOrderBodySchema.parse(req.body);
    return service.reschedule(id, claims.sub, body.slot_id);
  });

  /** رد العميل على تعديل الفرع — BR-4 */
  app.post("/:id/change-response", async (req) => {
    const claims = requireCustomer(req);
    const id = UuidSchema.parse((req.params as { id: string }).id);
    const body = ChangeResponseBodySchema.parse(req.body);
    return service.respondToChange(id, claims.sub, body);
  });

  app.post("/:id/cancel", async (req) => {
    const claims = requireCustomer(req);
    idempotencyKeyOf(req);
    const id = UuidSchema.parse((req.params as { id: string }).id);
    const body = CancelOrderBodySchema.parse(req.body);
    return service.cancel(id, claims.sub, body.reason);
  });
}
