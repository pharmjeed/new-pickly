import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { createLogger } from "@pickly/observability";

/**
 * بوابة الدفع خلف Adapter — docs/13 + قاعدة الاستقلالية.
 * النموذج المالي: (ب) Marketplace/Split (docs/13§1 — قرار D2).
 * mock: بوابة sandbox داخلية تدعم Auth/Capture/Refund وتبث Webhooks موقعة
 * إلى /v1/webhooks/payments/mock — نفس مسار الإنتاج تماماً.
 */

export type ProviderIntentStatus =
  | "requires_payment"
  | "processing"
  | "authorized"
  | "captured"
  | "failed"
  | "cancelled";

export interface CreateIntentInput {
  amount_halalas: number;
  currency: "SAR";
  order_ref: string;
  idempotency_key: string;
  /** وسيلة الدفع: card | apple_pay | stc_pay ("wallet" القديمة C-33 للتوافق) — docs/13§2 */
  method?: "card" | "apple_pay" | "stc_pay" | "wallet";
  /** token بطاقة محفوظة — الدفع بها دون لمس رقم البطاقة */
  card_token?: string;
}

export interface ProviderIntent {
  provider_ref: string;
  client_secret: string;
  status: ProviderIntentStatus;
  supports_capture: boolean;
}

export interface WebhookVerification {
  valid: boolean;
  event_ref: string;
  event_type: string; // payment.authorized | payment.captured | payment.failed | refund.completed
  provider_ref: string;
  amount_halalas: number;
  currency: string;
}

/** بيانات البطاقة تمر للبوابة فقط — لا تُخزن ولا تُسجل (docs/17) */
export interface TokenizeCardInput {
  card_number: string;
  exp_month: number;
  exp_year: number;
  cvv: string;
  holder_name?: string;
}

export interface CardToken {
  token: string;
  brand: "mada" | "visa" | "mastercard";
  last4: string;
}

export interface PaymentAdapter {
  readonly provider: string;
  createIntent(input: CreateIntentInput): Promise<ProviderIntent>;
  /** حفظ بطاقة كـtoken عند البوابة — Tokenization فقط، لا تخزين PAN/CVV */
  tokenizeCard(input: TokenizeCardInput): Promise<CardToken>;
  capture(provider_ref: string, amount_halalas: number): Promise<{ ok: boolean }>;
  cancelOrRelease(provider_ref: string): Promise<{ ok: boolean }>;
  refund(provider_ref: string, amount_halalas: number, idempotency_key: string): Promise<{ ok: boolean; refund_ref: string }>;
  /** التحقق من توقيع webhook — إلزامي (docs/13§4-3) */
  verifyWebhook(rawBody: string, signature: string | undefined): WebhookVerification | null;
}

const logger = createLogger("payments");

/**
 * MockPaymentAdapter — sandbox داخلي:
 * - client_secret يقبله "متصفح" الدفع الوهمي في الواجهات
 * - confirmPayment() تحاكي نتيجة 3DS: النجاح افتراضي، وفشل حتمي للمبالغ
 *   المنتهية بـ99 هللة (لاختبار مسار PAYMENT_FAILED دون عشوائية)
 */
export class MockPaymentAdapter implements PaymentAdapter {
  readonly provider = "mock";
  private secret = process.env.PAYMENT_WEBHOOK_SECRET ?? "dev-webhook-secret";
  /** حالة الـintents داخل الذاكرة — كافية للـsandbox المحلي */
  private intents = new Map<string, { amount: number; status: ProviderIntentStatus }>();
  private byIdempotency = new Map<string, ProviderIntent>();

  async createIntent(input: CreateIntentInput): Promise<ProviderIntent> {
    const existing = this.byIdempotency.get(input.idempotency_key);
    if (existing) return existing; // idempotent — docs/13§4-2

    const provider_ref = `mock_pi_${randomUUID()}`;
    this.intents.set(provider_ref, { amount: input.amount_halalas, status: "requires_payment" });
    const intent: ProviderIntent = {
      provider_ref,
      client_secret: `mock_secret_${randomUUID()}`,
      status: "requires_payment",
      supports_capture: true
    };
    this.byIdempotency.set(input.idempotency_key, intent);
    return intent;
  }

