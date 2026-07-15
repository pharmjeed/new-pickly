/**
 * حركات القرطاس — طبقة الحياة فوق الكاركتر الرسمي (qirtas.tsx)
 * توجيه المالك 2026-07-14: نفس الهوية الفنكية بحركة وديناميكية أكثر (مرجع لوحتي العرض).
 *
 * الأشكال:
 *  - <QirtasLive/>      القرطاس بأطراف حية: يمشي/يلوّح/يحتفل/ينام — بقبعة موظف وكيس بيكلي اختياريين
 *  - <QirtasCook/>      القرطاس الطبّاخ: مريلة ليمونية، يقدّم برجراً يتصاعد بخاره
 *  - <KitchenScene/>    مشهد «المطبخ الحي»: الشيف خلف الكاونتر وقدر يغلي — بطل «جاري تجهيز طلبك» (خيار ١-ب)
 *  - <SentScene/>       مشهد «أُرسل طلبك»: القرطاس يُطلق الطلب طيّارةً ورقية تحلّق حتى باب المطعم — بطل انتظار القبول
 *  - <ReadyScene/>      ملصق «طلبك جاهز» المضغوط: الكيس المربوط يتمايل والقرطاس يلوّح بجانبه
 *  - <MegaphoneScene/>  مشهد «المنادي»: ميغافون ينادي «طلبك جاهز!» والكيس على منصة متوهجة — بطل «جاهز للاستلام» (خيار ٢-هـ)
 *  - <QirtasEmptyLive/> حالة فارغة حية (بديل QirtasEmpty الساكن): نعسان بـZzz عائمة أو متأسف
 *  - <QirtasDrive/>     القرطاس راكب سيارته المكشوفة: عجلات تدور وارتجاج طريق ودخان عادم — بطل الرئيسية
 *  - <HandoffScene/>    مشهد جانبي: قرطاس بقبعة يحمل الكيس نحو سيارة العميل
 *  - <PovScene/>        مشهد «من مقعدك» POV: القرطاس يقترب من زجاجك الأمامي — بطل «الموظف متجه إليك» (خيار ٥-ج)
 *  - <ParkedScene/>     مشهد «الرصف الذكي»: سيارتك تركن في مربع الالتقاء من فوق (خيار ٤-و)
 *  - <WelcomeScene/>    مشهد «يا هلا»: القرطاس يخرج من باب المطعم ملوّحاً لسيارتك الراكنة —
 *                       بطل «وصل قبل الجهوز» (لوحة الوصول المبكر: و + عبارة ٥، اعتماد المالك 2026-07-15)
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

/** كيس بيكلي الليموني المصغّر في اليد — بوجه القرطاس المبتسم (swing: صنف تأرجح بديل) */
function HandBag({ swing }: { swing?: string }) {
  return (
    <g className={swing ?? m.handBag} style={{ transformOrigin: "215px 166px" }}>
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

/* ---- عدّة الطبّاخ: مريلة وبرجر — لمشهد «جاري تجهيز طلبك» ---- */
const WARN = "var(--pk-warn, #FF9E1B)";
const INK700 = "var(--pk-ink-700, #17264A)";

/** مريلة الطبّاخ الليمونية — حمّالتان بزرّين وجيب بدرزة وسطى، داخل ميلان الكاركتر نفسه */
function CookApron() {
  return (
    <g transform="rotate(7 144 124)">
      {/* الحمّالتان تمرّان جانبي الوجه دون مساسه (قاعدة الهوية: الوجه لا يُحجب) */}
      <rect x="119" y="64" width="11" height="98" rx="3" fill={LIME} stroke={INK} strokeWidth="2.5" />
      <rect x="186" y="64" width="11" height="98" rx="3" fill={LIME} stroke={INK} strokeWidth="2.5" />
      {/* صدرية المريلة — تحت الابتسامة وفوق القاعدة المسنّنة (لا تحجب أياً منهما) */}
      <rect x="113" y="158" width="90" height="23" rx="5" fill={LIME} stroke={INK} strokeWidth="2.5" />
      <circle cx="124.5" cy="162" r="4" fill={INK} />
      <circle cx="191.5" cy="162" r="4" fill={INK} />
      {/* الجيب المزدوج */}
      <rect x="142" y="164" width="32" height="12" rx="4" fill="var(--pk-lime-300, #DDF77E)" stroke={INK} strokeWidth="2.5" />
      <path d="M158 164 V176" stroke={INK} strokeWidth="2" />
    </g>
  );
}

/** برجر فنكي على كفّ القرطاس — كعكة برتقالية وخس ليموني وبخار يتصاعد */
function HandBurger() {
  return (
    <g transform="translate(49 72)">
      {/* بخار يتصاعد من الكعكة */}
      <g className={m.steam}>
        <path d="M11 -6 q-4 -6 0 -12 q4 -6 0 -12" />
        <path d="M22 -8 q-4 -6 0 -12 q4 -6 0 -12" />
        <path d="M33 -6 q-4 -6 0 -12 q4 -6 0 -12" />
      </g>
      {/* الكعكة العلوية بحبيبات السمسم */}
      <path d="M2 14 q0 -16 20 -16 q20 0 20 16 Z" fill={WARN} stroke={INK} strokeWidth="2.5" strokeLinejoin="round" />
      <g fill={INK} opacity="0.4">
        <circle cx="15" cy="5" r="1.7" />
        <circle cx="22" cy="2.5" r="1.7" />
        <circle cx="29" cy="5" r="1.7" />
      </g>
      {/* خس ليموني متموّج ثم شريحة اللحم والكعكة السفلية */}
      <path d="M0 14 q5.5 -6 11 0 t11 0 t11 0 t11 0 v5 h-44 Z" fill={LIME} stroke={INK} strokeWidth="2" strokeLinejoin="round" />
      <rect x="1" y="19" width="42" height="7" rx="3.5" fill={INK700} />
      <rect x="2" y="26" width="40" height="9" rx="4.5" fill={WARN} stroke={INK} strokeWidth="2.5" />
    </g>
  );
}

/**
 * القرطاس الطبّاخ — بطل حالة «جاري تجهيز طلبك» (مرجع لوحة العرض):
 * بمريلة ليمونية بحمّالتين وجيب، يرفع بيدٍ برجراً يتصاعد بخاره
 * ويحمل بالأخرى كيس بيكلي يتهادى — تمايل هادئ وذراع تقدّم الطبق بإيقاع التنفّس.
 */
export function QirtasCook({
  size = 170,
  mood = "happy",
  title,
  style
}: {
  size?: number;
  mood?: QirtasMood;
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
      <g className={`${m.body} ${m.bodyIdle}`}>
        <Leg hipX={112} hipY={188} bend={-2} />
        <Leg hipX={168} hipY={189} bend={2} />
        {/* الذراع الخلفية ترفع البرجر وتقدّمه */}
        <g className={m.armServe} style={{ transformOrigin: "99px 128px" }}>
          <LimbPath d="M99 128 q-22 -4 -28 -22" />
          <HandBurger />
        </g>
        {/* الجسد الرسمي حرفياً ثم المريلة فوقه */}
        <Bag mood={mood} stroke={INK} fill="var(--pk-white, #FFFFFF)" />
        <CookApron />
        {/* الذراع الأمامية تحمل كيس بيكلي بتهادٍ */}
        <g className={m.arm}>
          <LimbPath d="M200 130 q17 13 15 33" />
        </g>
        <HandBag swing={m.handBagCalm} />
      </g>
    </svg>
  );
}

/** كيس الطلب المربوط بعقدة وشارة الصح (فضاء 160) — قطعة مشتركة بين مشاهد الجاهزية */
function TiedBag() {
  return (
    <g>
      <path d="M62 56 q18 -30 36 0" fill="none" stroke={INK} strokeWidth="5" strokeLinecap="round" />
      <path d="M74 40 q6 -9 12 0" fill="none" stroke={LIME} strokeWidth="4" strokeLinecap="round" />
      <path d="M50 58 h60 l6 62 a10 10 0 0 1 -10 11 H54 a10 10 0 0 1 -10 -11 Z" fill={INK700} stroke={INK} strokeWidth="2" />
      <path d="M50 58 h60 l1.4 12 H48.6 Z" fill={INK} />
      <rect x="62" y="82" width="36" height="24" rx="6" fill={LIME} />
      <path d="M71 94 l5 5 l10 -12" fill="none" stroke={INK} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </g>
  );
}

/**
 * ملصق «طلبك جاهز» — البطاقة المضغوطة أثناء الرحلة/الوصول:
 * كيس بيكلي المربوط الكبير بشارة الصح يتمايل حول قاعدته فرحاً،
 * والقرطاس المتحمس يلوّح بجانبه «تعال خذه!» — ببريق ليموني ووردي يتلألأ.
 */
export function ReadyScene({
  size = 150,
  title,
  style
}: {
  size?: number;
  title?: string;
  style?: CSSProperties;
}) {
  const VB_W = 340;
  const VB_H = 230;
  const star = "M7 0 l2 5 5 2 -5 2 -2 5 -2 -5 -5 -2 5 -2 Z";
  const heart = "M0 4 C0 1 4 -1.5 6 1.5 C8 -1.5 12 1 12 4 C12 8 6 12.5 6 12.5 C6 12.5 0 8 0 4 Z";
  return (
    <svg
      width={Math.round((size * VB_W) / VB_H)}
      height={size}
      viewBox="0 0 340 230"
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      style={{ overflow: "visible", ...style }}
    >
      {/* بريق يتلألأ حول الكيس — ليموني ووردي (ألوان الهوية الفنكية) */}
      <g transform="translate(150 52)">
        <path className={`${m.spark} ${m.spark1}`} d={star} fill={PINK} />
      </g>
      <g transform="translate(24 84)">
        <path className={`${m.spark} ${m.spark2}`} d={star} fill={LIME} stroke={INK} strokeWidth="1.5" />
      </g>
      <g transform="translate(148 140) scale(0.8)">
        <path className={`${m.spark} ${m.spark3}`} d={heart} fill={PINK} />
      </g>
      <g transform="translate(58 28) scale(0.8)">
        <path className={`${m.spark} ${m.spark4}`} d={star} fill={PINK} />
      </g>

      {/* الكيس المربوط بعقدة وشارة الصح — يتمايل حول قاعدته فرحاً */}
      <g className={m.bagSway}>
        <g transform="translate(-14 15) scale(1.35)">
          <TiedBag />
        </g>
      </g>

      {/* القرطاس المتحمس يلوّح: «تعال خذه!» */}
      <g transform="translate(120 16) scale(0.78)">
        <QirtasFigure mood="excited" pose="wave" />
      </g>
    </svg>
  );
}

/**
 * مشهد «المنادي» — بطل صفحة «جاهز للاستلام» (اختيار المالك 2026-07-15، لوحة الخيارات ٢-هـ):
 * القرطاس يرفع ميغافوناً وردي المقبض وينادي «طلبك جاهز!» بموجات صوت تتسع،
 * وكيس الطلب المربوط واقف على منصة كحلية تتوهج حوله هالة ليمونية.
 */
export function MegaphoneScene({
  title = "طلبك جاهز — ننادي عليك",
  style
}: {
  title?: string;
  style?: CSSProperties;
}) {
  return (
    <svg
      viewBox="0 0 300 196"
      role="img"
      aria-label={title}
      style={{ display: "block", width: "100%", height: "auto", ...style }}
    >
      {/* موجات النداء تتسع من فم الميغافون */}
      <g stroke={INK} strokeWidth="4" fill="none" strokeLinecap="round">
        <path className={m.callWave} d="M120 74 q-16 16 0 32" />
        <path className={`${m.callWave} ${m.callWave2}`} d="M102 62 q-26 28 0 56" />
        <path className={`${m.callWave} ${m.callWave3}`} d="M84 50 q-36 40 0 80" />
      </g>

      {/* فقاعة النداء الليمونية تنبثق مع كل نداء */}
      <g className={m.bubblePop}>
        <rect x="10" y="14" width="96" height="32" rx="12" fill={LIME} stroke={INK} strokeWidth="3" />
        <text
          x="58"
          y="36"
          textAnchor="middle"
          fill={INK}
          style={{ fontFamily: "var(--pk-font-display)", fontWeight: 800, fontSize: 15 }}
        >
          طلبك جاهز!
        </text>
      </g>

      {/* الميغافون يهتز مع النداء — المقبض وردي (طاقة الهوية) */}
      <g className={m.megaShake}>
        <path d="M170 86 L128 68 L128 116 Z" fill={INK} stroke={INK} strokeWidth="3" strokeLinejoin="round" />
        <rect x="122" y="82" width="10" height="20" rx="4" fill={PINK} stroke={INK} strokeWidth="2.5" />
        <path d="M170 86 v14" stroke={INK} strokeWidth="8" strokeLinecap="round" />
      </g>

      {/* القرطاس المنادي — ذراعه الخلفية نحو الميغافون */}
      <g transform="translate(160 22) scale(0.52)">
        <Leg hipX={112} hipY={188} bend={-2} />
        <Leg hipX={168} hipY={189} bend={2} />
        <LimbPath d="M99 130 q-22 -10 -30 -26" />
        <Bag mood="excited" stroke={INK} fill="var(--pk-white, #FFFFFF)" />
        <LimbPath d="M198 132 q17 13 15 33" />
      </g>

      {/* كيس الطلب على منصة كحلية — هالة ليمونية تتسع حوله */}
      <circle className={m.haloRing} cx="56" cy="152" r="30" fill="none" stroke={LIME} strokeWidth="3" style={{ transformOrigin: "56px 152px" }} />
      <rect x="26" y="168" width="60" height="16" rx="4" fill={INK700} stroke={INK} strokeWidth="3" />
      <g transform="translate(24 92) scale(0.62)">
        <TiedBag />
      </g>
    </svg>
  );
}

/**
 * مشهد «الرصف الذكي» — بطل «تم رصد وصولك» (اختيار المالك 2026-07-15، لوحة الخيارات ٤-و):
 * لقطة درون فوق المواقف — سيارتك تنزلق داخل مربع الالتقاء الليموني المتقطع
 * فيتوهج المربع وتنتشر حلقات الرصد وتنبثق «وصلت ✓» على الأسفلت.
 * يوضع داخل بطاقة كحلية داكنة (الأسفلت) بظل ليموني.
 */
export function ParkedScene({
  title = "رُصد وصولك — ركنت في نقطة الالتقاء",
  style
}: {
  title?: string;
  style?: CSSProperties;
}) {
  const INK600 = "var(--pk-ink-600, #4A5A7C)";
  return (
    <svg
      viewBox="0 0 300 180"
      role="img"
      aria-label={title}
      style={{ display: "block", width: "100%", height: "auto", ...style }}
    >
      {/* خطوط المواقف على الأسفلت */}
      <g stroke={INK600} strokeWidth="3">
        <path d="M84 18 v56 M156 18 v56 M228 18 v56" />
        <path d="M84 106 v56 M228 106 v56" />
      </g>

      {/* مربع نقطة الالتقاء المتقطع — يتوهج لحظة الركن */}
      <rect className={m.spotGlow} x="92" y="102" width="128" height="64" rx="8" fill={LIME} fillOpacity="0.06" stroke={LIME} strokeWidth="3" strokeDasharray="8 7" />

      {/* حلقتا رصد تنتشران من مركز الموقف */}
      <circle className={m.haloRing} cx="156" cy="134" r="40" fill="none" stroke={LIME} strokeWidth="3" style={{ transformOrigin: "156px 134px" }} />
      <circle className={m.haloRing} cx="156" cy="134" r="40" fill="none" stroke={LIME} strokeWidth="3" style={{ transformOrigin: "156px 134px", animationDelay: "0.9s" }} />

      {/* سيارتان جارتان راكنتان */}
      <g opacity="0.55">
        <g transform="translate(100 24)">
          <rect width="64" height="30" rx="10" fill={INK600} />
          <rect x="14" y="5" width="30" height="20" rx="5" fill={INK700} />
        </g>
        <g transform="translate(172 24)">
          <rect width="64" height="30" rx="10" fill={INK600} />
          <rect x="14" y="5" width="30" height="20" rx="5" fill={INK700} />
        </g>
      </g>

      {/* سيارتك تنزلق داخل المربع — القرطاس يطل من فتحة السقف */}
      <g className={m.parkIn}>
        <g transform="translate(112 118)">
          <rect width="88" height="34" rx="11" fill="var(--pk-cloud-2, #EFEADB)" stroke={INK} strokeWidth="3" />
          <rect x="20" y="4" width="34" height="26" rx="6" fill={INK700} />
          <rect x="80" y="4" width="6" height="8" rx="3" fill={LIME} />
          <rect x="80" y="22" width="6" height="8" rx="3" fill={LIME} />
          <g transform="translate(26 5) scale(0.1)">
            <Bag mood="excited" stroke={INK} fill="var(--pk-white, #FFFFFF)" />
          </g>
        </g>
      </g>

      {/* ختم «وصلت ✓» ينبثق على الأسفلت لحظة الركن */}
      <g className={m.popIn}>
        <g transform="translate(230 96)">
          <rect x="-6" y="-14" width="76" height="28" rx="14" fill={LIME} stroke={INK} strokeWidth="2.5" />
          <text
            x="32"
            y="6"
            textAnchor="middle"
            fill={INK}
            style={{ fontFamily: "var(--pk-font-display)", fontWeight: 800, fontSize: 14 }}
          >
            وصلت ✓
          </text>
        </g>
      </g>
    </svg>
  );
}

/**
 * مشهد «يا هلا» — بطل «وصل قبل الجهوز» (اختيار المالك 2026-07-15، لوحة الوصول المبكر: و + عبارة ٥):
 * القرطاس المبتهج يخرج من باب المطعم ملوّحاً لسيارتك الراكنة وفقاعة «يا هلا!» تنبثق —
 * حفاوة تربط بصرياً طرفَي اللحظة: سيارتك الواقفة والمطعم الذي انتبه لوصولك.
 */
export function WelcomeScene({
  title = "يا هلا — المكان عرفك وطلبك بآخر لمساته",
  style
}: {
  title?: string;
  style?: CSSProperties;
}) {
  const star = "M7 0 l2 5 5 2 -5 2 -2 5 -2 -5 -5 -2 5 -2 Z";
  const WHITE = "var(--pk-white, #FFFFFF)";
  return (
    <svg
      viewBox="0 0 300 190"
      role="img"
      aria-label={title}
      style={{ display: "block", width: "100%", height: "auto", ...style }}
    >
      {/* واجهة المطعم ولوحته */}
      <rect x="168" y="44" width="120" height="126" fill={WHITE} stroke={INK} strokeWidth="3" />
      <rect x="196" y="66" width="64" height="18" rx="5" fill="var(--pk-lime-100, #EBF9B8)" stroke={INK} strokeWidth="2.5" />
      <text
        x="228"
        y="79"
        textAnchor="middle"
        fill={INK}
        style={{ fontFamily: "var(--pk-font-display)", fontWeight: 800, fontSize: 11 }}
      >
        المطعم
      </text>

      {/* المظلة المخططة تتمايل بالنسيم */}
      <g className={m.awning}>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <rect
            key={i}
            x={162 + i * 22}
            y="38"
            width="22"
            height="18"
            fill={i % 2 ? WHITE : LIME}
            stroke={INK}
            strokeWidth="2.5"
          />
        ))}
      </g>

      {/* الباب المفتوح — والقرطاس خارج منه بمشية حية وذراع تلوّح لسيارتك */}
      <rect x="204" y="100" width="46" height="70" fill={INK700} stroke={INK} strokeWidth="3" />
      <g className={m.bodyWalk}>
        <g transform="translate(186 66) scale(0.5)">
          <Bag mood="excited" stroke={INK} fill={WHITE} />
        </g>
      </g>
      <g className={`${m.arm} ${m.armWave}`} style={{ transformOrigin: "230px 112px" }}>
        <path d="M230 112 q-8 -3 -14 -15" fill="none" stroke={INK} strokeWidth="5" strokeLinecap="round" />
      </g>

      {/* فقاعة «يا هلا!» تنبثق من جهة الباب */}
      <g className={m.bubblePop}>
        <rect x="128" y="58" width="60" height="28" rx="13" fill={WHITE} stroke={INK} strokeWidth="2.5" />
        <path d="M180 84 l8 10 l-1 -11 Z" fill={WHITE} stroke={INK} strokeWidth="2.5" strokeLinejoin="round" />
        <text
          x="158"
          y="77"
          textAnchor="middle"
          fill={INK}
          style={{ fontFamily: "var(--pk-font-display)", fontWeight: 800, fontSize: 13 }}
        >
          يا هلا!
        </text>
      </g>

      {/* سيارتك الراكنة ودبوس الرصد الوردي ينطنط فوقها */}
      <g transform="translate(22 128) scale(1.25)">
        <path
          d="M4 26 L6 19.5 Q7 16.5 12 16 L30 15.6 L37.5 8 Q39.5 6 43.5 6 L57 6 Q65.5 6 68.4 17.5 L70 24 Q70.2 26 68 26 Z"
          fill={INK}
        />
        <circle cx="18" cy="28" r="6" fill={INK} stroke={LIME} strokeWidth="2.6" />
        <circle cx="56" cy="28" r="6" fill={INK} stroke={LIME} strokeWidth="2.6" />
        <path d="M40 9 L38 15 L52 15 L51 9 Z" fill={WHITE} opacity="0.9" />
      </g>
      <g className={m.pinDrop}>
        <g transform="translate(68 102)">
          <path
            d="M0 -20 C-9 -20 -14.5 -13 -14.5 -5.5 C-14.5 4.5 0 20 0 20 C0 20 14.5 4.5 14.5 -5.5 C14.5 -13 9 -20 0 -20 Z"
            fill={PINK}
            stroke={INK}
            strokeWidth="3"
            strokeLinejoin="round"
          />
          <circle cx="0" cy="-6" r="4.5" fill={WHITE} stroke={INK} strokeWidth="2" />
        </g>
      </g>

      {/* بريق الحفاوة بين السيارة والباب */}
      <path className={`${m.spark} ${m.spark1}`} d={star} fill={PINK} transform="translate(130 116)" />
      <path className={`${m.spark} ${m.spark2}`} d={star} fill={LIME} stroke={INK} strokeWidth="1.5" transform="translate(148 92)" />

      {/* الأرض */}
      <line x1="14" y1="170" x2="286" y2="170" stroke="var(--pk-line, #E7E0CE)" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}

