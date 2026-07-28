import { timingSafeEqual } from "node:crypto";
import { createLogger } from "@pickly/observability";
import type {
  CardToken,
  ChargeInput,
  ChargeResult,
  CreateIntentInput,
  PaymentAdapter,
  ProviderIntent,
  ProviderIntentStatus,
  RemotePayment,
  TokenizeCardInput,
  WebhookVerification
} from "./index.js";

/**
 * محوّل ميسر (Moyasar) — بوابة سعودية: مدى/فيزا/ماستركارد وSTC Pay وApple Pay.
 *
 * الفرق الجوهري عن المحاكي: ميسر لا تُنشئ عملية عند «نية الدفع» بل عند تسليم
 * المصدر (توكن البطاقة أو جوال STC) — لذا `deferred_charge = true` والخادم
 * يستدعي `charge()` في خطوة ثانية ثم يحدّث provider_ref على النية.
 *
 * PCI: رقم البطاقة لا يمر على خوادمنا أبداً — الواجهة تُرمّزه مباشرة لدى ميسر
 * بالمفتاح القابل للنشر (pk_) وترسل لنا التوكن فقط (docs/13§4-1، docs/17).
 *
 * المراجع: https://docs.moyasar.com/api/payments/01-create-payment/ ·
 * https://docs.moyasar.com/guides/payment-operations/ ·
 * https://docs.moyasar.com/api/other/webhooks/webhook-reference/
 */

const logger = createLogger("payments:moyasar");

const API_BASE = process.env.MOYASAR_API_BASE ?? "https://api.moyasar.com/v1";

/** حالات ميسر → حالات النية عندنا */
function mapStatus(status: string): ProviderIntentStatus {
  switch (status) {
    case "initiated":
      return "processing";
    case "authorized":
    case "verified":
      return "authorized";
    case "paid":
    case "captured":
    case "refunded":
      return "captured";
    case "voided":
      return "cancelled";
    default:
      return "failed";
  }
}

/** شبكة البطاقة كما تسميها ميسر → تسميتنا */
function mapBrand(company: string | null | undefined): CardToken["brand"] {
  const c = (company ?? "").toLowerCase();
  if (c.includes("mada")) return "mada";
  if (c.includes("master")) return "mastercard";
  return "visa";
}

interface MoyasarSource {
  type?: string;
  company?: string | null;
  name?: string | null;
  number?: string | null;
  message?: string | null;
  transaction_url?: string | null;
  token?: string | null;
  reference_number?: string | null;
  month?: string | number | null;
  year?: string | number | null;
}

interface MoyasarPayment {
  id: string;
  status: string;
  amount: number;
  fee?: number;
  currency: string;
  description?: string | null;
  source?: MoyasarSource;
  metadata?: Record<string, string> | null;
}

interface MoyasarError {
  type?: string;
  message?: string;
  errors?: Record<string, string[]> | string | null;
}

/** رقم البطاقة المقنّع من ميسر («4111‑11XX‑XXXX‑1111») → آخر أربعة */
function last4Of(masked: string | null | undefined): string {
  const digits = (masked ?? "").replace(/\D/g, "");
  return digits.slice(-4) || "0000";
}

export class MoyasarPaymentAdapter implements PaymentAdapter {
  readonly provider = "moyasar";
  /** العملية تُنشأ عند تسليم المصدر لا عند إنشاء النية */
  readonly deferred_charge = true;

  private secretKey = process.env.PAYMENT_API_KEY ?? "";
  private publicKey = process.env.PAYMENT_PUBLISHABLE_KEY ?? "";
  private webhookSecret = process.env.PAYMENT_WEBHOOK_SECRET ?? "";
  /**
   * حجز ثم تحصيل (Auth/Capture) — النموذج المعتمد في docs/13§3.
   * بعض حسابات ميسر لا تُفعّله؛ عندها يُضبط PAYMENT_MANUAL_CAPTURE=false
   * فتصبح البوابة «تحصيل فقط» ويتحول الرفض إلى استرجاع آلي.
   */
  private manualCapture = process.env.PAYMENT_MANUAL_CAPTURE !== "false";

