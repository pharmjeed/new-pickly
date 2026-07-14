/**
 * القرطاس المبتسم — كاركتر بيكلي الرسمي («اخر اخر هوية» v2.0)
 *
 * الأشكال:
 *  - <QirtasBadge/>  الشارة الكاملة (مربع ليموني + حدّ كحلي + خطوط سرعة وردية + القرطاس) — الشعار/الأيقونة
 *  - <QirtasMono/>   النسخة الأحادية المفرغة بلون currentColor — أسطح ملوّنة وطباعة
 *  - <Qirtas/>       القرطاس الحر بلا شارة وبأمزجة متعددة — الحالات الفارغة/الأخطاء/الاحتفالات
 *  - <SpeedLines/>   نمط الخطوط الثلاثة (زخرفة/فاصل/تحميل)
 *  - <QirtasLoader/> مؤشر التحميل الرسمي: الخطوط الوردية تتلألأ تتابعياً (بديل الدوائر الدوارة)
 *  - <Wordmark/>     الاسم الثنائي pickly فوق بيكلي (Baloo 800/700)
 *
 * قواعد ثابتة (كتاب الهوية §5): الوجه لا يُحذف، القاعدة المسنّنة لا تتغيّر،
 * الخطوط الوردية الثلاثة على يسار القرطاس بتلاشٍ ١٠٠/٥٥/٣٠٪، الميلان ٧° نحو الحركة،
 * خلفية الشارة ليمونية دائماً عدا النسخة الأحادية.
 */
import type { CSSProperties, ReactNode } from "react";

const INK = "var(--pk-ink-900, #0E1B3D)";
const LIME = "var(--pk-lime-500, #C8F542)";
const PINK = "var(--pk-pink-500, #FF4D9D)";

export type QirtasMood = "happy" | "excited" | "wink" | "sleepy" | "sad";

/** وجه القرطاس حسب المزاج — يُرسم داخل مجموعة الميلان ٧° */
function Face({ mood, stroke }: { mood: QirtasMood; stroke: string }) {
  switch (mood) {
    case "excited": // لحظة «وصلت» — عينان واسعتان وفم مفتوح فرحاً
      return (
        <>
          <circle cx="144" cy="112" r="9" fill={stroke} />
          <circle cx="176" cy="112" r="9" fill={stroke} />
          <path d="M138 138 Q160 172 182 138 Z" fill={stroke} stroke={stroke} strokeWidth="6" strokeLinejoin="round" />
        </>
      );
    case "wink": // غمزة — للمواضع المرحة (التقييم، النصائح)
      return (
        <>
          <path d="M134 112 L154 112" fill="none" stroke={stroke} strokeWidth="9" strokeLinecap="round" />
          <circle cx="176" cy="112" r="7.5" fill={stroke} />
          <path d="M142 140 Q160 160 178 140" fill="none" stroke={stroke} strokeWidth="9" strokeLinecap="round" />
        </>
      );
    case "sleepy": // نعسان — الحالات الفارغة (لا طلبات بعد)
      return (
        <>
          <path d="M134 110 Q144 120 154 110" fill="none" stroke={stroke} strokeWidth="8" strokeLinecap="round" />
          <path d="M166 110 Q176 120 186 110" fill="none" stroke={stroke} strokeWidth="8" strokeLinecap="round" />
          <path d="M152 146 Q160 154 168 146" fill="none" stroke={stroke} strokeWidth="8" strokeLinecap="round" />
        </>
      );
    case "sad": // متأسف — الأخطاء وتعذُّر النتائج (بلا لوم للعميل)
      return (
        <>
          <circle cx="144" cy="112" r="7.5" fill={stroke} />
          <circle cx="176" cy="112" r="7.5" fill={stroke} />
          <path d="M142 156 Q160 138 178 156" fill="none" stroke={stroke} strokeWidth="9" strokeLinecap="round" />
        </>
      );
    default: // happy — الوجه الرسمي للشعار
      return (
        <>
          <circle cx="144" cy="112" r="7.5" fill={stroke} />
          <circle cx="176" cy="112" r="7.5" fill={stroke} />
          <path d="M142 140 Q160 160 178 140" fill="none" stroke={stroke} strokeWidth="9" strokeLinecap="round" />
        </>
      );
  }
}

