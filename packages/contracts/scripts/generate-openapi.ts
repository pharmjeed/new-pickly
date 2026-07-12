/**
 * توليد OpenAPI من مخططات Zod — docs/11 (REST /v1 موثق OpenAPI).
 * الناتج: packages/contracts/openapi.json — يُلتزم به في المستودع ويُحدَّث مع كل تغيير عقد.
 */
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  OpenAPIRegistry,
  OpenApiGeneratorV31,
  extendZodWithOpenApi
} from "@asteasolutions/zod-to-openapi";
import { z } from "zod";

extendZodWithOpenApi(z);

// ملاحظة: الاستيراد بعد extendZodWithOpenApi حتى تعمل .openapi() لو أُضيفت لاحقاً
const c = await import("../src/index.js");

const registry = new OpenAPIRegistry();

const bearer = registry.registerComponent("securitySchemes", "bearerAuth", {
  type: "http",
  scheme: "bearer",
  bearerFormat: "JWT"
});

const errorResponse = {
  description: "غلاف الخطأ الموحد",
  content: { "application/json": { schema: c.ErrorEnvelopeSchema } }
};

type RouteDef = {
  method: "get" | "post" | "patch" | "delete";
  path: string;
  summary: string;
  tags: string[];
  auth?: boolean;
  idempotent?: boolean;
  body?: z.ZodTypeAny;
  query?: z.ZodTypeAny;
  response?: z.ZodTypeAny;
};