  /**
   * Tokenization في الـsandbox — يتحقق شكلياً (Luhn) ويستنتج الشبكة من البادئة:
   * بادئات مدى الشائعة ثم 4=فيزا و2/5=ماستركارد. لا يُخزن الرقم في أي مكان.
   */
  async tokenizeCard(input: TokenizeCardInput): Promise<CardToken> {
    const pan = input.card_number.replace(/\s/g, "");
    if (!/^\d{13,19}$/.test(pan)) throw new Error("invalid_card_number");
    // Luhn — يرفض الأخطاء المطبعية قبل «البوابة»
    let sum = 0;
    for (let i = 0; i < pan.length; i++) {
      let d = Number(pan[pan.length - 1 - i]);
      if (i % 2 === 1) {
        d *= 2;
        if (d > 9) d -= 9;
      }
      sum += d;
    }
    if (sum % 10 !== 0) throw new Error("invalid_card_number");
    if (!/^\d{3,4}$/.test(input.cvv)) throw new Error("invalid_cvv");

    const MADA_PREFIXES = ["4463", "4580", "5297", "5885", "6058", "9682"];
    const brand: CardToken["brand"] = MADA_PREFIXES.some((p) => pan.startsWith(p))
      ? "mada"
      : pan.startsWith("4")
        ? "visa"
        : "mastercard";
    return { token: `mock_card_${randomUUID()}`, brand, last4: pan.slice(-4) };
  }

  /** يحاكي إتمام العميل للدفع (3DS) — تستدعيه أداة sandbox/الاختبارات */
  async confirmPayment(provider_ref: string): Promise<"authorized" | "failed"> {
    const intent = this.intents.get(provider_ref);
    if (!intent) throw new Error(`mock intent غير موجود: ${provider_ref}`);
    const fails = intent.amount % 100 === 99;
    intent.status = fails ? "failed" : "authorized";
    return intent.status === "authorized" ? "authorized" : "failed";
  }

  async capture(provider_ref: string, _amount_halalas: number): Promise<{ ok: boolean }> {
    const intent = this.intents.get(provider_ref);
    if (!intent || intent.status !== "authorized") return { ok: false };
    intent.status = "captured";
    return { ok: true };
  }

  async cancelOrRelease(provider_ref: string): Promise<{ ok: boolean }> {
    const intent = this.intents.get(provider_ref);
    if (!intent) {
      // sandbox: الـref قد يكون من عملية أخرى (worker) — التحرير يُعد ناجحاً
      logger.warn({ provider_ref }, "[MOCK] release لref خارج ذاكرة العملية — اعتُبر ناجحاً");
      return { ok: true };
    }
    intent.status = "cancelled";
    return { ok: true };
  }

  async refund(provider_ref: string, amount_halalas: number, idempotency_key: string): Promise<{ ok: boolean; refund_ref: string }> {
    logger.info({ provider_ref, amount_halalas, idempotency_key }, "[MOCK] refund");
    return { ok: true, refund_ref: `mock_re_${randomUUID()}` };
  }

  /** يبني حمولة webhook موقعة — تُرسل لمسار /v1/webhooks/payments/mock */
  buildWebhookPayload(event_type: string, provider_ref: string, amount_halalas: number): { body: string; signature: string } {
    const body = JSON.stringify({
      event_ref: `mock_evt_${randomUUID()}`,
      event_type,
      provider_ref,
      amount_halalas,
      currency: "SAR",
      created_at: new Date().toISOString()
    });
    const signature = createHmac("sha256", this.secret).update(body).digest("hex");
    return { body, signature };
  }

  verifyWebhook(rawBody: string, signature: string | undefined): WebhookVerification | null {
    if (!signature) return null;
    const expected = createHmac("sha256", this.secret).update(rawBody).digest("hex");
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    const parsed = JSON.parse(rawBody) as {
      event_ref: string;
      event_type: string;
      provider_ref: string;
      amount_halalas: number;
      currency: string;
    };
    return { valid: true, ...parsed };
  }
}

export function createPaymentAdapter(): PaymentAdapter {
  const provider = process.env.PAYMENT_PROVIDER ?? "mock";
  switch (provider) {
    case "mock":
      return new MockPaymentAdapter();
    // hyperpay | moyasar | tap — تُضاف تنفيذاتها عند توقيع العقد (HUMAN-ACTIONS B1)
    default:
      throw new Error(`مزود دفع غير مدعوم بعد: ${provider} — راجع HUMAN-ACTIONS.md B1`);
  }
}
