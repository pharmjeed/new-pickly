import { describe, expect, it } from "vitest";
import {
  CUSTOMER_DISPLAY_MAP,
  ORDER_STATES,
  ORDER_TRANSITIONS,
  canTransition
} from "./order-states.js";

describe("آلة حالات الطلب — docs/05", () => {
  it("تطابق قائمة docs/05 الحرفية (25 حالة — العنوان يقول 24 والتعداد الحرفي 25، قرار D6)", () => {
    expect(ORDER_STATES).toHaveLength(25);
  });

  it("كل حالة لها مدخل في جدول الانتقالات وخريطة العرض", () => {
    for (const s of ORDER_STATES) {
      expect(ORDER_TRANSITIONS[s]).toBeDefined();
      expect(CUSTOMER_DISPLAY_MAP[s]).not.toBeUndefined();
    }
  });

  it("لا COMPLETED إلا من HANDOFF_IN_PROGRESS (قاعدة صلبة 4)", () => {
    for (const s of ORDER_STATES) {
      if (s === "HANDOFF_IN_PROGRESS") continue;
      expect(canTransition(s, "COMPLETED")).toBe(false);
    }
  });

  it("ARRIVED لا يُبلغ إلا من مسار الرحلة (تأكيد العميل — قاعدة صلبة 3)", () => {
    const allowedSources = ORDER_STATES.filter((s) => canTransition(s, "CUSTOMER_ARRIVED"));
    expect(allowedSources.sort()).toEqual(["CUSTOMER_NEARBY", "CUSTOMER_ON_THE_WAY"].sort());
  });

  it("لا انتقال من الحالات النهائية REFUNDED/EXPIRED", () => {
    expect(ORDER_TRANSITIONS.REFUNDED).toHaveLength(0);
    expect(ORDER_TRANSITIONS.EXPIRED).toHaveLength(0);
  });

  it("CANCELLATION_REQUESTED غير مسموح بعد بدء التسليم (docs/05§2)", () => {
    expect(canTransition("HANDOFF_IN_PROGRESS", "CANCELLATION_REQUESTED")).toBe(false);
    expect(canTransition("COMPLETED", "CANCELLATION_REQUESTED")).toBe(false);
  });
});