const routes: RouteDef[] = [
  // §1 المصادقة
  { method: "post", path: "/v1/auth/otp/request", summary: "طلب رمز تحقق", tags: ["auth"], body: c.OtpRequestBodySchema, response: c.OtpRequestResponseSchema },
  { method: "post", path: "/v1/auth/otp/verify", summary: "التحقق من الرمز", tags: ["auth"], body: c.OtpVerifyBodySchema, response: c.TokenPairSchema },
  { method: "post", path: "/v1/auth/refresh", summary: "تجديد الجلسة", tags: ["auth"], body: c.RefreshBodySchema, response: c.TokenPairSchema },
  { method: "post", path: "/v1/auth/logout", summary: "تسجيل الخروج", tags: ["auth"], auth: true },
  { method: "post", path: "/v1/auth/branch/login", summary: "دخول فريق الفرع", tags: ["auth"], body: c.BranchLoginBodySchema, response: c.TokenPairSchema },
  // §2 الاكتشاف
  { method: "get", path: "/v1/branches/nearby", summary: "الفروع القريبة", tags: ["discovery"], query: c.NearbyQuerySchema, response: z.array(c.BranchCardSchema) },
  { method: "get", path: "/v1/branches/{id}/menu", summary: "منيو الفرع", tags: ["discovery"], response: c.MenuSchema },
  { method: "get", path: "/v1/search", summary: "بحث C-11 — مطاعم ومنتجات", tags: ["discovery"], query: c.SearchQuerySchema, response: c.SearchResponseSchema },
  { method: "get", path: "/v1/branches/{id}/slots", summary: "فترات BR-5 المتاحة بسعتها", tags: ["discovery"], response: z.array(c.CapacitySlotSchema) },
  { method: "get", path: "/v1/branches/{id}/parking-spots", summary: "مواقف الاستلام التي يخدمها الفرع", tags: ["discovery"], response: z.array(c.BranchParkingSpotSchema) },
  { method: "get", path: "/v1/content/banners", summary: "بانرات CMS (A-13)", tags: ["discovery"], response: z.array(c.ContentBannerSchema) },
  { method: "get", path: "/v1/content/categories", summary: "تصنيفات المطاعم C-09 (يديرها السوبر أدمن)", tags: ["discovery"], response: z.array(c.ContentCategorySchema) },
  { method: "get", path: "/v1/content/payment-methods", summary: "طرق الدفع الظاهرة للعميل (يديرها السوبر أدمن — payments.methods)", tags: ["discovery"], response: z.array(c.ContentPaymentMethodSchema) },
  // §3 السلة
  { method: "post", path: "/v1/carts", summary: "إنشاء سلة", tags: ["carts"], auth: true, body: c.CreateCartBodySchema, response: c.CartSchema },
  { method: "get", path: "/v1/carts/{id}", summary: "قراءة السلة", tags: ["carts"], auth: true, response: c.CartSchema },
  { method: "post", path: "/v1/carts/{id}/items", summary: "إضافة عنصر", tags: ["carts"], auth: true, body: c.CartItemInputSchema, response: c.CartSchema },
  { method: "post", path: "/v1/carts/{id}/coupon", summary: "تطبيق كوبون (BR-7 — التحقق والخصم خادميان)", tags: ["carts"], auth: true, body: c.ApplyCouponBodySchema, response: c.CartSchema },
  { method: "delete", path: "/v1/carts/{id}/coupon", summary: "إزالة الكوبون", tags: ["carts"], auth: true, response: c.CartSchema },
  { method: "post", path: "/v1/carts/{id}/quote", summary: "تسعير خادمي (المصدر الوحيد للسعر)", tags: ["carts"], auth: true, response: c.CartSchema },
  // §4 الطلب والدفع
  { method: "post", path: "/v1/orders", summary: "إنشاء طلب — pickup_time: asap|later|scheduled (+slot_id للمجدول)", tags: ["orders"], auth: true, idempotent: true, body: c.CreateOrderBodySchema, response: c.OrderSchema },
  { method: "get", path: "/v1/orders/{id}", summary: "قراءة طلب", tags: ["orders"], auth: true, response: c.OrderSchema },
  { method: "post", path: "/v1/orders/{id}/payment-intent", summary: "إنشاء Payment Intent (method: card|apple_pay|stc_pay + use_wallet لمحفظة بيكلي)", tags: ["orders"], auth: true, idempotent: true, body: c.CreatePaymentIntentBodySchema, response: c.PaymentIntentResponseSchema },
  { method: "post", path: "/v1/orders/{id}/reschedule", summary: "تعديل فترة المجدول قبل مهلة التعديل المجاني (BR-5)", tags: ["orders"], auth: true, idempotent: true, body: c.RescheduleOrderBodySchema, response: c.OrderSchema },
  { method: "post", path: "/v1/orders/{id}/cancel", summary: "طلب إلغاء", tags: ["orders"], auth: true, idempotent: true, body: c.CancelOrderBodySchema, response: c.OrderSchema },
  { method: "post", path: "/v1/orders/{id}/change-response", summary: "رد العميل على تعديل الفرع (BR-4)", tags: ["orders"], auth: true, body: c.ChangeResponseBodySchema, response: c.OrderSchema },
  // §5 الاستلام
  { method: "post", path: "/v1/orders/{id}/trip/start", summary: "أنا في الطريق", tags: ["pickup"], auth: true, response: c.PickupSessionSchema },
  { method: "post", path: "/v1/orders/{id}/trip/location", summary: "تحديث موقع", tags: ["pickup"], auth: true, body: c.TripLocationBodySchema },
  { method: "post", path: "/v1/orders/{id}/trip/stop", summary: "إيقاف الرحلة", tags: ["pickup"], auth: true },
  { method: "post", path: "/v1/orders/{id}/arrival", summary: "تأكيد «وصلت» اليدوي — الحصري للتحول ARRIVED", tags: ["pickup"], auth: true, response: c.OrderSchema },
  { method: "post", path: "/v1/orders/{id}/parking-spot", summary: "تحديد الموقف", tags: ["pickup"], auth: true, body: c.ParkingSpotBodySchema },
  { method: "post", path: "/v1/orders/{id}/handoff/confirm", summary: "تأكيد الاستلام من العميل", tags: ["pickup"], auth: true, body: c.HandoffConfirmBodySchema, response: c.OrderSchema },
  // §6 الفرع/التاجر
  { method: "get", path: "/v1/merchant/orders", summary: "طلبات الفرع", tags: ["merchant"], auth: true, query: c.MerchantOrdersQuerySchema, response: z.array(c.BranchOrderCardSchema) },
  { method: "post", path: "/v1/merchant/orders/{id}/accept", summary: "قبول الطلب", tags: ["merchant"], auth: true, idempotent: true, body: c.AcceptOrderBodySchema, response: c.BranchOrderCardSchema },
  { method: "post", path: "/v1/merchant/orders/{id}/reject", summary: "رفض الطلب", tags: ["merchant"], auth: true, idempotent: true, body: c.RejectOrderBodySchema, response: c.BranchOrderCardSchema },
  { method: "post", path: "/v1/merchant/orders/{id}/preparing", summary: "بدء التحضير", tags: ["merchant"], auth: true, response: c.BranchOrderCardSchema },
  { method: "post", path: "/v1/merchant/orders/{id}/ready", summary: "جاهز", tags: ["merchant"], auth: true, body: c.ReadyOrderBodySchema, response: c.BranchOrderCardSchema },
  { method: "post", path: "/v1/merchant/orders/{id}/handoff/start", summary: "خرج الموظف", tags: ["merchant"], auth: true, response: c.BranchOrderCardSchema },
  { method: "post", path: "/v1/merchant/orders/{id}/handoff/complete", summary: "تم التسليم مع التحقق", tags: ["merchant"], auth: true, body: c.HandoffCompleteBodySchema, response: c.BranchOrderCardSchema },
  { method: "post", path: "/v1/merchant/orders/{id}/item-issue", summary: "نقص منتج (BR-4)", tags: ["merchant"], auth: true, body: c.ItemIssueBodySchema },
  { method: "get", path: "/v1/merchant/arrival-queue", summary: "طابور الوصول", tags: ["merchant"], auth: true, response: z.array(c.ArrivalQueueEntrySchema) },
  { method: "post", path: "/v1/merchant/branches/{id}/busy-mode", summary: "وضع الازدحام (BR-10)", tags: ["merchant"], auth: true, body: c.BusyModeBodySchema },
  { method: "post", path: "/v1/merchant/branches/{id}/prep-minutes", summary: "متوسط وقت تجهيز الطلب — يُختم على كل طلب عند قبوله ويظهر للعميل", tags: ["merchant"], auth: true, body: z.object({ prep_minutes: z.number().int().min(1).max(120) }) },
  // §7 العميل — الإشعارات والدعم (مرحلة 2)
  { method: "get", path: "/v1/customers/me/wallet", summary: "محفظة بيكلي — الرصيد وآخر الحركات", tags: ["customers"], auth: true, response: c.CustomerWalletSchema },
  { method: "get", path: "/v1/customers/me/cards", summary: "بطاقاتي المحفوظة (Tokenization — لا PAN)", tags: ["customers"], auth: true, response: z.array(c.CustomerCardSchema) },
  { method: "post", path: "/v1/customers/me/cards", summary: "إضافة بطاقة جديدة — الرقم وCVV يمران للبوابة ولا يُخزنان", tags: ["customers"], auth: true, body: c.AddCardBodySchema, response: c.CustomerCardSchema },
  { method: "delete", path: "/v1/customers/me/cards/{id}", summary: "حذف بطاقة محفوظة", tags: ["customers"], auth: true },
  { method: "get", path: "/v1/customers/me/notifications", summary: "صندوق الإشعارات C-62", tags: ["customers"], auth: true, response: c.NotificationListResponseSchema },
  { method: "post", path: "/v1/customers/me/notifications/read", summary: "تعليم الكل مقروءاً", tags: ["customers"], auth: true },
  { method: "get", path: "/v1/customers/me/support-tickets", summary: "تذاكري", tags: ["support"], auth: true, response: z.array(c.SupportTicketSchema) },
  { method: "post", path: "/v1/customers/me/support-tickets", summary: "فتح تذكرة دعم C-65", tags: ["support"], auth: true, body: c.CreateTicketBodySchema, response: c.SupportTicketSchema },
  { method: "get", path: "/v1/customers/me/support-tickets/{id}", summary: "تذكرة برسائلها", tags: ["support"], auth: true, response: c.SupportTicketSchema },
  { method: "post", path: "/v1/customers/me/support-tickets/{id}/messages", summary: "رسالة على التذكرة", tags: ["support"], auth: true, body: c.CreateTicketMessageBodySchema, response: c.SupportTicketSchema },
  // §8 Webhooks
  { method: "post", path: "/v1/webhooks/payments/{provider}", summary: "Webhook دفع — توقيع إلزامي + تخزين خام + idempotent", tags: ["webhooks"] }
];

