/**
 * حركات القرطاس — طبقة الحياة فوق الكاركتر الرسمي (qirtas.tsx)
 * توجيه المالك 2026-07-14: نفس الهوية الفنكية بحركة وديناميكية أكثر (مرجع لوحتي العرض).
 *
 * الأشكال:
 *  - <QirtasLive/>      القرطاس بأطراف حية: يمشي/يلوّح/يحتفل/ينام — بقبعة موظف وكيس بيكلي اختياريين
 *  - <QirtasEmptyLive/> حالة فارغة حية (بديل QirtasEmpty الساكن): نعسان بـZzz عائمة أو متأسف
 *  - <HandoffScene/>    مشهد «الموظف متجه إليك»: قرطاس بقبعة يحمل الكيس نحو سيارة العميل
 *  - <ConfettiBurst/>   كونفيتي احتفالي بألوان الهوية — غلاف مطلق فوق أي بطاقة
 *
 * قواعد الكاركتر محفوظة (كتاب الهوية §5): الوجه والقاعدة المسنّنة من Bag الرسمي حرفياً،
 * الميلان ٧°، وخطوط السرعة الوردية الثلاثة بتلاشي ١٠٠/٥٥/٣٠٪ على يسار الحركة.
 * كل الألوان رموز من tokens.css، وكل الحركات تحترم prefers-reduced-motion (عبر CSS حصراً).
 */
import type { CSSProperties, ReactNode } from "react";
import { Bag, type QirtasMood } from "./qirtas";
import m from "./qirtas-motion.module.css";

const INK = "var(--pk-ink-900, #0E1B3D)";
const LIME = "var(--pk-lime-500, #C8F542)";
const PINK = "var(--pk-pink-500, #FF4D9D)";

export type QirtasPose = "walk" | "wave" | "celebrate" | "idle" | "sleep";

/* ---- أطراف مساعدة (خطوط كحلية مستديرة الأطراف بسماكة أطراف الكاركتر) ---- */

function LimbPath({ d }: { d: string }) {
  return <path d={d} fill="none" stroke={INK} strokeWidth="9" strokeLinecap="round" />;
}

/** رجل بحذاء صغير — origin عند الورك ليدور منها المشي */
function Leg({
  hipX,
  hipY,
  cls,
  bend
}: {
  hipX: number;
  hipY: number;
  cls?: string;
  bend: number; // انحناء بسيط يفرّق الرجلين في الوقفة الساكنة
}) {
  return (
    <g className={cls ? `${m.leg} ${cls}` : m.leg} style={{ transformOrigin: `${hipX}px ${hipY}px` }}>
      <LimbPath d={`M${hipX} ${hipY} q${bend} 18 ${bend * 1.5} 32`} />
      {/* الحذاء: مقدمة للأمام (يمين اتجاه الحركة) */}
      <path
        d={`M${hipX + bend * 1.5 - 3} ${hipY + 30} q-1 8 14 7`}
        fill="none"
        stroke={INK}
        strokeWidth="9"
        strokeLinecap="round"
      />
    </g>
  );
}

/** خطوط السرعة الوردية الثلاثة خلف الحركة — تتلألأ تتابعياً كنبض المحمّل الرسمي */
function MotionLines() {
  return (
    <g fill={PINK}>
      <rect className={m.line1} x="12" y="104" width="54" height="10" />
      <rect className={m.line2} x="12" y="130" width="42" height="10" opacity="0.55" />
      <rect className={m.line3} x="12" y="156" width="30" height="10" opacity="0.3" />
    </g>
  );
}

/** قبعة موظف التجهيز — داخل ميلان الكاركتر نفسه لتجلس على رأس الكيس */
function ChefCap() {
  return (
    <g transform="rotate(7 144 124)">
      <path d="M122 58 Q158 26 194 58 Z" fill={INK} stroke={INK} strokeWidth="6" strokeLinejoin="round" />
      <rect x="112" y="54" width="92" height="11" rx="5.5" fill={INK} />
      <circle cx="158" cy="34" r="6" fill={LIME} stroke={INK} strokeWidth="3" />
    </g>
  );
}

