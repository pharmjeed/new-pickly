import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MoyasarPaymentAdapter } from "./moyasar.js";

/** اختبارات محوّل ميسر — التحقق من webhook وبناء المصدر وخريطة الحالات (docs/13§4) */

const SECRET = "wh_secret_for_tests";

interface Captured {
  url: string;
  method: string;
  body: Record<string, unknown> | null;
  auth: string | null;
}

let calls: Captured[] = [];

/** يستبدل fetch برد ثابت ويسجّل ما أُرسل */
function mockFetch(response: unknown, ok = true, status = 200): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      const headers = (init.headers ?? {}) as Record<string, string>;
      calls.push({
        url,
        method: init.method ?? "GET",
        body: init.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : null,
        auth: headers.Authorization ?? null
      });
      return {
        ok,
        status,
        text: async () => JSON.stringify(response)
      } as Response;
    })
  );
}

function adapter(): MoyasarPaymentAdapter {
  process.env.PAYMENT_API_KEY = "sk_test_key";
  process.env.PAYMENT_PUBLISHABLE_KEY = "pk_test_key";
  process.env.PAYMENT_WEBHOOK_SECRET = SECRET;
  process.env.PAYMENT_MANUAL_CAPTURE = "true";
  return new MoyasarPaymentAdapter();
}

const chargeBase = {
  amount_halalas: 5000,
  currency: "SAR" as const,
  order_ref: "PK-1234",
  idempotency_key: "idem-1",
  callback_url: "https://app.thepickly.com/pay/return?order=o1"
};

