/**
 * Pickly — theme.ts · الهوية الفنكية v2.0
 * كل رموز design/tokens.css كثوابت TypeScript — القيم منقولة حرفياً.
 * المصدر: «اخر اخر هوية»/pickly-brand-book.html §6 §7 §13.
 * قاعدة: لا لون ولا خط ولا مقاس خارج هذا الملف.
 */

/* ---- الألوان الأساسية (--pk-*) ---- */
export const colors = {
  lime500: "#C8F542", // ليموني فسفوري — محجوز لإشارة «وصلت»/النجاح/الدفع
  lime300: "#DDF77E", // hover وتمييز
  lime100: "#EBF9B8", // خلفيات ناعمة وشرائح
  lime900: "#0E1B3D", // نص فوق الليموني — كحلي (تباين >12:1)
  ink900: "#0E1B3D", // كحلي — النصوص / رسم الشارة / وضع القيادة
  ink700: "#17264A", // بطاقات فوق الداكن
  ink600: "#4A5A7C", // عناصر ثانوية داكنة
  blue500: "#0B63CE", // الأزرق الصارخ — الفعل: أزرار رئيسية وإبرازات وأرقام
  blue600: "#0A57B5", // أزرق مضغوط/بديل hover
  pink500: "#FF4D9D", // الوردي البنكي — الطاقة: خطوط السرعة والمحمّل والزخارف
  success: "#12A472", // نجاح — تم رصد الوصول
  warn: "#FF9E1B", // تنبيه — انتظار وتجهيز
  error: "#E5322B", // خطأ — فشل GPS أو الدفع
  white: "#FFFFFF", // أسطح البطاقات
  cloud: "#F7F3E9", // عاجي — الخلفية الأساسية
  cloud2: "#EFEADB", // عاجي أغمق — أقسام ثانوية
  line: "#E7E0CE", // فواصل خفيفة (الحدود الفنكية كحلية بسماكة bw2/bw3)
  gray: "#5B6A85", // نص ثانوي على أبيض (الحد الأدنى للتباين)
  gray2: "#8891B5", // نص ثانوي على داكن
  live: "#35E0FF" // سماوي — إشارة حية (استخدام ضيق)
} as const;

/* ---- ألوان أولوية بطاقات شاشة الفرع (08§2 بدرجات الهوية الفنكية) ---- */
export const statusColors = {
  new: "#4A5A7C",
  newBg: "#EFEADB",
  prep: "#0B63CE",
  prepBg: "#DEEBFB",
  near: "#C8F542",
  nearBg: "#EBF9B8",
  arrived: "#FF9E1B",
  arrivedBg: "#FFEFD6",
  overdue: "#E5322B",
  overdueBg: "#FBDFDD",
  done: "#12A472",
  doneBg: "#DFF3EA"
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
export const radius = 12; // الأزرار والحقول
export const radiusMd = 16; // بطاقات صغيرة
export const radiusLg = 20; // البطاقات
export const radiusPill = 999; // الشارات
export const touch = 48; // هدف لمس العميل (استخدام داخل سيارة — كتاب الهوية §11)
export const touchBranch = 56; // هدف لمس شاشة الفرع

/* ---- التوقيع الفنكي: حدود كحلية سميكة + ظل صلب مزاح ---- */
export const bw2 = 2; // حدود المكونات (--pk-b2)
export const bw3 = 3; // حدود البطاقات البارزة (--pk-b3)
export const tiltDeg = 7; // ميلان القرطاس نحو الحركة (--pk-tilt)
export const stickerTiltDeg = -2; // ميلان الملصقات المرحة (--pk-sticker-tilt)

/* ---- الحركة ---- */
export const motion = {
  tilt: "7deg", // --pk-tilt — ميلان القرطاس (بديل الانحراف القديم)
  ease: [0.2, 0.8, 0.2, 1] as const, // cubic-bezier(.2,.8,.2,1)
  duration: 200, // 150–250ms
  fade1: 1,
  fade2: 0.55,
  fade3: 0.3 // تلاشي خطوط السرعة الثلاثة
} as const;

/* ---- الظل الصلب الفنكي (offset بلا ضبابية — --pk-pop*) ---- */
export const popXs = {
  shadowColor: colors.ink900,
  shadowOffset: { width: 2, height: 2 },
  shadowOpacity: 1,
  shadowRadius: 0,
  elevation: 2
} as const;
export const popSm = {
  shadowColor: colors.ink900,
  shadowOffset: { width: 4, height: 4 },
  shadowOpacity: 1,
  shadowRadius: 0,
  elevation: 4
} as const;
export const pop = {
  shadowColor: colors.ink900,
  shadowOffset: { width: 6, height: 6 },
  shadowOpacity: 1,
  shadowRadius: 0,
  elevation: 6
} as const;
/* فوق الأسطح الداكنة يصير الظل ليمونياً (كتاب الهوية §8) */
export const popLime = {
  shadowColor: colors.lime500,
  shadowOffset: { width: 6, height: 6 },
  shadowOpacity: 1,
  shadowRadius: 0,
  elevation: 6
} as const;
/* أسماء قديمة مُبقاة كمراجع للظل الجديد — الأزرار الفنكية تستخدم popSm */
export const shadow1 = popXs;
export const shadow2 = pop;

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
  stNewBg: "#20305B",
  stPrepBg: "#12305E",
  stNearBg: "#33421A",
  stArrivedBg: "#3D2F10",
  stOverdueBg: "#3D1715",
  stDoneBg: "#0F3328"
} as const;