/** كيس بيكلي الليموني المصغّر في اليد — بوجه القرطاس المبتسم */
function HandBag() {
  return (
    <g className={m.handBag} style={{ transformOrigin: "215px 166px" }}>
      <path d="M206 173 q9 -14 18 0" fill="none" stroke={INK} strokeWidth="3.5" />
      <path
        d="M197 173 h36 l3.4 32 a8 8 0 0 1 -8 8 h-26.8 a8 8 0 0 1 -8 -8 Z"
        fill={LIME}
        stroke={INK}
        strokeWidth="3.5"
        strokeLinejoin="round"
      />
      <circle cx="209" cy="191" r="2.3" fill={INK} />
      <circle cx="221" cy="191" r="2.3" fill={INK} />
      <path d="M208 198 q7 6 14 0" fill="none" stroke={INK} strokeWidth="2.5" strokeLinecap="round" />
    </g>
  );
}

/** قلوب ونجوم الاحتفال — تطفو وتتلاشى حول القرطاس */
function CelebrationSparks() {
  const heart =
    "M0 4 C0 1 4 -1.5 6 1.5 C8 -1.5 12 1 12 4 C12 8 6 12.5 6 12.5 C6 12.5 0 8 0 4 Z";
  const star = "M7 0 l2 5 5 2 -5 2 -2 5 -2 -5 -5 -2 5 -2 Z";
  return (
    <g>
      <path className={`${m.spark} ${m.spark1}`} d={heart} fill={PINK} transform="translate(78 74)" />
      <path className={`${m.spark} ${m.spark2}`} d={star} fill={LIME} stroke={INK} strokeWidth="1.5" transform="translate(210 56)" />
      <path className={`${m.spark} ${m.spark3}`} d={heart} fill={PINK} transform="translate(228 108) scale(0.85)" />
      <path className={`${m.spark} ${m.spark4}`} d={star} fill={PINK} transform="translate(120 44) scale(0.8)" />
    </g>
  );
}

/** حرف Z مرسوم (لا نص كي لا نعتمد على خط) — للقرطاس النائم */
function Zzz() {
  const z = "M0 0 h11 l-11 11 h11";
  return (
    <g fill="none" stroke={INK} strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
      <path className={`${m.zz} ${m.zz1}`} d={z} transform="translate(206 74)" />
      <path className={`${m.zz} ${m.zz2}`} d={z} transform="translate(224 56) scale(0.8)" />
      <path className={`${m.zz} ${m.zz3}`} d={z} transform="translate(238 42) scale(0.6)" />
    </g>
  );
}

/**
 * جسد القرطاس الحي كاملاً (مجموعة SVG) — يُستخدم داخل QirtasLive والمشاهد المركّبة.
 * إحداثيات فضاء الشارة 250×226 تقريباً (viewBox "0 16 250 226").
 */