/**
 * مشهد «المطبخ الحي» — بطل حالة التجهيز (اختيار المالك 2026-07-15، لوحة الخيارات ١-ب):
 * القرطاس بقبعة الشيف خلف كاونتر المطبخ، قدر يغلي غطاؤه يقفز وبخاره يتصاعد،
 * وأدوات معلقة وخطوط السرعة الوردية الثلاثة — «تذكرة المطبخ» بالعدّاد الحي
 * طبقة HTML فوق البطاقة من الصفحة (لأن أرقامها تدق كل ثانية).
 */
export function KitchenScene({ title, style }: { title?: string; style?: CSSProperties }) {
  const LIME300 = "var(--pk-lime-300, #DDF77E)";
  const GRAY2 = "var(--pk-gray-2, #8891B5)";
  return (
    <svg
      viewBox="0 0 300 176"
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      style={{ display: "block", width: "100%", height: "auto", ...style }}
    >
      {/* خطوط السرعة الوردية الثلاثة على يسار الحركة (قاعدة الهوية) */}
      <g fill={PINK}>
        <rect className={m.line1} x="256" y="52" width="34" height="8" />
        <rect className={m.line2} x="262" y="70" width="28" height="8" opacity="0.55" />
        <rect className={m.line3} x="268" y="88" width="22" height="8" opacity="0.3" />
      </g>

      {/* رفّ الأدوات المعلقة */}
      <line x1="30" y1="14" x2="150" y2="14" stroke={INK} strokeWidth="4" strokeLinecap="round" />
      <g stroke={INK} strokeWidth="3.5" strokeLinecap="round" fill="none">
        <path d="M52 14 v14 m0 0 a8 8 0 1 0 0.1 0" />
        <path d="M96 14 v16 m-7 0 h14 l-3 14 h-8 Z" fill={LIME300} />
      </g>

      {/* القرطاس الشيف خلف الكاونتر — تمايل هادئ */}
      <g className={m.bodyIdle}>
        <g transform="translate(52 -6) scale(0.52)">
          <Bag mood="happy" stroke={INK} fill="var(--pk-white, #FFFFFF)" />
          <ChefCap />
        </g>
      </g>

      {/* القدر يغلي على الكاونتر — الغطاء يقفز والبخار يتصاعد */}
      <g transform="translate(196 96)">
        <g className={m.steam}>
          <path d="M14 -8 q-4 -6 0 -12 q4 -6 0 -12" />
          <path d="M28 -10 q-4 -6 0 -12 q4 -6 0 -12" />
          <path d="M42 -8 q-4 -6 0 -12 q4 -6 0 -12" />
        </g>
        <g className={m.lidJump}>
          <path d="M6 -2 q22 -18 44 0 Z" fill={INK700} stroke={INK} strokeWidth="3" strokeLinejoin="round" />
          <rect x="22" y="-16" width="12" height="6" rx="3" fill={LIME} stroke={INK} strokeWidth="2.5" />
        </g>
        <path d="M2 0 h52 l-5 26 a6 6 0 0 1 -6 5 h-30 a6 6 0 0 1 -6 -5 Z" fill="var(--pk-ink-600, #4A5A7C)" stroke={INK} strokeWidth="3" />
        <path d="M-6 6 h10 M52 6 h10" stroke={INK} strokeWidth="4" strokeLinecap="round" />
      </g>

      {/* الكاونتر: شريط ليموني وقاعدة كحلية */}
      <rect x="0" y="128" width="300" height="12" fill={LIME} stroke={INK} strokeWidth="3" />
      <rect x="0" y="140" width="300" height="36" fill={INK700} />
      <g fill={GRAY2}>
        <circle cx="40" cy="158" r="3" /><circle cx="150" cy="158" r="3" /><circle cx="260" cy="158" r="3" />
      </g>
    </svg>
  );
}

