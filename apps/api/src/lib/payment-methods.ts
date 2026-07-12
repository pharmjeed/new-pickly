import { prisma, type Prisma } from "@pickly/database";
import type { ContentPaymentMethod } from "@pickly/contracts";

/**
 * طرق الدفع الظاهرة للعميل + محفظة بيكلي (قرار المالك 2026-07-12 — docs/01§1).
 * القائمة يديرها السوبر أدمن في system_settings:payments.methods (سجل تاريخي كالبانرات)،
 * ورصيد المحفظة = مجموع قيود customer_wallet_entries — لا عمود رصيد منسوخ.
 */

export interface PaymentMethodSetting {
  key: "apple_pay" | "card" | "stc_pay";
  name_ar: string;
  desc_ar: string | null;
  badge_ar: string | null;
  is_active: boolean;
}

export const DEFAULT_PAYMENT_METHODS: PaymentMethodSetting[] = [
  { key: "apple_pay", name_ar: "Apple Pay", desc_ar: null, badge_ar: null, is_active: true },
  { key: "card", name_ar: "بطاقة — مدى وفيزا وماستركارد", desc_ar: "احفظ وادفع عبر البطاقة", badge_ar: null, is_active: true },
  { key: "stc_pay", name_ar: "stc pay", desc_ar: "ادفع لطلبك باستخدام رقم الجوال المسجل في STC Pay", badge_ar: null, is_active: true }
];

/** أحدث قائمة سارية (تشمل الموقوفة — للوحة الأدمن) — بلا صف مخزن تسقط للافتراضي */
export async function paymentMethodsConfig(): Promise<PaymentMethodSetting[]> {
  const setting = await prisma.systemSetting.findFirst({
    where: { key: "payments.methods", effective_at: { lte: new Date() } },
    orderBy: { effective_at: "desc" }
  });
  const stored = setting?.value as PaymentMethodSetting[] | null | undefined;
  return Array.isArray(stored) && stored.length > 0 ? stored : DEFAULT_PAYMENT_METHODS;
}

/** الفعّالة فقط بترتيب الأدمن — ما يراه العميل في «اختر طريقة الدفع» */
export async function activePaymentMethods(): Promise<ContentPaymentMethod[]> {
  return (await paymentMethodsConfig())
    .filter((m) => m.is_active)
    .map((m) => ({ key: m.key, name_ar: m.name_ar, desc_ar: m.desc_ar ?? null, badge_ar: m.badge_ar ?? null }));
}

/** رصيد محفظة بيكلي — مجموع القيود (موجب إيداع، سالب صرف) */
export async function walletBalance(
  db: Prisma.TransactionClient | typeof prisma,
  user_id: string
): Promise<number> {
  const agg = await db.customerWalletEntry.aggregate({
    where: { user_id },
    _sum: { amount_halalas: true }
  });
  return agg._sum.amount_halalas ?? 0;
}