export function QirtasFigure({
  mood = "happy",
  pose = "idle",
  carrying = false,
  cap = false,
  lines = false
}: {
  mood?: QirtasMood;
  pose?: QirtasPose;
  carrying?: boolean;
  cap?: boolean;
  lines?: boolean;
}) {
  const walking = pose === "walk";
  const bodyCls =
    pose === "celebrate" ? `${m.body} ${m.bodyJump}` : walking ? `${m.body} ${m.bodyWalk}` : `${m.body} ${m.bodyIdle}`;

  /* الذراع الخلفية (يسار) والأمامية (يمين اتجاه الحركة) حسب الوضعية */
  const backArm = (() => {
    if (pose === "celebrate")
      return (
        <g className={`${m.arm} ${m.armUp}`} style={{ transformOrigin: "99px 128px" }}>
          <LimbPath d="M99 128 q-17 -10 -22 -28" />
        </g>
      );
    if (pose === "wave" && carrying)
      return (
        <g className={`${m.arm} ${m.armWave}`} style={{ transformOrigin: "99px 128px" }}>
          <LimbPath d="M99 128 q-19 -8 -26 -26" />
        </g>
      );
    if (walking)
      return (
        <g className={`${m.arm} ${m.armSwing}`} style={{ transformOrigin: "99px 128px" }}>
          <LimbPath d="M99 130 q-15 15 -11 33" />
        </g>
      );
    return (
      <g className={m.arm}>
        <LimbPath d="M99 130 q-15 15 -11 33" />
      </g>
    );
  })();

  const frontArm = (() => {
    if (carrying)
      return (
        <g className={m.arm}>
          <LimbPath d="M200 130 q17 13 15 33" />
        </g>
      );
    if (pose === "celebrate")
      return (
        <g className={`${m.arm} ${m.armUp}`} style={{ transformOrigin: "200px 128px" }}>
          <LimbPath d="M200 128 q17 -10 22 -28" />
        </g>
      );
    if (pose === "wave")
      return (
        <g className={`${m.arm} ${m.armWave}`} style={{ transformOrigin: "200px 128px" }}>
          <LimbPath d="M200 128 q19 -8 26 -26" />
        </g>
      );
    if (walking)
      return (
        <g
          className={`${m.arm} ${m.armSwing}`}
          style={{ transformOrigin: "200px 128px", animationDelay: "-0.31s" }}
        >
          <LimbPath d="M200 130 q15 15 11 33" />
        </g>
      );
    return (
      <g className={m.arm}>
        <LimbPath d="M200 130 q15 15 11 33" />
      </g>
    );
  })();

  return (
    <g>
      {lines && <MotionLines />}
      {pose === "celebrate" && <CelebrationSparks />}
      {pose === "sleep" && <Zzz />}
      <g className={bodyCls}>
        {/* الرجلان تحت الجسد */}
        <Leg hipX={112} hipY={188} bend={-2} cls={walking ? m.legA : undefined} />
        <Leg hipX={168} hipY={189} bend={2} cls={walking ? m.legB : undefined} />
        {backArm}
        {/* الجسد الرسمي حرفياً — الوجه والقاعدة المسنّنة والميلان ٧° */}
        <Bag mood={mood} stroke={INK} fill="var(--pk-white, #FFFFFF)" />
        {cap && <ChefCap />}
        {frontArm}
        {carrying && <HandBag />}
      </g>
    </g>
  );
}

/** القرطاس الحي — الكاركتر بأطراف متحركة حسب الوضعية */
export function QirtasLive({
  size = 120,
  mood = "happy",
  pose = "idle",
  carrying = false,
  cap = false,
  lines = false,
  title,
  style
}: {
  size?: number;
  mood?: QirtasMood;
  pose?: QirtasPose;
  carrying?: boolean;
  cap?: boolean;
  lines?: boolean;
  title?: string;
  style?: CSSProperties;
}) {
  const VB_W = 250;
  const VB_H = 226;
  return (
    <svg
      width={Math.round((size * VB_W) / VB_H)}
      height={size}
      viewBox="0 16 250 226"
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      style={{ overflow: "visible", ...style }}
    >
      <QirtasFigure mood={mood} pose={pose} carrying={carrying} cap={cap} lines={lines} />
    </svg>
  );
}

/**
 * حالة فارغة حية — بديل QirtasEmpty الساكن:
 * sleepy → نائم بـZzz عائمة · sad → متأسف بتمايل هادئ · غيرها → وقفة هادئة
 */
export function QirtasEmptyLive({
  mood = "sleepy",
  size = 120,
  children,
  style
}: {
  mood?: QirtasMood;
  size?: number;
  children?: ReactNode;
  style?: CSSProperties;
}) {
  const pose: QirtasPose = mood === "sleepy" ? "sleep" : "idle";
  return (
    <div
      style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, textAlign: "center", ...style }}
    >
      <QirtasLive mood={mood} pose={pose} size={size} />
      {children}
    </div>
  );
}

