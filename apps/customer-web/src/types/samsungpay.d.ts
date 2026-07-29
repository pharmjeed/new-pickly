/**
 * أنواع Samsung Pay Web Checkout — الحد الأدنى الذي تستخدمه صفحة الدفع.
 * تُحمَّل المكتبة من img.mpay.samsung.com/gsmpi/sdk/samsungpay_web_sdk.js وقت التشغيل.
 * العقد مطابق لاستخدام مكتبة ميسر الرسمية: PROTOCOL_3DS والتوكن في 3DS.data.
 */
interface SamsungPayMethodsConfig {
  version: string;
  serviceId: string;
  protocol: "PROTOCOL_3DS";
  allowedBrands: string[];
}

interface SamsungPayTransactionDetail {
  orderNumber: string;
  merchant: { name: string; countryCode: string; url: string };
  amount: { option: "FORMAT_TOTAL_ESTIMATED_AMOUNT"; currency: string; total: string };
}

interface SamsungPaySheetResult {
  "3DS": { data: string };
}

interface SamsungPayClientInstance {
  isReadyToPay(config: SamsungPayMethodsConfig): Promise<{ result: boolean }>;
  loadPaymentSheet(
    config: SamsungPayMethodsConfig,
    tx: SamsungPayTransactionDetail
  ): Promise<SamsungPaySheetResult>;
  /** إبلاغ سامسونج بمصير العملية بعد ورقة الدفع */
  notify(result: { status: "CHARGED" | "REJECTED" | "ERRED"; provider: string }): void;
}

interface SamsungPayNamespace {
  PaymentClient: new (opts: { environment: "PRODUCTION" | "STAGE" }) => SamsungPayClientInstance;
}

interface Window {
  SamsungPay?: SamsungPayNamespace;
}