/** جسم القرطاس (القاعدة المسنّنة + الغطاء) داخل ميلان ٧° — هندسة الشعار حرفياً */
function Bag({ mood, stroke, fill }: { mood: QirtasMood; stroke: string; fill: string }) {
  return (
    <g transform="rotate(7 144 124)">
      <path d="M88 84 L116 66 L102 42 Z" fill={fill} stroke={stroke} strokeWidth="7" strokeLinejoin="round" />
      <path d="M88 84 L116 66 L116 192 L88 204 Z" fill={fill} stroke={stroke} strokeWidth="7" strokeLinejoin="round" />
      <path
        d="M116 62 L200 62 L200 182 L189.5 196 L179 182 L168.5 196 L158 182 L147.5 196 L137 182 L126.5 196 L116 182 Z"
        fill={fill}
        stroke={stroke}
        strokeWidth="7"
        strokeLinejoin="round"
      />
      <Face mood={mood} stroke={stroke} />
    </g>
  );
}

/** خطوط السرعة الثلاثة داخل لوحة الشعار (يسار القرطاس، تلاشٍ ١٠٠/٥٥/٣٠٪) */
function BadgeSpeedLines({ stroke }: { stroke: string }) {
  return (
    <g stroke={stroke} strokeWidth="11" strokeLinecap="butt">
      <line x1="22" y1="94" x2="78" y2="94" />
      <line x1="22" y1="126" x2="66" y2="126" opacity="0.55" />
      <line x1="22" y1="158" x2="54" y2="158" opacity="0.3" />
    </g>
  );
}

/** الشارة الكاملة — الشعار الرسمي وأيقونة التطبيق */
export function QirtasBadge({
  size = 64,
  mood = "happy",
  title = "بيكلي",
  style
}: {
  size?: number;
  mood?: QirtasMood;
  title?: string;
  style?: CSSProperties;
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 240 240" role="img" aria-label={title} style={style}>
      <rect x="0" y="0" width="240" height="240" rx="52" fill={LIME} />
      <rect x="5" y="5" width="230" height="230" rx="48" fill="none" stroke={INK} strokeWidth="7" />
      <BadgeSpeedLines stroke={PINK} />
      <Bag mood={mood} stroke={INK} fill="#FFFFFF" />
    </svg>
  );
}

/** النسخة الأحادية المفرغة — تتبع currentColor (فوق الداكن/الملوّن/الطباعة) */
export function QirtasMono({
  size = 24,
  mood = "happy",
  style
}: {
  size?: number;
  mood?: QirtasMood;
  style?: CSSProperties;
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 240 240" aria-hidden="true" style={style}>
      <rect x="5" y="5" width="230" height="230" rx="48" fill="none" stroke="currentColor" strokeWidth="7" />
      <BadgeSpeedLines stroke="currentColor" />
      <Bag mood={mood} stroke="currentColor" fill="none" />
    </svg>
  );
}

/**
 * القرطاس الحر — الكاركتر بلا شارة، للحالات الفارغة والأخطاء والاحتفالات.
 * lines: إظهار خطوط السرعة (تُخفى في المواضع الساكنة كالحالات الفارغة).
 */