beforeEach(() => {
  calls = [];
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("MoyasarPaymentAdapter — التحقق من webhook", () => {
  it("يقبل الحدث بالسر الصحيح ويقرأ المرجع والمبلغ", () => {
    const verified = adapter().verifyWebhook(
      JSON.stringify({
        id: "evt_1",
        type: "payment_authorized",
        secret_token: SECRET,
        data: { id: "pay_1", amount: 5000, currency: "SAR", status: "authorized" }
      }),
      undefined
    );
    expect(verified).toEqual({
      valid: true,
      event_ref: "evt_1",
      event_type: "payment.authorized",
      provider_ref: "pay_1",
      amount_halalas: 5000,
      currency: "SAR"
    });
  });

  it("يرفض السر الخاطئ وفارغ السر ومختلف الطول (مقارنة ثابتة الزمن)", () => {
    const a = adapter();
    const body = (secret: unknown) =>
      JSON.stringify({
        id: "evt_2",
        type: "payment_paid",
        ...(secret === undefined ? {} : { secret_token: secret }),
        data: { id: "pay_2", amount: 100, currency: "SAR" }
      });
    expect(a.verifyWebhook(body("wrong_secret_same_len!"), undefined)).toBeNull();
    expect(a.verifyWebhook(body("short"), undefined)).toBeNull();
    expect(a.verifyWebhook(body(undefined), undefined)).toBeNull();
    expect(a.verifyWebhook("not json", undefined)).toBeNull();
  });

  it("يترجم أنواع أحداث ميسر — بما فيها الخطأ المطبعي payment_faild", () => {
    const a = adapter();
    const typed = (type: string): string | undefined =>
      a.verifyWebhook(
        JSON.stringify({
          id: `evt_${type}`,
          type,
          secret_token: SECRET,
          data: { id: "pay_3", amount: 100, currency: "SAR" }
        }),
        undefined
      )?.event_type;

    expect(typed("payment_paid")).toBe("payment.captured");
    expect(typed("payment_captured")).toBe("payment.captured");
    expect(typed("payment_authorized")).toBe("payment.authorized");
    expect(typed("payment_faild")).toBe("payment.failed");
    expect(typed("payment_failed")).toBe("payment.failed");
    expect(typed("payment_voided")).toBe("payment.cancelled");
    expect(typed("card_auth_authenticated")).toBeUndefined();
  });
});

describe("MoyasarPaymentAdapter — تنفيذ الدفع", () => {
  it("البطاقة: مصدر token بحجز (manual) ورابط 3DS يعود كـredirect_url", async () => {
    mockFetch({
      id: "pay_10",
      status: "initiated",
      amount: 5000,
      currency: "SAR",
      source: { type: "token", transaction_url: "https://api.moyasar.com/v1/transaction_auths/x" }
    });
    const res = await adapter().charge({
      ...chargeBase,
      method: "card",
      card_token: "token_abc",
      given_id: "intent-1"
    });

    expect(calls[0]?.url).toContain("/payments");
    expect(calls[0]?.auth).toBe(`Basic ${Buffer.from("sk_test_key:").toString("base64")}`);
    const body = calls[0]?.body as { amount: number; source: Record<string, unknown>; given_id: string; callback_url: string };
    expect(body.amount).toBe(5000);
    expect(body.given_id).toBe("intent-1");
    expect(body.callback_url).toBe(chargeBase.callback_url);
    expect(body.source).toMatchObject({ type: "token", token: "token_abc", manual: true });
    expect(res).toMatchObject({
      provider_ref: "pay_10",
      status: "processing",
      supports_capture: true,
      redirect_url: "https://api.moyasar.com/v1/transaction_auths/x"
    });
  });

  it("STC Pay: مصدر stcpay بالجوال وبلا حجز (تحصيل فوري)", async () => {
    mockFetch({
      id: "pay_11",
      status: "initiated",
      amount: 5000,
      currency: "SAR",
      source: { type: "stcpay", transaction_url: "https://moyasar.com/stcpay/otp" }
    });
    const res = await adapter().charge({ ...chargeBase, method: "stc_pay", mobile: "0512345678" });

    expect((calls[0]?.body as { source: Record<string, unknown> }).source).toEqual({
      type: "stcpay",
      mobile: "0512345678"
    });
    expect(res.supports_capture).toBe(false);
  });

  it("save_card يعيد توكناً قابلاً للحفظ مع الشبكة وآخر أربعة", async () => {
    mockFetch({
      id: "pay_12",
      status: "paid",
      amount: 5000,
      currency: "SAR",
      source: {
        type: "token",
        token: "token_saved",
        company: "mada",
        number: "4463XXXXXXXX1234",
        month: "09",
        year: "2029",
        name: "AHMED"
      }
    });
    const res = await adapter().charge({
      ...chargeBase,
      method: "card",
      card_token: "token_abc",
      save_card: true
    });

    expect((calls[0]?.body as { source: Record<string, unknown> }).source).toMatchObject({ save_card: true });
    expect(res.status).toBe("captured");
    expect(res.saved_card).toEqual({
      token: "token_saved",
      brand: "mada",
      last4: "1234",
      exp_month: 9,
      exp_year: 2029,
      holder_name: "AHMED"
    });
  });

  it("مصدر ناقص يرفع خطأ قبل أي نداء للبوابة", async () => {
    mockFetch({});
    const a = adapter();
    await expect(a.charge({ ...chargeBase, method: "card" })).rejects.toThrow("missing_card_token");
    await expect(a.charge({ ...chargeBase, method: "stc_pay" })).rejects.toThrow("missing_mobile");
    expect(calls).toHaveLength(0);
  });

  it("رفض البوابة يرفع خطأ يحمل الرمز ولا يمرر جسم الطلب", async () => {
    mockFetch({ type: "invalid_request_error", message: "Card declined" }, false, 400);
    await expect(
      adapter().charge({ ...chargeBase, method: "card", card_token: "token_bad" })
    ).rejects.toThrow(/moyasar_400/);
  });
});

describe("MoyasarPaymentAdapter — عمليات ما بعد التفويض", () => {
  it("capture ينادي المسار الصحيح وينجح على captured", async () => {
    mockFetch({ id: "pay_20", status: "captured", amount: 5000, currency: "SAR" });
    const res = await adapter().capture("pay_20", 5000);
    expect(calls[0]?.url).toContain("/payments/pay_20/capture");
    expect(calls[0]?.body).toEqual({ amount: 5000 });
    expect(res.ok).toBe(true);
  });

  it("cancelOrRelease يجرب void ثم يسقط لـrefund خارج نافذة الإلغاء", async () => {
    let first = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, method: init.method ?? "GET", body: null, auth: null });
        if (first) {
          first = false;
          return { ok: false, status: 400, text: async () => JSON.stringify({ message: "too late" }) } as Response;
        }
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ id: "pay_21", status: "refunded", amount: 1, currency: "SAR" })
        } as Response;
      })
    );
    const res = await adapter().cancelOrRelease("pay_21");
    expect(calls[0]?.url).toContain("/void");
    expect(calls[1]?.url).toContain("/refund");
    expect(res.ok).toBe(true);
  });

  it("fetchPayment يترجم حالات ميسر إلى حالات النية", async () => {
    const a = adapter();
    for (const [remote, mapped] of [
      ["paid", "captured"],
      ["authorized", "authorized"],
      ["initiated", "processing"],
      ["voided", "cancelled"],
      ["failed", "failed"]
    ] as const) {
      mockFetch({ id: "pay_30", status: remote, amount: 5000, currency: "SAR", source: {} });
      const res = await a.fetchPayment("pay_30");
      expect(res?.status).toBe(mapped);
    }
  });

  it("فشل الشبكة في fetchPayment لا يرمي — يعيد null فتُترك الحالة كما هي", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down"); }));
    expect(await adapter().fetchPayment("pay_31")).toBeNull();
  });
});

describe("MoyasarPaymentAdapter — حدود PCI", () => {
  it("لا يقبل رقم بطاقة على الخادم — الترميز في المتصفح حصراً", async () => {
    await expect(
      adapter().tokenizeCard({ card_number: "4111111111111111", exp_month: 1, exp_year: 2030, cvv: "123" })
    ).rejects.toThrow("client_tokenization_required");
  });

  it("createIntent لا تنادي الشبكة (شحن مؤجل) وتُبلغ بدعم الحجز", async () => {
    mockFetch({});
    const a = adapter();
    const intent = await a.createIntent({
      amount_halalas: 5000,
      currency: "SAR",
      order_ref: "PK-1",
      idempotency_key: "k",
      method: "card"
    });
    expect(calls).toHaveLength(0);
    expect(a.deferred_charge).toBe(true);
    expect(intent).toEqual({
      provider_ref: "",
      client_secret: "",
      status: "requires_payment",
      supports_capture: true
    });
  });

  it("قوقل باي معتمدة افتراضياً ولا تختفي إلا بإيقاف صريح", () => {
    delete process.env.MOYASAR_GOOGLE_PAY;
    expect(adapter().supportedMethods()).toEqual(["card", "stc_pay", "google_pay"]);
    process.env.MOYASAR_GOOGLE_PAY = "false";
    expect(adapter().supportedMethods()).toEqual(["card", "stc_pay"]);
    delete process.env.MOYASAR_GOOGLE_PAY;
  });
});