/**
 * مشهد «الموظف متجه إليك» — قرطاس بقبعة التجهيز يحمل كيس بيكلي ويمشي
 * نحو سيارة العميل، بأرض منقّطة تزحف ودبوس التقاء ينبض فوق السيارة.
 */
export function HandoffScene({ title = "الموظف متجه إليك حاملاً طلبك", style }: { title?: string; style?: CSSProperties }) {
  return (
    <svg
      viewBox="0 0 360 170"
      role="img"
      aria-label={title}
      style={{ display: "block", width: "100%", height: "auto", overflow: "visible", ...style }}
    >
      {/* الأرض المنقّطة تزحف عكس الحركة — إحساس التقدّم */}
      <line
        className={m.road}
        x1="14"
        y1="152"
        x2="346"
        y2="152"
        stroke={INK}
        strokeOpacity="0.35"
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray="2 11"
      />

      {/* دبوس نقطة الالتقاء فوق السيارة */}
      <g className={m.pinDrop} style={{ transformOrigin: "300px 78px" }}>
        <g transform="translate(300 72)">
          <path
            d="M0 -20 C-9 -20 -14.5 -13 -14.5 -5.5 C-14.5 4.5 0 20 0 20 C0 20 14.5 4.5 14.5 -5.5 C14.5 -13 9 -20 0 -20 Z"
            fill={PINK}
            stroke={INK}
            strokeWidth="3"
            strokeLinejoin="round"
          />
          <circle cx="0" cy="-6" r="4.5" fill="var(--pk-white, #FFFFFF)" stroke={INK} strokeWidth="2" />
        </g>
      </g>

      {/* سيارة العميل — تتنفس بهدوء وهي واقفة */}
      <g className={m.car} style={{ transformOrigin: "300px 130px" }}>
        <g transform="translate(252 106) scale(1.35)">
          <path
            d="M4 26 L6 19.5 Q7 16.5 12 16 L30 15.6 L37.5 8 Q39.5 6 43.5 6 L57 6 Q65.5 6 68.4 17.5 L70 24 Q70.2 26 68 26 Z"
            fill={INK}
          />
          <circle cx="18" cy="28" r="6" fill={INK} stroke={LIME} strokeWidth="2.6" />
          <circle cx="56" cy="28" r="6" fill={INK} stroke={LIME} strokeWidth="2.6" />
          {/* نافذة صغيرة تلمّح للعميل داخل سيارته */}
          <path d="M40 9 L38 15 L52 15 L51 9 Z" fill="var(--pk-white, #FFFFFF)" opacity="0.9" />
        </g>
      </g>

      {/* القرطاس الموظف — يمشي بخطوط سرعته نحو السيارة */}
      <g transform="translate(6 4) scale(0.62)">
        <QirtasFigure mood="happy" pose="walk" carrying cap lines />
      </g>
    </svg>
  );
}

/* ---- كونفيتي بألوان الهوية — قطع حتمية (لا عشوائية وقت الرسم = لا فرق ترطيب) ---- */
const CONFETTI_COLORS = [
  "var(--pk-lime-500)",
  "var(--pk-pink-500)",
  "var(--pk-blue-500)",
  "var(--pk-ink-900)",
  "var(--pk-lime-300)"
];

/** كونفيتي احتفالي — يوضع داخل حاوية position:relative ويملؤها */
export function ConfettiBurst({ count = 12, style }: { count?: number; style?: CSSProperties }) {
  const pieces = Array.from({ length: count }, (_, i) => ({
    left: `${(7 + i * 83) % 100}%`,
    delay: `${((i * 23) % 14) / 10}s`,
    dur: `${2.2 + ((i * 37) % 10) / 10}s`,
    color: CONFETTI_COLORS[i % CONFETTI_COLORS.length] as string
  }));
  return (
    <span className={m.confetti} aria-hidden="true" style={style}>
      {pieces.map((p, i) => (
        <i
          key={i}
          style={{ left: p.left, background: p.color, animationDelay: p.delay, animationDuration: p.dur }}
        />
      ))}
    </span>
  );
}