export function Qirtas({
  size = 96,
  mood = "happy",
  lines = false,
  title,
  style
}: {
  size?: number;
  mood?: QirtasMood;
  lines?: boolean;
  title?: string;
  style?: CSSProperties;
}) {
  const vb = lines ? "14 26 202 186" : "72 26 144 186";
  const vbW = lines ? 202 : 144;
  const vbH = 186;
  return (
    <svg
      width={Math.round((size * vbW) / vbH)}
      height={size}
      viewBox={vb}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      style={style}
    >
      {lines && <BadgeSpeedLines stroke={PINK} />}
      <Bag mood={mood} stroke={INK} fill="var(--pk-surface, #FFFFFF)" />
    </svg>
  );
}

/**
 * نمط الخطوط الثلاثة — زخرفة وفاصل، وعند animated يصير مؤشر التحميل الرسمي
 * (تتلألأ تتابعياً ١ ثم ٢ ثم ٣ كموجة — كتاب الهوية §10).
 */
export function SpeedLines({
  width = 50,
  color = PINK,
  animated = false,
  style
}: {
  width?: number;
  color?: string;
  animated?: boolean;
  style?: CSSProperties;
}) {
  const h = Math.round((width * 44) / 50);
  return (
    <svg width={width} height={h} viewBox="0 0 50 44" aria-hidden="true" style={style}>
      <rect x="8" y="8" width="34" height="7" fill={color}>
        {animated && <animate attributeName="opacity" values="1;.25;1" dur="1.2s" repeatCount="indefinite" />}
      </rect>
      <rect x="8" y="19" width="27" height="7" fill={color} opacity="0.55">
        {animated && <animate attributeName="opacity" values=".25;1;.25" dur="1.2s" begin=".2s" repeatCount="indefinite" />}
      </rect>
      <rect x="8" y="30" width="20" height="7" fill={color} opacity="0.3">
        {animated && <animate attributeName="opacity" values=".25;1;.25" dur="1.2s" begin=".4s" repeatCount="indefinite" />}
      </rect>
    </svg>
  );
}

/** مؤشر التحميل الرسمي — بديل كل الدوائر الدوارة في الواجهات */
export function QirtasLoader({
  size = 56,
  label = "جارٍ التحميل",
  style
}: {
  size?: number;
  label?: string;
  style?: CSSProperties;
}) {
  return (
    <span role="status" aria-label={label} style={{ display: "inline-flex", ...style }}>
      <SpeedLines width={size} animated />
    </span>
  );
}

/** الاسم الثنائي — pickly (وزن 800) فوق بيكلي (وزن 700) بخط العرض */
export function Wordmark({
  size = 22,
  color = "currentColor",
  style
}: {
  size?: number;
  color?: string;
  style?: CSSProperties;
}) {
  return (
    <span
      dir="ltr"
      style={{
        display: "inline-flex",
        flexDirection: "column",
        textAlign: "left",
        lineHeight: 1,
        fontFamily: "var(--pk-font-display)",
        color,
        ...style
      }}
    >
      <span style={{ fontWeight: 800, fontSize: size }}>pickly</span>
      <span style={{ fontWeight: 700, fontSize: Math.round(size * 0.78), lineHeight: 1.35 }}>بيكلي</span>
    </span>
  );
}

/** شعار أفقي جاهز: الاسم الثنائي بجوار الشارة (الشارة تلي الاسم في RTL) */
export function LogoLockup({
  badge = 40,
  mood = "happy",
  color = "currentColor",
  style
}: {
  badge?: number;
  mood?: QirtasMood;
  color?: string;
  style?: CSSProperties;
}) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: Math.round(badge * 0.25), ...style }}>
      <QirtasBadge size={badge} mood={mood} />
      <Wordmark size={Math.round(badge * 0.55)} color={color} />
    </span>
  );
}

/** حاوية حالة فارغة/خطأ موحّدة حول الكاركتر — استخدام اختياري */
export function QirtasEmpty({
  mood = "sleepy",
  size = 110,
  children,
  style
}: {
  mood?: QirtasMood;
  size?: number;
  children?: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, textAlign: "center", ...style }}>
      <Qirtas mood={mood} size={size} />
      {children}
    </div>
  );
}
