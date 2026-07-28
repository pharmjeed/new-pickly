/**
 * أنواع Google Pay JS — الحد الأدنى الذي تستخدمه صفحة الدفع.
 * تُحمَّل المكتبة من pay.google.com/gp/p/js/pay.js وقت التشغيل عند توفر الطريقة.
 */
interface GooglePayTokenizationSpec {
  type: "PAYMENT_GATEWAY";
  parameters: { gateway: string; gatewayMerchantId: string };
}

interface GooglePayCardMethod {
  type: "CARD";
  parameters: { allowedAuthMethods: string[]; allowedCardNetworks: string[] };
  tokenizationSpecification?: GooglePayTokenizationSpec;
}

interface GooglePayDataRequest {
  apiVersion: 2;
  apiVersionMinor: 0;
  allowedPaymentMethods: GooglePayCardMethod[];
  merchantInfo?: { merchantName?: string; merchantId?: string };
  transactionInfo?: {
    totalPriceStatus: "FINAL";
    totalPrice: string;
    currencyCode: string;
    countryCode?: string;
  };
}

interface GooglePayPaymentData {
  paymentMethodData: { tokenizationData: { token: string } };
}

interface GooglePaymentsClient {
  isReadyToPay(req: GooglePayDataRequest): Promise<{ result: boolean }>;
  loadPaymentData(req: GooglePayDataRequest): Promise<GooglePayPaymentData>;
}

interface GooglePaymentsNamespace {
  api: {
    PaymentsClient: new (opts: { environment: "TEST" | "PRODUCTION" }) => GooglePaymentsClient;
  };
}

// مكتبة Google تعلّق نفسها على window.google.payments
interface Window {
  google?: { payments?: GooglePaymentsNamespace };
}