/**
 * مشهد «أُرسل طلبك» — بطل انتظار قبول المطعم (اختيار المالك 2026-07-15):
 * القرطاس المتحمس يلوّح وقد أطلق طلبه طيّارةً ورقية تحلّق على مسار وردي متقطع
 * حتى باب المطعم، وفوق المطعم فقاعة «...» تنبض — المطعم يطّلع على الطلب الآن.
 * التحليق بـCSS Motion Path (offset-path) لا SMIL — كي يحترم تقليل الحركة كبقية الطبقة.
 */
export function SentScene({
  title = "أُرسل طلبك — المطعم يطّلع عليه الآن",
  style
}: {
  title?: string;
  style?: CSSProperties;
}) {
  const LIME300 = "var(--pk-lime-300, #DDF77E)";
  const WHITE = "var(--pk-white, #FFFFFF)";
  const FLIGHT = "M146 88 C 190 24, 240 22, 288 68";
  return (
    <svg
      viewBox="0 0 362 186"
      role="img"
      aria-label={title}
      style={{ display: "block", width: "100%", height: "auto", overflow: "visible", ...style }}
    >
      {/* الأرض المنقّطة الثابتة — لا أحد يتحرك أرضياً، الطلب هو المحلّق */}
      <line
        x1="18"
        y1="172"
        x2="344"
        y2="172"
        stroke={INK}
        strokeOpacity="0.35"
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray="2 11"
      />

      {/* مسار التحليق الوردي المتقطع — يجري باتجاه المطعم */}
      <path
        className={m.sendTrail}
        d={FLIGHT}
        fill="none"
        stroke={PINK}
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeDasharray="3 10"
        opacity="0.65"
      />

      {/* المطعم: مظلة مقوّسة وواجهة ونافذة وباب — وفقاعة «يقرأ الطلب...» تنبض فوقه */}
      <g transform="translate(252 66)">
        <rect x="22" y="-36" width="56" height="27" rx="13.5" fill={WHITE} stroke={INK} strokeWidth="3" />
        <path d="M43 -10.5 L50 0 L57 -10.5 Z" fill={WHITE} stroke={INK} strokeWidth="3" strokeLinejoin="round" />
        <path d="M44 -11.5 L50 -2 L56 -11.5 Z" fill={WHITE} />
        <circle className={m.typing} cx="38" cy="-22.5" r="3.6" fill={INK} />
        <circle className={`${m.typing} ${m.typing2}`} cx="50" cy="-22.5" r="3.6" fill={INK} />
        <circle className={`${m.typing} ${m.typing3}`} cx="62" cy="-22.5" r="3.6" fill={INK} />
        <rect x="4" y="22" width="94" height="70" rx="10" fill={WHITE} stroke={INK} strokeWidth="4.5" />
        <path
          d="M-3 10 Q-3 0 7 0 L95 0 Q105 0 105 10 L105 20 Q98.25 32 91.5 20 Q84.75 32 78 20 Q71.25 32 64.5 20 Q57.75 32 51 20 Q44.25 32 37.5 20 Q30.75 32 24 20 Q17.25 32 10.5 20 Q3.75 32 -3 20 Z"
          fill={LIME}
          stroke={INK}
          strokeWidth="4"
          strokeLinejoin="round"
        />
        <rect x="17" y="40" width="30" height="26" rx="5" fill={LIME300} stroke={INK} strokeWidth="3.5" />
        <path d="M32 40 V66 M17 53 H47" stroke={INK} strokeWidth="2.5" />
        <rect x="60" y="46" width="27" height="46" rx="6" fill={INK} />
        <circle cx="66" cy="70" r="2.6" fill={LIME} />
      </g>

      {/* القرطاس المتحمس يلوّح بعد الإطلاق — بخطوط سرعته الوردية */}
      <g transform="translate(2 31) scale(0.62)">
        <QirtasFigure mood="excited" pose="wave" lines />
      </g>

      {/* الطيّارة الورقية — الطلب محلّقاً من يد القرطاس حتى باب المطعم (مسار .plane في CSS = FLIGHT) */}
      <g className={m.plane}>
        <path d="M-17 -4 L17 3 L-12 12 Z" fill={WHITE} stroke={INK} strokeWidth="3" strokeLinejoin="round" />
        <path d="M-12 12 L-5 20 L-1 7 Z" fill={PINK} stroke={INK} strokeWidth="3" strokeLinejoin="round" />
      </g>
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

/** عجلة سيارة تدور — إطار كحلي بجنط ليموني وسبوكات تلفّ مع الحركة */
function Wheel({ cx, cy }: { cx: number; cy: number }) {
  return (
    <g>
      <circle cx={cx} cy={cy} r="16" fill={INK} />
      <circle cx={cx} cy={cy} r="9.5" fill={INK} stroke={LIME} strokeWidth="3" />
      <g className={m.spin} style={{ transformOrigin: `${cx}px ${cy}px` }}>
        <path
          d={`M${cx - 6.5} ${cy} H${cx + 6.5} M${cx} ${cy - 6.5} V${cy + 6.5}`}
          fill="none"
          stroke={LIME}
          strokeWidth="3"
          strokeLinecap="round"
        />
      </g>
      <circle cx={cx} cy={cy} r="2.4" fill={LIME} />
    </g>
  );
}

/**
 * القرطاس راكب سيارته — الكاركتر يقود سيارة كحلية مكشوفة نحو طلبه:
 * عجلات تدور، وجسم يرتجّ بمطبّات الطريق (الراكب بطور متأخر ليحسّ بالقفزة)،
 * وأرض منقّطة تنزلق للخلف، ودخان عادم يتلاشى، وخطوط السرعة الوردية الثلاثة
 * على يسار الحركة كقاعدة الهوية — بطل بانر «استلم طلبك من سيارتك!».
 */
export function QirtasDrive({
  size = 84,
  mood = "excited",
  title,
  style
}: {
  size?: number;
  mood?: QirtasMood;
  title?: string;
  style?: CSSProperties;
}) {
  const VB_W = 264;
  const VB_H = 152;
  return (
    <svg
      width={Math.round((size * VB_W) / VB_H)}
      height={size}
      viewBox="0 0 264 152"
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      style={{ overflow: "visible", ...style }}
    >
      {/* خطوط السرعة الوردية خلف السيارة */}
      <g fill={PINK}>
        <rect className={m.line1} x="4" y="84" width="38" height="9" />
        <rect className={m.line2} x="4" y="105" width="30" height="9" opacity="0.55" />
        <rect className={m.line3} x="4" y="126" width="22" height="9" opacity="0.3" />
      </g>

      {/* الأرض المنقّطة تنزلق للخلف — إحساس الانطلاق */}
      <line
        className={m.roadBack}
        x1="10"
        y1="148"
        x2="258"
        y2="148"
        stroke={INK}
        strokeOpacity="0.35"
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray="2 11"
      />

      {/* دخان العادم يتضخم ويتلاشى خلف السيارة */}
      <g fill={INK}>
        <circle className={`${m.puff} ${m.puff1}`} cx="38" cy="108" r="7" style={{ transformOrigin: "38px 108px" }} />
        <circle className={`${m.puff} ${m.puff2}`} cx="33" cy="120" r="5.5" style={{ transformOrigin: "33px 120px" }} />
        <circle className={`${m.puff} ${m.puff3}`} cx="40" cy="116" r="4.5" style={{ transformOrigin: "40px 116px" }} />
      </g>

      {/* العجلتان تدوران في مكانهما والجسم يرتجّ فوقهما */}
      <Wheel cx={98} cy={129} />
      <Wheel cx={212} cy={129} />

      {/* جسم السيارة والراكب — يرتجّان بمطبات الطريق */}
      <g className={m.driveCar}>
        {/* القرطاس الراكب: نصفه الأسفل خلف باب السيارة */}
        <g className={m.driveRider}>
          <g className={`${m.arm} ${m.armWave}`} style={{ transformOrigin: "131.5px 57px" }}>
            <path d="M131.5 57 q-11.5 -5 -15.5 -15.5" fill="none" stroke={INK} strokeWidth="5.4" strokeLinecap="round" />
          </g>
          <g transform="translate(72 -20) scale(0.6)">
            <Bag mood={mood} stroke={INK} fill="var(--pk-white, #FFFFFF)" />
          </g>
          {/* الذراع الأمامية ممسكة بالمقود */}
          <path d="M192 58 q7 6 5 11" fill="none" stroke={INK} strokeWidth="5.4" strokeLinecap="round" />
        </g>

        {/* المقود — خلف حافة الزجاج الأمامي */}
        <path d="M200 81 L198.5 74" stroke={INK} strokeWidth="4" strokeLinecap="round" />
        <circle cx="198" cy="68" r="6.5" fill="none" stroke={INK} strokeWidth="4" />

        {/* جسم السيارة الكحلي المكشوف — بشريط ليموني وإضاءات الهوية */}
        <path
          d="M48 116 L48 92 Q48 80 66 80 L204 80 Q232 80 244 92 Q252 101 253 112 Q253 124 241 124 L60 124 Q48 124 48 116 Z"
          fill={INK}
        />
        <rect x="62" y="99" width="74" height="8" rx="4" fill={LIME} opacity="0.9" />
        <rect x="43" y="87" width="7" height="13" rx="3" fill={PINK} />
        <circle cx="250" cy="98" r="5" fill={LIME} stroke={INK} strokeWidth="3" />

        {/* الزجاج الأمامي المائل للخلف */}
        <path
          d="M208 83 L198 50 L212 50 L222 83 Z"
          fill="var(--pk-white, #FFFFFF)"
          opacity="0.92"
          stroke={INK}
          strokeWidth="4"
          strokeLinejoin="round"
        />
      </g>
    </svg>
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

/**
 * مشهد «من مقعدك» POV — بطل «الموظف متجه إليك» (اختيار المالك 2026-07-15، لوحة الخيارات ٥-ج):
 * منظور جلوسك خلف المقود — الزجاج الأمامي والداشبورد ومرآة الرؤية،
 * والقرطاس بقبعته يقترب نحوك حاملاً كيسك: يكبر كلما اقترب بمشية حية.
 */
export function PovScene({
  title = "الموظف يقترب من شباكك حاملاً طلبك",
  style
}: {
  title?: string;
  style?: CSSProperties;
}) {
  const WHITE = "var(--pk-white, #FFFFFF)";
  return (
    <svg
      viewBox="0 0 300 190"
      role="img"
      aria-label={title}
      style={{ display: "block", width: "100%", height: "auto", ...style }}
    >
      {/* الزجاج الأمامي — سماء ليمونية ناعمة وخط أفق منقّط */}
      <rect x="8" y="8" width="284" height="140" rx="26" fill="var(--pk-lime-100, #EBF9B8)" stroke={INK} strokeWidth="5" />
      <line x1="20" y1="112" x2="280" y2="112" stroke={INK} strokeOpacity="0.3" strokeWidth="3" strokeDasharray="3 10" />

      {/* مرآة الرؤية — بلمعة دورية */}
      <rect x="128" y="2" width="44" height="14" rx="5" fill={INK700} stroke={INK} strokeWidth="3" />
      <rect className={m.mirrorGlint} x="132" y="5" width="14" height="8" rx="3" fill={WHITE} />

      {/* القرطاس يقترب — يكبر بمشية حية حاملاً الكيس */}
      <g className={m.povApproach} style={{ transformOrigin: "150px 112px" }}>
        <g transform="translate(96 22) scale(0.46)">
          <Leg hipX={112} hipY={188} bend={-2} cls={m.legA} />
          <Leg hipX={168} hipY={189} bend={2} cls={m.legB} />
          <Bag mood="happy" stroke={INK} fill={WHITE} />
          <ChefCap />
          <LimbPath d="M200 130 q17 13 15 33" />
          <HandBag />
        </g>
      </g>

      {/* الداشبورد والمقود وإضاءتا اللوحة */}
      <path d="M0 148 h300 v42 h-300 Z" fill={INK700} />
      <path d="M36 190 a58 58 0 0 1 96 -34" fill="none" stroke={INK} strokeWidth="10" strokeLinecap="round" />
      <circle cx="228" cy="172" r="7" fill={LIME} stroke={INK} strokeWidth="2.5" />
      <circle cx="254" cy="172" r="7" fill={PINK} stroke={INK} strokeWidth="2.5" />
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
