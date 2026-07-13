import { z } from "zod";

/**
 * غلاف الخطأ الموحد — docs/11§0.
 * كل كود برسالتين ar/en — docs/11§10.
 */
export const ErrorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string(),
    message_ar: z.string(),
    message_en: z.string(),
    details: z.record(z.unknown()).optional()
  })
});
export type ErrorEnvelope = z.infer<typeof ErrorEnvelopeSchema>;

/**
 * أكواد الأخطاء — النطاقات من docs/11§10.
 * AUTH-1xxx · CATALOG-2xxx · CART-3xxx · ORDER-4xxx · PAY-5xxx ·
 * PICKUP-6xxx · MERCHANT-7xxx · ADMIN-8xxx · SYS-9xxx
 * القائمة تُوسَّع هنا حصراً — هذا الملف جزء من العقد.
 */
export const ERROR_CODES = {
  // AUTH-1xxx
  "AUTH-1001": { ar: "رقم الجوال غير صالح", en: "Invalid phone number", status: 400 },
  "AUTH-1002": { ar: "رمز التحقق غير صحيح", en: "Incorrect OTP code", status: 400 },
  "AUTH-1003": { ar: "انتهت صلاحية رمز التحقق — اطلب رمزاً جديداً", en: "OTP expired — request a new code", status: 400 },
  "AUTH-1004": { ar: "محاولات كثيرة — جرّب بعد قليل", en: "Too many attempts — try again later", status: 429 },
  "AUTH-1005": { ar: "الجلسة منتهية — سجّل دخولك من جديد", en: "Session expired — sign in again", status: 401 },
  "AUTH-1006": { ar: "لا تملك صلاحية هذا الإجراء", en: "You do not have permission for this action", status: 403 },
  "AUTH-1007": { ar: "الحساب موقوف — تواصل مع الدعم", en: "Account suspended — contact support", status: 403 },
  "AUTH-1008": { ar: "كود الفرع أو الرمز السري غير صحيح", en: "Invalid branch code or PIN", status: 400 },

  // CATALOG-2xxx
  "CATALOG-2001": { ar: "المطعم غير موجود", en: "Restaurant not found", status: 404 },
  "CATALOG-2002": { ar: "الفرع مغلق حالياً", en: "Branch is currently closed", status: 409 },
  "CATALOG-2003": { ar: "المنتج غير متوفر في هذا الفرع", en: "Product unavailable at this branch", status: 409 },
  "CATALOG-2004": { ar: "الفرع متوقف عن استقبال الطلبات مؤقتاً", en: "Branch is temporarily not accepting orders", status: 409 },

  // CART-3xxx
  "CART-3001": { ar: "السلة غير موجودة", en: "Cart not found", status: 404 },
  "CART-3002": { ar: "تغيّر توفر بعض المنتجات — راجع سلتك", en: "Some items changed availability — review your cart", status: 409 },
  "CART-3003": { ar: "الكوبون غير صالح", en: "Invalid coupon", status: 400 },
  "CART-3004": { ar: "انتهت صلاحية التسعيرة — أعد التسعير", en: "Quote expired — request a new quote", status: 409 },
  "CART-3005": { ar: "الطلب أقل من الحد الأدنى للفرع", en: "Order is below branch minimum", status: 400 },

  // ORDER-4xxx
  "ORDER-4001": { ar: "الطلب غير موجود", en: "Order not found", status: 404 },
  "ORDER-4002": { ar: "انتقال حالة غير مسموح", en: "Illegal state transition", status: 409 },
  "ORDER-4003": { ar: "لا يمكن إلغاء الطلب في حالته الحالية", en: "Order cannot be cancelled in its current state", status: 409 },
  "ORDER-4004": { ar: "مهلة رد الفرع انتهت", en: "Merchant response window elapsed", status: 409 },
  "ORDER-4005": { ar: "الطلب بانتظار ردك على تعديل الفرع", en: "Order awaits your response to a merchant change", status: 409 },
  "ORDER-4006": { ar: "الفترة المختارة ممتلئة أو غير متاحة — اختر فترة أخرى", en: "Selected slot is full or unavailable — pick another", status: 409 },
  "ORDER-4007": { ar: "الجدولة غير متاحة لهذا الفرع حالياً", en: "Scheduling is not available for this branch", status: 409 },
  "ORDER-4008": { ar: "انتهت مهلة التعديل المجاني لهذا الطلب المجدول", en: "Free-change window for this scheduled order has passed", status: 409 },
  "ORDER-4009": { ar: "بانتظار موافقة العميل على وقت التجهيز المتوقع", en: "Awaiting customer confirmation of the expected prep time", status: 409 },

  // PAY-5xxx
  "PAY-5001": { ar: "ما تمّ الدفع. جرّب بطاقة ثانية — طلبك محفوظ", en: "Payment failed. Try another card — your order is saved", status: 402 },
  "PAY-5002": { ar: "مفتاح Idempotency مفقود", en: "Missing Idempotency-Key", status: 400 },
  "PAY-5003": { ar: "توقيع Webhook غير صالح", en: "Invalid webhook signature", status: 401 },
  "PAY-5004": { ar: "مبلغ غير مطابق", en: "Amount mismatch", status: 409 },
  "PAY-5005": { ar: "استرجاع مكرر على نفس العناصر", en: "Duplicate refund on the same items", status: 409 },
  "PAY-5006": { ar: "تجاوز سقف الاسترجاع المسموح", en: "Refund exceeds allowed ceiling", status: 403 },

  // PICKUP-6xxx
  "PICKUP-6001": { ar: "لا توجد رحلة استلام نشطة", en: "No active pickup session", status: 409 },
  "PICKUP-6002": { ar: "ما قدرنا نحدد موقعك — اضغط «وصلت» ونكمل عادي", en: "Could not detect your location — tap “I arrived” and we continue", status: 200 },
  "PICKUP-6003": { ar: "رمز التسليم غير صحيح", en: "Incorrect handoff code", status: 400 },
  "PICKUP-6004": { ar: "الطلبات بقيمة عالية تتطلب تأكيداً مزدوجاً", en: "High-value orders require dual confirmation", status: 409 },
  "PICKUP-6005": { ar: "لا يمكن بدء التسليم قبل جاهزية الطلب", en: "Handoff cannot start before the order is ready", status: 409 },

  // MERCHANT-7xxx
  "MERCHANT-7001": { ar: "الطلب لم يعد بانتظار القبول", en: "Order is no longer pending acceptance", status: 409 },
  "MERCHANT-7002": { ar: "سبب الرفض مطلوب من القائمة", en: "Rejection reason required from the closed list", status: 400 },
  "MERCHANT-7003": { ar: "خارج نطاق فرعك", en: "Outside your branch scope", status: 403 },
  "MERCHANT-7004": { ar: "تعديل الطلب يتطلب موافقة العميل", en: "Order change requires customer approval", status: 409 },
  "MERCHANT-7005": { ar: "سعر العرض يجب أن يكون أقل من سعر الصنف", en: "Offer price must be lower than the item price", status: 400 },

  // ADMIN-8xxx
  "ADMIN-8001": { ar: "تجاوز العزل يتطلب سبباً موثقاً", en: "Tenant-scope override requires a documented reason", status: 400 },

  // SYS-9xxx
  "SYS-9001": { ar: "خطأ غير متوقع — فريقنا أُبلغ", en: "Unexpected error — our team was notified", status: 500 },
  "SYS-9002": { ar: "الخدمة مشغولة — أعد المحاولة", en: "Service busy — please retry", status: 503 },
  "SYS-9003": { ar: "طلبات كثيرة — تمهّل قليلاً", en: "Too many requests — slow down", status: 429 },
  "SYS-9004": { ar: "مدخلات غير صالحة", en: "Invalid input", status: 400 }
} as const satisfies Record<string, { ar: string; en: string; status: number }>;

export type ErrorCode = keyof typeof ERROR_CODES;

export function buildError(code: ErrorCode, details?: Record<string, unknown>): ErrorEnvelope & { status: number } {
  const def = ERROR_CODES[code];
  return {
    status: def.status,
    error: {
      code,
      message_ar: def.ar,
      message_en: def.en,
      ...(details ? { details } : {})
    }
  };
}
