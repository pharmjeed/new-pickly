import { z } from "zod";
import { CardBrandSchema } from "./cards.js";

/**
 * تنفيذ الدفع لدى بوابة حقيقية (ميسر) — خطوة ثانية بعد نية الدفع (docs/13§3).
 * البوابة تُنشئ العملية لحظة تسليم المصدر: توكن بطاقة مُرمَّز في المتصفح،
 * أو جوال STC Pay. رقم البطاقة لا يمر على خوادمنا أبداً (docs/13§4-1).
 */

/** GET /v1/content/payment-config — ما تحتاجه الواجهة لتتعامل مع البوابة */
export const PaymentConfigSchema = z.object({
  provider: z.string(),
  /** ترميز البطاقة يتم في المتصفح مباشرة لدى البوابة */
  client_tokenization: z.boolean(),
  /** المفتاح القابل للنشر (pk_) — علني بطبيعته، لا يُتيح أي عملية سرية */
  publishable_key: z.string().nullable(),
  /** الطرق التي يخدمها حساب البوابة فعلياً — الواجهة تخفي ما عداها */
  supported_methods: z.array(z.enum(["card", "apple_pay", "stc_pay", "google_pay"])),
  /** معرّف تاجر Google Pay (من Google Business Console) — لازم لوضع الإنتاج فقط */
  google_pay_merchant_id: z.string().nullable().optional()
});
export type PaymentConfig = z.infer<typeof PaymentConfigSchema>;

/** POST /v1/orders/:id/payment/confirm */
export const ConfirmPaymentBodySchema = z
  .object({
    /** توكن بطاقة من البوابة (token_...) — بطاقة جديدة رُمّزت في المتصفح */
    card_token: z.string().min(6).max(120).optional(),
    /** بطاقة محفوظة — الخادم يستخرج توكنها بعد التحقق من الملكية */
    card_id: z.string().uuid().optional(),
    /** جوال محفظة STC Pay (05xxxxxxxx) */
    mobile: z
      .string()
      .transform((s) => s.replace(/[\s-]/g, ""))
      .refine((s) => /^05\d{8}$/.test(s), "جوال STC Pay بصيغة 05xxxxxxxx")
      .optional(),
    /** توكن Apple Pay من Apple Pay JS */
    apple_pay_token: z.string().min(10).optional(),
    /** توكن Google Pay — paymentMethodData.tokenizationData.token كما تعيده مكتبة Google Pay */
    google_pay_token: z.string().min(10).optional(),
    /** «حفظ كطريقة الدفع الأساسية» — البطاقة تُحفظ بعد نجاح الدفع */
    save_card: z.boolean().default(false),
    /**
     * الطريقة عند إعادة المحاولة بعد رفض البنك — العميل قد يبدّل من بطاقة
     * إلى STC Pay مثلاً؛ تُحدَّث على النية نفسها بلا طلب جديد.
     */
    method: z.enum(["card", "apple_pay", "stc_pay", "google_pay"]).optional()
  })
  .refine((b) => b.card_token || b.card_id || b.mobile || b.apple_pay_token || b.google_pay_token, {
    message: "مصدر الدفع مطلوب"
  });
export type ConfirmPaymentBody = z.infer<typeof ConfirmPaymentBodySchema>;

export const ConfirmPaymentResponseSchema = z.object({
  /**
   * requires_action: تحويل العميل إلى redirect_url (3DS أو رمز STC)
   * authorized/captured: تم — الطلب انتقل للفرع
   * failed: رُفض برسالة مقروءة
   */
  status: z.enum(["requires_action", "authorized", "captured", "failed"]),
  redirect_url: z.string().url().nullable(),
  message: z.string().nullable()
});
export type ConfirmPaymentResponse = z.infer<typeof ConfirmPaymentResponseSchema>;

/** POST /v1/orders/:id/payment/sync — مزامنة الحالة من البوابة بعد العودة */
export const SyncPaymentResponseSchema = z.object({
  status: z.enum(["requires_payment", "processing", "authorized", "captured", "failed", "cancelled"]),
  message: z.string().nullable()
});
export type SyncPaymentResponse = z.infer<typeof SyncPaymentResponseSchema>;

/** بطاقة محفوظة عائدة من البوابة بعد دفعة ناجحة — للعرض فقط */
export const ChargeSavedCardSchema = z.object({
  token: z.string(),
  brand: CardBrandSchema,
  last4: z.string(),
  exp_month: z.number().int(),
  exp_year: z.number().int()
});
export type ChargeSavedCard = z.infer<typeof ChargeSavedCardSchema>;
