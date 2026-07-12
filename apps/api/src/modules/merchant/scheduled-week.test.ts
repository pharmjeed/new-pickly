import { describe, expect, it } from "vitest";
import { buildWeeklySlots, riyadhDateISO, slotWithinWeeklyWindows } from "@pickly/database";

/**
 * BR-5 — دالة توليد الفترات من دوام الأسبوع (صرفة — بلا قاعدة بيانات):
 * كل الأوقات تُفسَّر بتوقيت الرياض (+03) بغضّ النظر عن منطقة الخادم.
 * 2026-07-11 سبت (day_of_week=6 — 0=الأحد).
 */
describe("BR-5 — buildWeeklySlots", () => {
  const now = new Date("2026-07-11T09:00:00+03:00"); // سبت 09:00 بتوقيت الرياض

  it("يولّد لليوم المطابق فقط وبدايات مستقبلية فقط", () => {
    const slots = buildWeeklySlots({
      windows: [{ day_of_week: 6, opens_at: "08:00", closes_at: "10:00" }],
      slotMinutes: 30,
      daysAhead: 7,
      now
    });
    // 08:00 و08:30 و09:00 مضت — تبقى 09:30 فقط، والسبت التالي خارج أفق الأيام السبعة
    expect(slots.length).toBe(1);
    expect(slots[0]?.start.getTime()).toBe(new Date("2026-07-11T09:30:00+03:00").getTime());
    expect(slots[0]?.end.getTime()).toBe(new Date("2026-07-11T10:00:00+03:00").getTime());
  });

  it("آخر فترة لا تتجاوز الإغلاق — 23:30 مع فترات 60 دقيقة تقف عند 22:30", () => {
    const slots = buildWeeklySlots({
      windows: [{ day_of_week: 0, opens_at: "20:00", closes_at: "23:30" }], // الأحد 2026-07-12
      slotMinutes: 60,
      daysAhead: 7,
      now
    });
    expect(slots.length).toBe(3); // 20:00 و21:00 و22:00 — 23:00+60 يتجاوز 23:30
    expect(slots[2]?.end.getTime()).toBe(new Date("2026-07-12T23:00:00+03:00").getTime());
  });

  it("الإغلاق قبل الفتح = دوام يمتد بعد منتصف الليل", () => {
    const slots = buildWeeklySlots({
      windows: [{ day_of_week: 0, opens_at: "18:00", closes_at: "02:00" }], // الأحد
      slotMinutes: 60,
      daysAhead: 7,
      now
    });
    expect(slots.length).toBe(8); // 18:00 → 01:00
    expect(slots[7]?.start.getTime()).toBe(new Date("2026-07-13T01:00:00+03:00").getTime());
  });

  it("لا تكرار عند تداخل نافذتين لنفس البداية", () => {
    const slots = buildWeeklySlots({
      windows: [
        { day_of_week: 0, opens_at: "10:00", closes_at: "12:00" },
        { day_of_week: 0, opens_at: "11:00", closes_at: "13:00" }
      ],
      slotMinutes: 60,
      daysAhead: 7,
      now
    });
    expect(slots.map((s) => s.start.getTime())).toEqual([
      new Date("2026-07-12T10:00:00+03:00").getTime(),
      new Date("2026-07-12T11:00:00+03:00").getTime(),
      new Date("2026-07-12T12:00:00+03:00").getTime()
    ]);
  });

  it("riyadhDateISO يعيد تاريخ الرياض لا UTC", () => {
    expect(riyadhDateISO(new Date("2026-07-11T22:30:00Z"))).toBe("2026-07-12");
    expect(riyadhDateISO(new Date("2026-07-11T20:59:00Z"))).toBe("2026-07-11");
  });
});

/**
 * قصّ الفترات المعروضة للعميل على دوام الفرع الحالي (GET /v1/branches/:id/slots):
 * فترة من دوام قديم خارج النوافذ الحالية لا تظهر.
 */
describe("BR-5 — slotWithinWeeklyWindows", () => {
  const sat = [{ day_of_week: 6, opens_at: "08:00", closes_at: "23:30" }]; // 2026-07-11 سبت

  it("فترة داخل الدوام تُقبل وأخرى قبله تُرفض", () => {
    expect(
      slotWithinWeeklyWindows(
        new Date("2026-07-11T08:00:00+03:00"),
        new Date("2026-07-11T08:30:00+03:00"),
        sat
      )
    ).toBe(true);
    expect(
      slotWithinWeeklyWindows(
        new Date("2026-07-11T07:00:00+03:00"),
        new Date("2026-07-11T07:30:00+03:00"),
        sat
      )
    ).toBe(false);
  });

  it("فترة تنتهي بعد الإغلاق تُرفض ولو بدأت داخله", () => {
    expect(
      slotWithinWeeklyWindows(
        new Date("2026-07-11T23:15:00+03:00"),
        new Date("2026-07-11T23:45:00+03:00"),
        sat
      )
    ).toBe(false);
  });

  it("يوم بلا نافذة دوام = لا فترات", () => {
    expect(
      slotWithinWeeklyWindows(
        new Date("2026-07-12T09:00:00+03:00"), // أحد — النافذة للسبت فقط
        new Date("2026-07-12T09:30:00+03:00"),
        sat
      )
    ).toBe(false);
  });

  it("دوام يمتد بعد منتصف الليل يقبل فترات ما بعده من نافذة اليوم السابق", () => {
    const overnight = [{ day_of_week: 6, opens_at: "18:00", closes_at: "02:00" }];
    expect(
      slotWithinWeeklyWindows(
        new Date("2026-07-12T01:00:00+03:00"), // فجر الأحد — ضمن نافذة السبت الممتدة
        new Date("2026-07-12T01:30:00+03:00"),
        overnight
      )
    ).toBe(true);
    expect(
      slotWithinWeeklyWindows(
        new Date("2026-07-12T02:30:00+03:00"),
        new Date("2026-07-12T03:00:00+03:00"),
        overnight
      )
    ).toBe(false);
  });
});