  constructor() {
    if (!this.secretKey.startsWith("sk_"))
      logger.warn("PAYMENT_API_KEY لا يبدأ بـsk_ — تأكد أنه المفتاح السري لميسر");
    if (!this.publicKey.startsWith("pk_"))
      logger.warn("PAYMENT_PUBLISHABLE_KEY لا يبدأ بـpk_ — الواجهة لن تستطيع ترميز البطاقة");
    if (!this.webhookSecret)
      logger.warn("PAYMENT_WEBHOOK_SECRET فارغ — ستُرفض كل webhooks ميسر");
  }

  /** المفتاح القابل للنشر — تحتاجه الواجهة لترميز البطاقة مباشرة لدى ميسر */
  publishableKey(): string | null {
    return this.publicKey || null;
  }

  /** الطرق التي يخدمها هذا الحساب فعلياً (Apple/Google Pay تحتاجان تهيئة لدى ميسر/Google) */
  supportedMethods(): Array<"card" | "apple_pay" | "stc_pay" | "google_pay"> {
    const methods: Array<"card" | "apple_pay" | "stc_pay" | "google_pay"> = ["card", "stc_pay"];
    if (process.env.MOYASAR_APPLE_PAY === "true") methods.push("apple_pay");
    if (process.env.MOYASAR_GOOGLE_PAY === "true") methods.push("google_pay");
    return methods;
  }

