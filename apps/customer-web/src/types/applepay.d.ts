/**
 * أنواع Apple Pay JS — الحد الأدنى الذي تستخدمه صفحة الدفع.
 * متاح في Safari على أجهزة آبل فقط؛ الوجود يُفحص وقت التشغيل عبر window.ApplePaySession.
 */
interface ApplePayPaymentRequestLite {
  countryCode: string;
  currencyCode: string;
  supportedNetworks: string[];
  merchantCapabilities: string[];
  total: { label: string; amount: string };
}

interface ApplePaySessionInstance {
  begin(): void;
  abort(): void;
  /** جسم استجابة ميسر /v1/applepay/initiate يمرر كما هو */
  completeMerchantValidation(merchantSession: unknown): void;
  completePayment(result: { status: number }): void;
  onvalidatemerchant: ((ev: { validationURL: string }) => void) | null;
  onpaymentauthorized: ((ev: { payment: { token: unknown } }) => void) | null;
  oncancel: ((ev: unknown) => void) | null;
}

interface ApplePaySessionCtor {
  new (version: number, request: ApplePayPaymentRequestLite): ApplePaySessionInstance;
  canMakePayments(): boolean;
  readonly STATUS_SUCCESS: number;
  readonly STATUS_FAILURE: number;
}

interface Window {
  ApplePaySession?: ApplePaySessionCtor;
}