for (const r of routes) {
  registry.registerPath({
    method: r.method,
    path: r.path,
    summary: r.summary,
    tags: r.tags,
    ...(r.auth ? { security: [{ [bearer.name]: [] }] } : {}),
    request: {
      ...(r.query ? { query: r.query as never } : {}),
      ...(r.body
        ? { body: { content: { "application/json": { schema: r.body } } } }
        : {}),
      ...(r.idempotent
        ? {
            headers: z.object({
              "Idempotency-Key": z.string().min(8).max(128)
            }) as never
          }
        : {})
    },
    responses: {
      200: r.response
        ? { description: "OK", content: { "application/json": { schema: r.response } } }
        : { description: "OK" },
      400: errorResponse,
      401: errorResponse,
      409: errorResponse
    }
  });
}

const generator = new OpenApiGeneratorV31(registry.definitions);
const doc = generator.generateDocument({
  openapi: "3.1.0",
  info: {
    title: "Pickly API",
    version: "0.1.0",
    description: "REST /v1 — العقد المولد من packages/contracts (docs/11). لا endpoint خارج docs/11."
  },
  servers: [{ url: "http://localhost:4000" }]
});

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "openapi.json");
writeFileSync(out, JSON.stringify(doc, null, 2), "utf8");
console.warn(`openapi.json written: ${routes.length} paths`);
