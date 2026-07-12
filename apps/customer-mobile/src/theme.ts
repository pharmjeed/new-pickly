/**
 * Pickly — theme.ts
 * كل رموز design/tokens.css كثوابت TypeScript — القيم منقولة حرفياً.
 * قاعدة: لا لون ولا خط ولا مقاس خارج هذا الملف.
 */

/* ---- الألوان الأساسية (--pk-*) ---- */
export const colors = {
  lime500: "#C9F339", // الشارة والأزرار والحالات الحية
  lime300: "#DDF87A", // hover وتمييز
  lime100: "#F2FCD1", // خلفيات ناعمة وشرائح
  lime900: "#5E7A12", // نص فوق الليموني
  ink900: "#10241B", // النصوص / وضع القيادة / الداكن
  ink700: "#1C3329", // بطاقات فوق الداكن
  ink600: "#2E4A3C", // عناصر ثانوية داكنة
  success: "#1D9E75", // نجاح — تم رصد الوصول
  warn: "#EF9F27", // تنبيه — انتظار وتجهيز
  error: "#E24B4A", // خطأ — فشل GPS أو الدفع
  white: "#FFFFFF", // الخلفية الأساسية
  cloud: "#F4F7F2", // أقسام ثانوية
  line: "#E3E8E0", // حدود
  gray: "#6E7A72", // نص ثانوي على أبيض (الحد الأدنى)
  gray2: "#8FA398" // نص ثانوي على داكن
} as const;

/* ---- ألوان أولوية بطاقات شاشة الفرع (08§2 بدرجات الهوية) ---- */
export const statusColors = {
  new: "#6E7A72",
  newBg: "#F4F7F2",
  prep: "#2E4A3C",
  prepBg: "#E9EFEA",
  near: "#C9F339",
  nearBg: "#F2FCD1",
  arrived: "#EF9F27",
  arrivedBg: "#FCF0DB",
  overdue: "#E24B4A",
  overdueBg: "#FBE5E4",
  done: "#1D9E75",
  doneBg: "#E2F3ED"
} as const;

/* ---- الخطوط (أسماء الرموز كما في tokens.css — التحميل الفعلي عبر expo-font لاحقاً) ---- */
export const fonts = {
  display: "'Baloo Bhaijaan 2','IBM Plex Sans Arabic',sans-serif",
  body: "'IBM Plex Sans Arabic',sans-serif",
  mono: "'IBM Plex Mono',monospace"
} as const;

/* ---- سلم المقاسات (عميل 12/14/16/20/24/32 · فرع 18/28/40/48) ----
   مكبّر درجة (+1 للنصوص، +2 للعناوين) بقرار المالك 2026-07-12 —
   الأسماء ثابتة كمراجع للسلم الأصلي (مطابق لتكبير tokens.css في customer-web) */
export const fs = {
  fs12: 13,
  fs13: 14,
  fs14: 15,
  fs15: 16,
  fs16: 17,
  fs17: 18,
  fs20: 22,
  fs24: 26,
  fs32: 34,
  fs34: 36,
  bMin: 18, // شاشة الفرع: الأدنى
  bCard: 28, // بطاقات الوصول 28–40
  bCardLg: 40,
  bPlate: 48 // اللوحة المختصرة 48 عريض Mono
} as const;

/* ---- الشبكة والأشكال ---- */
export const space = 4; // الوحدة
export const radius = 12; // البطاقات والأزرار
export const radiusLg = 20;
export const radiusPill = 999; // الشارات
export const touch = 44; // هدف لمس العميل
export const touchBranch = 56; // هدف لمس شاشة الفرع

/* ---- الحركة ---- */
export const motion = {
  skewDeg: -8, // زاوية الحركة (--pk-skew:-8deg)
  skew: "-8deg",
  ease: [0.2, 0.8, 0.2, 1] as const, // cubic-bezier(.2,.8,.2,1)
  duration: 200, // 150–250ms
  fade1: 1,
  fade2: 0.55,
  fade3: 0.3 // تلاشي الخطوط الثلاثة
} as const;

/* ---- ظلال (خفيفة — الأزرار بلا ظلال) ---- */
export const shadow1 = {
  shadowColor: colors.ink900,
  shadowOffset: { width: 0, height: 1 },
  shadowOpacity: 0.06,
  shadowRadius: 2,
  elevation: 1
} as const;
export const shadow2 = {
  shadowColor: colors.ink900,
  shadowOffset: { width: 0, height: 10 },
  shadowOpacity: 0.12,
  shadowRadius: 30,
  elevation: 8
} as const;

/* ---- رموز دلالية (الوضع الفاتح — افتراضي) ---- */
export const light = {
  bg: colors.cloud,
  surface: colors.white,
  text: colors.ink900,
  text2: colors.gray,
  border: colors.line
} as const;

/* ---- الوضع الداكن (وضع القيادة في التتبع) ---- */
export const dark = {
  bg: colors.ink900,
  surface: colors.ink700,
  text: colors.cloud,
  text2: colors.gray2,
  border: colors.ink600,
  stNewBg: "#243830",
  stPrepBg: "#263B31",
  stNearBg: "#31402A",
  stArrivedBg: "#3E3322",
  stOverdueBg: "#3E2726",
  stDoneBg: "#1F3D33"
} as const;
