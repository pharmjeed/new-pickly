import { z } from "zod";

/**
 * حالات الطلب — القائمة مغلقة حرفياً من docs/05.
 * (عنوان الوثيقة يقول «24» لكن تعدادها الحرفي 25 حالة — القائمة الحرفية هي الحاكمة، قرار D6.)
 * أي حالة خارجها خطأ برمجي.
 */
export const ORDER_STATES = [
  "DRAFT",
  "CART_ACTIVE",
  "CHECKOUT_PENDING",
  "PAYMENT_PENDING",
  "PAYMENT_AUTHORIZED",
  "PAYMENT_FAILED",
  "ORDER_SUBMITTED",
  "MERCHANT_PENDING",
  "MERCHANT_ACCEPTED",
  "MERCHANT_REJECTED",
  "PREPARING",
  "READY",
  "CUSTOMER_NOTIFIED",
  "CUSTOMER_ON_THE_WAY",
  "CUSTOMER_NEARBY",
  "CUSTOMER_ARRIVED",
  "HANDOFF_IN_PROGRESS",
  "COMPLETED",
  "CANCELLATION_REQUESTED",
  "CANCELLED",
  "NO_SHOW",
  "EXPIRED",
  "REFUND_PENDING",
  "PARTIALLY_REFUNDED",
  "REFUNDED"
] as const;

export const OrderStateSchema = z.enum(ORDER_STATES);
export type OrderState = z.infer<typeof OrderStateSchema>;

/**
 * جدول الانتقالات المسموحة — docs/05§3.
 * المفتاح: الحالة الحالية؛ القيمة: الحالات التي يجوز الانتقال إليها.
 * ملاحظات:
 * - مسار الوصول (ON_THE_WAY→NEARBY→ARRIVED) عبر Pickup Session ويجوز أن يسبق READY.
 * - «أنا في الطريق» مسموح من MERCHANT_ACCEPTED فصاعداً (docs/05§4-1).
 * - CANCELLATION_REQUESTED مسموح من أي حالة قبل HANDOFF_IN_PROGRESS.
 */
export const ORDER_TRANSITIONS: Readonly<Record<OrderState, readonly OrderState[]>> = {
  DRAFT: ["CART_ACTIVE"],
  CART_ACTIVE: ["CHECKOUT_PENDING", "EXPIRED"],
  CHECKOUT_PENDING: ["PAYMENT_PENDING", "CART_ACTIVE", "EXPIRED"],
  PAYMENT_PENDING: ["PAYMENT_AUTHORIZED", "PAYMENT_FAILED", "EXPIRED"],
  PAYMENT_AUTHORIZED: ["ORDER_SUBMITTED"],
  PAYMENT_FAILED: ["PAYMENT_PENDING", "REFUND_PENDING", "EXPIRED"],
  ORDER_SUBMITTED: ["MERCHANT_PENDING", "CANCELLATION_REQUESTED"],
  MERCHANT_PENDING: ["MERCHANT_ACCEPTED", "MERCHANT_REJECTED", "CANCELLATION_REQUESTED"],
  MERCHANT_ACCEPTED: ["PREPARING", "CUSTOMER_ON_THE_WAY", "CANCELLATION_REQUESTED"],
  MERCHANT_REJECTED: ["REFUND_PENDING"],
  PREPARING: ["READY", "CUSTOMER_ON_THE_WAY", "CANCELLATION_REQUESTED"],
  READY: ["CUSTOMER_NOTIFIED", "CUSTOMER_ON_THE_WAY", "CANCELLATION_REQUESTED"],
  CUSTOMER_NOTIFIED: ["CUSTOMER_ON_THE_WAY", "NO_SHOW", "CANCELLATION_REQUESTED"],
  CUSTOMER_ON_THE_WAY: ["CUSTOMER_NEARBY", "CUSTOMER_ARRIVED", "NO_SHOW", "CANCELLATION_REQUESTED"],
  CUSTOMER_NEARBY: ["CUSTOMER_ARRIVED", "NO_SHOW", "CANCELLATION_REQUESTED"],
  CUSTOMER_ARRIVED: ["HANDOFF_IN_PROGRESS", "NO_SHOW", "CANCELLATION_REQUESTED"],
  HANDOFF_IN_PROGRESS: ["COMPLETED"],
  COMPLETED: ["REFUND_PENDING"],
  CANCELLATION_REQUESTED: ["CANCELLED"],
  CANCELLED: ["REFUND_PENDING"],
  NO_SHOW: ["REFUND_PENDING"],
  EXPIRED: [],
  REFUND_PENDING: ["REFUNDED", "PARTIALLY_REFUNDED"],
  PARTIALLY_REFUNDED: ["REFUND_PENDING"],
  REFUNDED: []
};

export function canTransition(from: OrderState, to: OrderState): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

/**
 * حالات العرض السبع للعميل — إسقاط مبسط (docs/05§4-8 + PRD §7).
 * الأسماء حرفية من التصميم — لا تعدلها (README-FOR-CLAUDE-CODE §3).
 */
export const CUSTOMER_DISPLAY_STATES = [
  "SUBMITTED", // أُرسل الطلب
  "ACCEPTED", // قبله المطعم
  "PREPARING", // قيد التجهيز
  "READY", // جاهز
  "ON_THE_WAY", // أنت في الطريق
  "ARRIVED", // وصلت
  "COMPLETED" // تم التسليم
] as const;
export type CustomerDisplayState = (typeof CUSTOMER_DISPLAY_STATES)[number];

/** خريطة الإسقاط: حالة داخلية ← حالة عرض للعميل (null = لا تُعرض في شريط الحالات) */
export const CUSTOMER_DISPLAY_MAP: Readonly<Record<OrderState, CustomerDisplayState | null>> = {
  DRAFT: null,
  CART_ACTIVE: null,
  CHECKOUT_PENDING: null,
  PAYMENT_PENDING: null,
  PAYMENT_AUTHORIZED: null,
  PAYMENT_FAILED: null,
  ORDER_SUBMITTED: "SUBMITTED",
  MERCHANT_PENDING: "SUBMITTED",
  MERCHANT_ACCEPTED: "ACCEPTED",
  MERCHANT_REJECTED: null,
  PREPARING: "PREPARING",
  READY: "READY",
  CUSTOMER_NOTIFIED: "READY",
  CUSTOMER_ON_THE_WAY: "ON_THE_WAY",
  CUSTOMER_NEARBY: "ON_THE_WAY",
  CUSTOMER_ARRIVED: "ARRIVED",
  HANDOFF_IN_PROGRESS: "ARRIVED",
  COMPLETED: "COMPLETED",
  CANCELLATION_REQUESTED: null,
  CANCELLED: null,
  NO_SHOW: null,
  EXPIRED: null,
  REFUND_PENDING: null,
  PARTIALLY_REFUNDED: null,
  REFUNDED: null
};
