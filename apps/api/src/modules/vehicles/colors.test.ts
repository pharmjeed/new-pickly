import { describe, expect, it } from "vitest";
import { VEHICLE_COLORS, VEHICLE_COLOR_ALIASES, vehicleColorHex } from "./colors.js";

/**
 * دائرة لون السيارة على بطاقة الفرع يجب أن تطابق النص المكتوب دائماً:
 * السيارات المسجّلة قبل قائمة الكتالوج لونها نص حر («بيضاء») لا اسم الكتالوج («أبيض»)،
 * والمطابقة الحرفية كانت تسقطها على الرمادي.
 */
describe("vehicleColorHex — مطابقة متسامحة لاسم اللون", () => {
  it("أسماء الكتالوج نفسها تعود بـhex الصحيح", () => {
    for (const c of VEHICLE_COLORS) {
      expect(vehicleColorHex(c.name_ar)).toBe(c.hex);
    }
  });

  it("«بيضاء» (صيغة المؤنث المخزّنة قديماً) → أبيض #FFFFFF لا رمادي", () => {
    expect(vehicleColorHex("بيضاء")).toBe("#FFFFFF");
  });

  it("كل المرادفات المعلنة تعود بلون الكتالوج المقابل", () => {
    for (const [canonical, aliases] of Object.entries(VEHICLE_COLOR_ALIASES)) {
      const hex = VEHICLE_COLORS.find((c) => c.name_ar === canonical)?.hex;
      expect(hex, `لون ${canonical} غير موجود في الكتالوج`).toBeDefined();
      for (const alias of aliases) {
        expect(vehicleColorHex(alias), `${alias} → ${canonical}`).toBe(hex);
      }
    }
  });

  it("متسامح مع الهمزات والمسافات: «ابيض» و« أبيض » تطابقان الأبيض", () => {
    expect(vehicleColorHex("ابيض")).toBe("#FFFFFF");
    expect(vehicleColorHex(" أبيض ")).toBe("#FFFFFF");
    expect(vehicleColorHex("فضيه")).toBe("#C7CCD1"); // تاء مربوطة → هاء
  });

  it("لون غير معروف → null (الواجهة تسقط على الرمادي الافتراضي)", () => {
    expect(vehicleColorHex("وردي فاقع")).toBeNull();
    expect(vehicleColorHex("")).toBeNull();
  });
});
