"use client";

/**
 * ترميز البطاقة لدى ميسر من المتصفح مباشرة — رقم البطاقة وCVV لا يمران على
 * خوادم بيكلي أبداً (docs/13§4-1، docs/17). نرسل نموذجاً بترميز urlencoded
 * كما في نموذج ميسر الرسمي: طلب «بسيط» بلا preflight، يعمل داخل WebView.
 *
 * المرجع: https://docs.moyasar.com/guides/card-payments/custom-ui/
 */

const TOKENS_URL = "https://api.moyasar.com/v1/tokens";

export interface TokenizedCard {
  token: string;
  brand: "mada" | "visa" | "mastercard";
  last4: string;
  exp_month: number;
  exp_year: number;
  holder_name: string | null;
}

interface MoyasarTokenResponse {
  id?: string;
  brand?: string;
  last_four?: string;
  month?: string | number;
  year?: string | number;
  name?: string;
  message?: string;
  errors?: Record<string, string[]> | string;
}

/** أخطاء ميسر تصل إنجليزية — نترجم الشائع منها (docs/11§10: رسائل ثنائية اللغة) */
const GATEWAY_ERRORS_AR: Array<[RegExp, string]> = [
  [/unsupported card scheme/i, "شبكة البطاقة غير مدعومة — تأكد من كتابة الرقم بترتيبه الصحيح من أول البطاقة"],
  [/invalid.*(card|number)|luhn|not a valid/i, "رقم البطاقة غير صحيح — راجع الأرقام"],
  [/cvc|security code/i, "رمز CVV غير صحيح"],
  [/expir|invalid.*(month|year)/i, "تاريخ انتهاء البطاقة غير صحيح"]
];

function localizeGatewayError(detail: string | undefined): string | undefined {
  if (!detail) return undefined;
  return GATEWAY_ERRORS_AR.find(([re]) => re.test(detail))?.[1] ?? detail;
}

function brandOf(raw: string | undefined): TokenizedCard["brand"] {
  const b = (raw ?? "").toLowerCase();
  if (b.includes("mada")) return "mada";
  if (b.includes("master")) return "mastercard";
  return "visa";
}

export async function tokenizeCardAtGateway(
  publishableKey: string,
  card: { number: string; month: number; year: number; cvc: string; name?: string }
): Promise<TokenizedCard> {
  const form = new URLSearchParams({
    publishable_api_key: publishableKey,
    // يخبر ميسر أن هذا توكن دفع (checkout token) لا حفظ مستقل
    save_only: "true",
    name: card.name?.trim() || "Pickly Customer",
    number: card.number.replace(/\s/g, ""),
    cvc: card.cvc,
    month: String(card.month).padStart(2, "0"),
    year: String(card.year)
  });

  const res = await fetch(TOKENS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString()
  });

  const data = (await res.json().catch(() => ({}))) as MoyasarTokenResponse;
  if (!res.ok || !data.id) {
    const detail =
      typeof data.errors === "string"
        ? data.errors
        : data.errors
          ? Object.values(data.errors).flat().join(" · ")
          : data.message;
    throw new Error(localizeGatewayError(detail) || "تعذّر التحقق من البطاقة — راجع بياناتها");
  }

  return {
    token: data.id,
    brand: brandOf(data.brand),
    last4: (data.last_four ?? "").replace(/\D/g, "").slice(-4) || "0000",
    exp_month: Number(data.month) || card.month,
    exp_year: Number(data.year) || card.year,
    holder_name: data.name ?? card.name ?? null
  };
}
