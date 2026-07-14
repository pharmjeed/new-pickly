/**
 * كتالوج ألوان السيارات — مصدر الحقيقة الوحيد لاسم اللون وhex دائرته.
 * تستهلكه شاشة «أضف سيارة» عبر /vehicle-catalog، وبطاقة الفرع عبر vehicleColorHex.
 */

/** ألوان السيارات المتاحة في القائمة المنسدلة — الاسم عربي + hex لعرض الحبة الملونة */
export const VEHICLE_COLORS: ReadonlyArray<{ name_ar: string; hex: string }> = [
  { name_ar: "أبيض", hex: "#FFFFFF" },
  { name_ar: "أسود", hex: "#1B1B1B" },
  { name_ar: "فضي", hex: "#C7CCD1" },
  { name_ar: "رمادي", hex: "#7E868C" },
  { name_ar: "أزرق", hex: "#2456A6" },
  { name_ar: "أحمر", hex: "#C0272D" },
  { name_ar: "أخضر", hex: "#1E7A46" },
  { name_ar: "بني", hex: "#6B4A2F" },
  { name_ar: "بيج", hex: "#D9C9A8" },
  { name_ar: "ذهبي", hex: "#C9A227" },
  { name_ar: "برتقالي", hex: "#E07A1F" },
  { name_ar: "عنابي", hex: "#6E1F2C" },
  { name_ar: "أصفر", hex: "#E8C41C" }
];

/**
 * صيغ يكتبها العملاء نصاً حراً (مؤنث/عامية) لنفس اللون — السيارات المسجّلة قبل قائمة
 * الكتالوج مخزّنة بـ«بيضاء/سوداء…»، ودائرة اللون يجب أن تطابق النص المكتوب دائماً.
 * تُبثّ للواجهات ضمن /vehicle-catalog كي يبقى الجدول بمصدر واحد.
 */
export const VEHICLE_COLOR_ALIASES: Readonly<Record<string, readonly string[]>> = {
  "أبيض": ["بيضاء", "بيضا"],
  "أسود": ["سوداء", "سودا"],
  "فضي": ["فضية"],
  "رمادي": ["رمادية", "رصاصي", "رصاصية"],
  "أزرق": ["زرقاء", "زرقا"],
  "أحمر": ["حمراء", "حمرا"],
  "أخضر": ["خضراء", "خضرا"],
  "بني": ["بنية"],
  "ذهبي": ["ذهبية"],
  "برتقالي": ["برتقالية"],
  "عنابي": ["عنابية"],
  "أصفر": ["صفراء", "صفرا"]
};

/** توحيد كتابة اللون قبل المطابقة: تشكيل/تطويل، همزات الألف، تاء مربوطة، ألف مقصورة */
function normColorName(s: string): string {
  return s
    .trim()
    .replace(/[ً-ْـ]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي");
}

const COLOR_HEX_INDEX = new Map<string, string>();
for (const c of VEHICLE_COLORS) {
  COLOR_HEX_INDEX.set(normColorName(c.name_ar), c.hex);
  for (const alias of VEHICLE_COLOR_ALIASES[c.name_ar] ?? []) {
    COLOR_HEX_INDEX.set(normColorName(alias), c.hex);
  }
}

/** hex لون السيارة من اسمه العربي — متسامح مع الهمزات وصيغ المؤنث الشائعة */
export function vehicleColorHex(name_ar: string): string | null {
  return COLOR_HEX_INDEX.get(normColorName(name_ar)) ?? null;
}
