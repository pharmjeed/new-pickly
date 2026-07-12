import { describe, expect, it } from "vitest";
import { ACTIVE_STATES, TAB_WHERE } from "./tab-filter.js";

/**
 * BR-5 — تبويب «مجدولة» في لوحة الفرع B-03:
 * المجدول يرقد في ORDER_SUBMITTED حتى موعده، فلا بد أن يراه الفرع قادماً
 * قبل أن يهبط في «جديدة» — وإلا فوجئ به المطعم أو نسيه.
 */
describe("BR-5 — TAB_WHERE.scheduled", () => {
  it("يستهدف المجدولة الراقدة فقط: ORDER_SUBMITTED مع pickup_time=scheduled", () => {
    expect(TAB_WHERE.scheduled).toEqual({
      order_status: "ORDER_SUBMITTED",
      pickup_time: "scheduled"
    });
  });

  it("«فوري الآن» (asap) الراقد لا يتسرب لتبويب المجدولة — الشرط مقيد بـpickup_time", () => {
    // الشرط الصريح على pickup_time هو الضامن؛ غيابه يعني ظهور كل ORDER_SUBMITTED
    expect(TAB_WHERE.scheduled).toHaveProperty("pickup_time", "scheduled");
  });

  it("ORDER_SUBMITTED ليست من الحالات النشطة — بيانات السيارة تبقى مقنّعة قبل الموعد (docs/10§3-4)", () => {
    expect(ACTIVE_STATES).not.toContain("ORDER_SUBMITTED");
  });

  it("بقية التبويبات لا تعرض المجدولة الراقدة — لا ازدواج بطاقات", () => {
    for (const [tab, where] of Object.entries(TAB_WHERE)) {
      if (tab === "scheduled") continue;
      expect(JSON.stringify(where)).not.toContain("ORDER_SUBMITTED");
    }
  });
});
