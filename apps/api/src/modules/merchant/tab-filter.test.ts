import { describe, expect, it } from "vitest";
import { ACTIVE_STATES, JOURNEY_PARALLEL, TAB_WHERE } from "./tab-filter.js";

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

/**
 * قرار المالك 2026-07-13 — إعلان وصول العميل مفصول تماماً عن حالة الطلب لدى الفرع:
 * الوصول (CUSTOMER_ARRIVED) لا يزيح الطلب عن عمود تجهيزه ولا يقفزه إلى «مكتملة».
 * التبويبات تُصنَّف بحقيقة الجاهزية (ready_at) لا بحالة رحلة العميل (docs/05§3-4).
 */
describe("فصل الوصول عن حالة الفرع — TAB_WHERE بحقيقة ready_at", () => {
  /** يبحث في شرط التبويب عن فرع {order_status:{in:[...journey]}, ready_at: ...} */
  const journeyBranch = (where: (typeof TAB_WHERE)[string], readyNull: boolean) =>
    (where.OR ?? []).find((clause) => {
      const inList = (clause.order_status as { in?: string[] } | undefined)?.in;
      const isJourney = Array.isArray(inList) && inList.includes("CUSTOMER_ARRIVED");
      const ra = clause.ready_at;
      return isJourney && (readyNull ? ra === null : JSON.stringify(ra) === JSON.stringify({ not: null }));
    });

  it("الواصل غير المجهز يبقى في «قيد التحضير» (ready_at=null) — لا يختفي بإعلان الوصول", () => {
    expect(journeyBranch(TAB_WHERE.preparing!, true)).toBeDefined();
  });

  it("الواصل المجهز يبقى في «جاهزة» (ready_at≠null) — الوصول لا يزيحه", () => {
    expect(journeyBranch(TAB_WHERE.ready!, false)).toBeDefined();
  });

  it("«مكتملة» حصراً COMPLETED — الوصول لا يُدرج الطلب فيها أبداً (لا انتقال قيد التحضير→مكتمل)", () => {
    expect(TAB_WHERE.completed).toEqual({ order_status: "COMPLETED" });
    expect(JSON.stringify(TAB_WHERE.completed)).not.toContain("CUSTOMER_ARRIVED");
    expect(JSON.stringify(TAB_WHERE.completed)).not.toContain("HANDOFF_IN_PROGRESS");
  });

  it("الرحلة الموازية تغطي الوصول وبدء التسليم — لا حالة رحلة تسقط من عمود التجهيز", () => {
    expect(JOURNEY_PARALLEL).toContain("CUSTOMER_ARRIVED");
    expect(JOURNEY_PARALLEL).toContain("HANDOFF_IN_PROGRESS");
  });
});
