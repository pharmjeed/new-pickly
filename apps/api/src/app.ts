import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { ZodError } from "zod";
import { buildError } from "@pickly/contracts";
import { isAppError } from "@pickly/observability";
import { authRoutes } from "./modules/auth/routes.js";
import { healthRoutes } from "./modules/health/routes.js";
import { featureFlagRoutes } from "./modules/feature-flags/routes.js";
import { catalogRoutes } from "./modules/catalog/routes.js";
import { cartRoutes } from "./modules/carts/routes.js";
import { orderRoutes } from "./modules/orders/routes.js";
import { pickupRoutes } from "./modules/pickup/routes.js";
import { merchantRoutes } from "./modules/merchant/routes.js";
import { merchantPortalRoutes } from "./modules/merchant/portal-routes.js";
import { paymentRoutes } from "./modules/payments/routes.js";
import { customerRoutes } from "./modules/customers/routes.js";
import { vehicleCatalogRoutes } from "./modules/vehicles/routes.js";
import { reviewRoutes } from "./modules/reviews/routes.js";
import { adminRoutes } from "./modules/admin/routes.js";
import { realtimeRoutes } from "./modules/realtime/routes.js";

export async function buildApp(): Promise<FastifyInstance> {
  const isDev = process.env.NODE_ENV !== "production";
  const app = Fastify({
    // صور الأصناف تُرسل data URL — نرفع الحد من 1MB الافتراضي (الإنتاج: رفع مباشر لObject Storage)
    bodyLimit: 3 * 1024 * 1024,
    logger: {
      level: process.env.LOG_LEVEL ?? (isDev ? "debug" : "info"),
      ...(isDev
        ? {
            transport: {
              target: "pino-pretty",
              options: { colorize: true, translateTime: "HH:MM:ss" }
            }
          }
        : {}),
      redact: {
        // لا أسرار في اللوج (docs/17)
        paths: ["req.headers.authorization", "*.code", "*.pin", "*.token"],
        censor: "[REDACTED]"
      }
    }
  });

  await app.register(cors, {
    origin: process.env.NODE_ENV === "production" ? [process.env.WEB_BASE_URL ?? ""] : true
  });

  // غلاف الخطأ الموحد {error: {code, message_ar, message_en}} — docs/11§0
  // التفصيل يُدمج في نص الرسالة نفسها حتى تعرضه كل الواجهات بلا تغيير فيها:
  // details.hint يلحق بالرسالة، وأخطاء Zod تُترجم بأسماء الحقول المخطئة.
  const zodIssueAr = (i: ZodError["issues"][number]): string => {
    const path = i.path.join(".") || "الطلب";
    // رسالة مخصصة بالعربية من المخطط نفسه (مثل صيغة الجوال) — تمر كما هي
    if (/[؀-ۿ]/.test(i.message)) return `«${path}»: ${i.message}`;
    switch (i.code) {
      case "invalid_type":
        return i.received === "undefined" ? `«${path}» مطلوب` : `«${path}» بنوع غير صحيح`;
      case "too_small":
        return i.type === "string"
          ? `«${path}» أقصر من الحد (${i.minimum} أحرف)`
          : `«${path}» أقل من الحد (${i.minimum})`;
      case "too_big":
        return i.type === "string"
          ? `«${path}» أطول من الحد (${i.maximum} حرفاً)`
          : `«${path}» أكبر من الحد (${i.maximum})`;
      case "invalid_string":
        return `«${path}» بصيغة غير صالحة`;
      case "invalid_enum_value":
        return `«${path}» قيمة غير مسموحة`;
      default:
        // رسائل refine/custom مكتوبة عربية أصلاً في هذا المشروع — تمر كما هي
        return i.message && i.message !== "Invalid input" ? `«${path}»: ${i.message}` : `«${path}» غير صالح`;
    }
  };

  app.setErrorHandler((err, req, reply) => {
    if (isAppError(err)) {
      const e = buildError(err.code, err.details);
      const hint = err.details?.hint;
      if (typeof hint === "string" && hint) {
        e.error.message_ar = `${e.error.message_ar} — ${hint}`;
        e.error.message_en = `${e.error.message_en} — ${hint}`;
      }
      return reply.status(e.status).send({ error: e.error });
    }
    if (err instanceof ZodError) {
      const e = buildError("SYS-9004", { issues: err.issues });
      const detailAr = err.issues.slice(0, 3).map(zodIssueAr).join(" · ");
      const detailEn = err.issues
        .slice(0, 3)
        .map((i) => `${i.path.join(".") || "body"}: ${i.message}`)
        .join(" · ");
      e.error.message_ar = `${e.error.message_ar}: ${detailAr}`;
      e.error.message_en = `${e.error.message_en}: ${detailEn}`;
      return reply.status(e.status).send({ error: e.error });
    }
    req.log.error({ err }, "unhandled error");
    const e = buildError("SYS-9001");
    return reply.status(e.status).send({ error: e.error });
  });

  app.setNotFoundHandler((_req, reply) => {
    const e = buildError("SYS-9004", { hint: "endpoint غير موجود — راجع docs/11" });
    return reply.status(404).send({ error: e.error });
  });

  await app.register(healthRoutes);
  await app.register(authRoutes, { prefix: "/v1/auth" });
  await app.register(featureFlagRoutes, { prefix: "/v1" });
  await app.register(catalogRoutes, { prefix: "/v1" });
  await app.register(customerRoutes, { prefix: "/v1/customers" });
  await app.register(vehicleCatalogRoutes, { prefix: "/v1" });
  await app.register(cartRoutes, { prefix: "/v1/carts" });
  await app.register(orderRoutes, { prefix: "/v1/orders" });
  await app.register(pickupRoutes, { prefix: "/v1/orders" });
  await app.register(reviewRoutes, { prefix: "/v1" });
  await app.register(merchantRoutes, { prefix: "/v1/merchant" });
  await app.register(merchantPortalRoutes, { prefix: "/v1/merchant" });
  await app.register(paymentRoutes, { prefix: "/v1" });
  await app.register(adminRoutes, { prefix: "/v1/admin" });
  await app.register(realtimeRoutes, { prefix: "/v1" });

  return app;
}
