import type { Prisma } from "@pickly/database";
import type { OrderState } from "@pickly/contracts";

/** خريطة تبويبات لوحة التشغيل B-03 → شرط الاستعلام (صرفة — قابلة للاختبار بلا قاعدة) */

export const ACTIVE_STATES: OrderState[] = [
  "MERCHANT_PENDING",
  "MERCHANT_ACCEPTED",
  "PREPARING",
  "READY",
  "CUSTOMER_NOTIFIED",
  "CUSTOMER_ON_THE_WAY",
  "CUSTOMER_NEARBY",
  "CUSTOMER_ARRIVED",
  "HANDOFF_IN_PROGRESS"
];

/**
 * مسار التجهيز الموازي (docs/05§3): رحلة العميل يجوز أن تسبق READY،
 * فالتبويب يُصنَّف بحقيقة الجاهزية (ready_at) لا بحالة الرحلة —
 * طلب لم يجهز يبقى «قيد التحضير» ولو انطلق العميل، والواصل يظهر في «وصلوا».
 */
export const JOURNEY_EN_ROUTE: OrderState[] = ["CUSTOMER_ON_THE_WAY", "CUSTOMER_NEARBY"];
export const JOURNEY_STATES: OrderState[] = [...JOURNEY_EN_ROUTE, "CUSTOMER_ARRIVED"];

export const TAB_WHERE: Record<string, Prisma.OrderWhereInput> = {
  /**
   * BR-5 — الطلبات المجدولة القادمة: مدفوعة لكنها راقدة في ORDER_SUBMITTED
   * حتى موعد فترتها؛ بدونها الفرع أعمى عمّا سيهبط عليه (docs/06 BR-5).
   */
  scheduled: { order_status: "ORDER_SUBMITTED", pickup_time: "scheduled" },
  new: { order_status: "MERCHANT_PENDING" },
  preparing: {
    OR: [
      { order_status: { in: ["MERCHANT_ACCEPTED", "PREPARING"] } },
      { order_status: { in: JOURNEY_EN_ROUTE }, ready_at: null }
    ]
  },
  ready: {
    OR: [
      { order_status: { in: ["READY", "CUSTOMER_NOTIFIED"] } },
      { order_status: { in: JOURNEY_EN_ROUTE }, ready_at: { not: null } }
    ]
  },
  arrived: { order_status: { in: ["CUSTOMER_ARRIVED", "HANDOFF_IN_PROGRESS"] } },
  completed: { order_status: "COMPLETED" }
};