  private async call<T>(
    path: string,
    init: { method: "GET" | "POST"; body?: unknown }
  ): Promise<T> {
    const auth = Buffer.from(`${this.secretKey}:`).toString("base64");
    const res = await fetch(`${API_BASE}${path}`, {
      method: init.method,
      headers: {
        Authorization: `Basic ${auth}`,
        ...(init.body ? { "Content-Type": "application/json" } : {})
      },
      ...(init.body ? { body: JSON.stringify(init.body) } : {}),
      signal: AbortSignal.timeout(30_000)
    });
    const text = await res.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }
    if (!res.ok) {
      const err = (parsed ?? {}) as MoyasarError;
      const detail =
        typeof err.errors === "string"
          ? err.errors
          : err.errors
            ? Object.entries(err.errors)
                .map(([k, v]) => `${k}: ${(v as string[]).join(", ")}`)
                .join(" · ")
            : "";
      // لا نسجل الجسم خاماً — قد يحمل بيانات مصدر الدفع (docs/17)
      logger.error({ status: res.status, path, type: err.type }, "moyasar api error");
      throw new Error(`moyasar_${res.status}: ${err.message ?? "طلب مرفوض"}${detail ? ` — ${detail}` : ""}`);
    }
    return parsed as T;
  }

  /**
   * النية عند ميسر مؤجلة — لا نداء شبكة هنا؛ الصف يُنشأ محلياً بلا provider_ref
   * ويُملأ في `charge()`. الإرجاع يبقى مطابقاً للواجهة العامة.
   */
  async createIntent(input: CreateIntentInput): Promise<ProviderIntent> {
    return {
      provider_ref: "",
      client_secret: "",
      status: "requires_payment",
      supports_capture: this.manualCapture && input.method !== "stc_pay"
    };
  }

  /**
   * ترميز البطاقة يتم في المتصفح مباشرة لدى ميسر — لا نستقبل PAN على الخادم.
   * الرسالة تصل للعميل عبر مسار البطاقات (SYS-9004).
   */
  async tokenizeCard(_input: TokenizeCardInput): Promise<CardToken> {
    throw new Error("moyasar_client_tokenization_required");
  }

  /**
   * إنشاء العملية عند ميسر. النتيجة إما:
   * - `processing` + redirect_url: تحدي 3DS (بطاقة) أو رمز STC Pay — الواجهة تحوّل إليه
   * - `authorized` / `captured`: تمت مباشرة (نادر — بطاقة محفوظة بلا 3DS)
   * - `failed`: رفض البوابة برسالة مقروءة
   * القرار النهائي يبقى من webhook/sync لا من هذه النتيجة (docs/13§4-4).
   */
  async charge(input: ChargeInput): Promise<ChargeResult> {
    const manual = this.manualCapture && input.method !== "stc_pay";
    const source = this.buildSource(input, manual);

    const payment = await this.call<MoyasarPayment>("/payments", {
      method: "POST",
      body: {
        amount: input.amount_halalas,
        currency: input.currency,
        description: `Pickly ${input.order_ref}`,
        callback_url: input.callback_url,
        // given_id يجعل إعادة الإرسال لا تُنشئ عملية ثانية (Idempotency — docs/13§4-2)
        given_id: input.given_id,
        // manual مقبول أعلى الجسم وداخل المصدر — نرسله في الاثنين بنفس القيمة
        manual,
        metadata: {
          order_ref: input.order_ref,
          idempotency_key: input.idempotency_key,
          ...(input.metadata ?? {})
        },
        source
      }
    });

    return this.toChargeResult(payment, manual);
  }

  private buildSource(input: ChargeInput, manual: boolean): Record<string, unknown> {
    if (input.method === "stc_pay") {
      if (!input.mobile) throw new Error("moyasar_missing_mobile");
      return { type: "stcpay", mobile: input.mobile };
    }
    if (input.method === "apple_pay") {
      if (!input.apple_pay_token) throw new Error("moyasar_missing_applepay_token");
      return { type: "applepay", token: input.apple_pay_token, manual };
    }
    if (input.method === "google_pay") {
      if (!input.google_pay_token) throw new Error("moyasar_missing_googlepay_token");
      // token = paymentMethodData.tokenizationData.token كما تعيده مكتبة Google Pay
      return { type: "googlepay", token: input.google_pay_token, manual };
    }
    if (!input.card_token) throw new Error("moyasar_missing_card_token");
    return {
      type: "token",
      token: input.card_token,
      manual,
      // حفظ البطاقة للدفعات القادمة — التوكن العائد في source.token يصبح صالحاً للشحن
      ...(input.save_card ? { save_card: true } : {}),
      ...(input.cvc ? { cvc: input.cvc } : {})
    };
  }

  private toChargeResult(payment: MoyasarPayment, manual: boolean): ChargeResult {
    const status = mapStatus(payment.status);
    const src = payment.source ?? {};
    const savedToken = src.token ?? null;
    return {
      provider_ref: payment.id,
      status,
      supports_capture: manual,
      ...(src.transaction_url ? { redirect_url: src.transaction_url } : {}),
      ...(src.message ? { message: src.message } : {}),
      ...(savedToken
        ? {
            saved_card: {
              token: savedToken,
              brand: mapBrand(src.company),
              last4: last4Of(src.number),
              exp_month: Number(src.month) || 0,
              exp_year: Number(src.year) || 0,
              holder_name: src.name ?? null
            }
          }
        : {})
    };
  }

  /** قراءة الحالة من ميسر — شبكة أمان لصفحة العودة ولمهام التسوية */
  async fetchPayment(provider_ref: string): Promise<RemotePayment | null> {
    try {
      const payment = await this.call<MoyasarPayment>(`/payments/${provider_ref}`, { method: "GET" });
      const src = payment.source ?? {};
      return {
        provider_ref: payment.id,
        status: mapStatus(payment.status),
        amount_halalas: payment.amount,
        ...(src.message ? { message: src.message } : {}),
        ...(src.token
          ? {
              saved_card: {
                token: src.token,
                brand: mapBrand(src.company),
                last4: last4Of(src.number),
                exp_month: Number(src.month) || 0,
                exp_year: Number(src.year) || 0,
                holder_name: src.name ?? null
              }
            }
          : {})
      };
    } catch (err) {
      logger.error({ provider_ref, err: (err as Error).message }, "تعذّرت قراءة العملية من ميسر");
      return null;
    }
  }

  async capture(provider_ref: string, amount_halalas: number): Promise<{ ok: boolean }> {
    try {
      const res = await this.call<MoyasarPayment>(`/payments/${provider_ref}/capture`, {
        method: "POST",
        body: { amount: amount_halalas }
      });
      return { ok: res.status === "captured" || res.status === "paid" };
    } catch (err) {
      logger.error({ provider_ref, err: (err as Error).message }, "capture فشل");
      return { ok: false };
    }
  }

  /** تحرير الحجز — void يقبل authorized/paid/captured (الأخيرة ضمن ساعتين) */
  async cancelOrRelease(provider_ref: string): Promise<{ ok: boolean }> {
    try {
      const res = await this.call<MoyasarPayment>(`/payments/${provider_ref}/void`, { method: "POST" });
      return { ok: res.status === "voided" };
    } catch (err) {
      // خارج نافذة void: نسترجع بدلاً منه حتى لا يعلق مال العميل (docs/13§5)
      logger.warn({ provider_ref, err: (err as Error).message }, "void فشل — نحاول refund");
      try {
        const res = await this.call<MoyasarPayment>(`/payments/${provider_ref}/refund`, { method: "POST" });
        return { ok: res.status === "refunded" };
      } catch (err2) {
        logger.error({ provider_ref, err: (err2 as Error).message }, "refund الاحتياطي فشل");
        return { ok: false };
      }
    }
  }

  async refund(
    provider_ref: string,
    amount_halalas: number,
    idempotency_key: string
  ): Promise<{ ok: boolean; refund_ref: string }> {
    try {
      const res = await this.call<MoyasarPayment>(`/payments/${provider_ref}/refund`, {
        method: "POST",
        body: { amount: amount_halalas }
      });
      logger.info({ provider_ref, amount_halalas, idempotency_key }, "moyasar refund");
      return { ok: res.status === "refunded", refund_ref: res.id };
    } catch (err) {
      logger.error({ provider_ref, err: (err as Error).message }, "refund فشل");
      return { ok: false, refund_ref: "" };
    }
  }

  /**
   * ميسر لا ترسل توقيعاً في الترويسة — التحقق بمقارنة `secret_token` في الجسم
   * بالسر المضبوط في لوحة ميسر (webhook-reference). المقارنة ثابتة الزمن.
   */
  verifyWebhook(rawBody: string, _signature: string | undefined): WebhookVerification | null {
    if (!this.webhookSecret) return null;
    let body: {
      id?: string;
      type?: string;
      secret_token?: string;
      data?: {
        id?: string;
        amount?: number;
        currency?: string;
        status?: string;
        metadata?: Record<string, string> | null;
      };
    };
    try {
      body = JSON.parse(rawBody);
    } catch {
      return null;
    }

    const given = Buffer.from(body.secret_token ?? "");
    const expected = Buffer.from(this.webhookSecret);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

    const data = body.data ?? {};
    if (!data.id || typeof data.amount !== "number") return null;

    const event_type = this.mapEventType(body.type ?? "", data.status ?? "");
    if (!event_type) return null;

    return {
      valid: true,
      // ميسر تعيد إرسال نفس الحدث عند الفشل — id الحدث يمنع المعالجة المكررة
      event_ref: body.id ?? `${data.id}:${body.type}`,
      event_type,
      provider_ref: data.id,
      amount_halalas: data.amount,
      currency: data.currency ?? "SAR",
      ...(data.metadata ? { metadata: data.metadata } : {})
    };
  }

  /** أنواع أحداث ميسر → أحداثنا. `payment_faild` خطأ مطبعي في ميسر نفسها. */
  private mapEventType(type: string, status: string): string | null {
    switch (type) {
      case "payment_authorized":
        return "payment.authorized";
      case "payment_paid":
      case "payment_captured":
        return "payment.captured";
      case "payment_faild":
      case "payment_failed":
        return "payment.failed";
      case "payment_voided":
        return "payment.cancelled";
      case "payment_refunded":
        return "payment.refunded";
      default:
        // نوع غير معروف: نستنتج من حالة العملية بدل تجاهل الحدث
        if (status === "authorized") return "payment.authorized";
        if (status === "paid" || status === "captured") return "payment.captured";
        if (status === "failed") return "payment.failed";
        return null;
    }
  }
}
