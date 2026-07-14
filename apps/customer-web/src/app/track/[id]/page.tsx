"use client";

/**
 * P7 ⭐ الطلب الحي: صفحة واحدة تقودها آلة الحالات —
 * الهيكل ثابت والمحتوى يتبدل (docs/21§1، design/customer/P7.html C-38→C-51).
 * وضع القيادة داكن إجباري أثناء الطريق. النبضة عند رصد الوصول هي الاحتفالية الوحيدة.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { TabBar } from "../../shell";
import { Qirtas, QirtasBadge, QirtasLoader } from "../../qirtas";
import { ConfettiBurst, HandoffScene, QirtasCook, QirtasLive } from "../../qirtas-motion";
import SpotsMap from "./SpotsMap";
import LiveNav from "./LiveNav";
import ArriveSwipe, { type GeoState } from "./ArriveSwipe";
import s from "./track.module.css";

/** مسافة القوس الكبير بالأمتار بين نقطتين (haversine) — لبوابة تفعيل «وصلت» */
function distanceMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6_371_000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const la1 = (aLat * Math.PI) / 180;
  const la2 = (bLat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

interface Order {
  id: string;
  display_code: string;
  order_status: string;
  branch_id: string;
  brand_name_ar: string;
  /** الوقت المتوقع — «متوسط وقت التجهيز» المختوم عند القبول من إعدادات المطعم */
  prep_minutes: number | null;
  /** لحظة قبول المطعم — مرساة العدّاد التنازلي للتجهيز */
  accepted_at: string | null;
  /** موقع الفرع وعنوانه المختصر — وجهة «نقطة الالتقاء» الاحتياطية إن لم يثبّت المطعم موقفاً */
  branch_lat: number;
  branch_lng: number;
  branch_address_short: string;
  /** نصف قطر تفعيل زر «وصلت» بالأمتار — يضبطه Super Admin (ops.arrival_radius_m) */
  arrival_radius_m: number;
  /** مسار التجهيز الموازي (docs/05§3) — حقيقتا التحضير والجاهزية مستقلتان عن حالة الرحلة */
  preparing_at: string | null;
  ready_at: string | null;
  vehicle: { color_ar: string; model_ar: string | null; plate_short: string } | null;
}

const STEPS = ["SUBMITTED", "ACCEPTED", "PREPARING", "READY", "COMPLETED"];
/* عناوين شريط الحالات الخمس — «جاهز للاستلام» لا تُضاء إلا بضغطة المطعم «جاهز» (ready_at) */
const STEP_LABELS = [
  "تم استلام الطلب",
  "تم قبول الطلب",
  "قيد التجهيز",
  "جاهز للاستلام",
  "تم التسليم"
];
const DISPLAY: Record<string, { step: string; title: string; sub: string }> = {
  CHECKOUT_PENDING: { step: "SUBMITTED", title: "لحظات…", sub: "نجهّز طلبك للدفع" },
  PAYMENT_PENDING: { step: "SUBMITTED", title: "جارٍ الدفع…", sub: "لا تغلق الصفحة" },
  PAYMENT_FAILED: { step: "SUBMITTED", title: "ما تمّ الدفع", sub: "جرّب بطاقة ثانية — طلبك محفوظ" },
  ORDER_SUBMITTED: { step: "SUBMITTED", title: "أُرسل طلبك", sub: "ننتظر تأكيد المطعم" },
  MERCHANT_PENDING: { step: "SUBMITTED", title: "أُرسل طلبك", sub: "ننتظر تأكيد المطعم" },
  MERCHANT_ACCEPTED: { step: "PREPARING", title: "جاري تجهيز طلبك", sub: "قبل المطعم طلبك — بدأ تجهيزه الآن" },
  MERCHANT_REJECTED: { step: "SUBMITTED", title: "نعتذر — ما قدر المطعم يستقبل طلبك", sub: "مبلغك يرجع لك كاملاً" },
  PREPARING: { step: "PREPARING", title: "جاري تجهيز طلبك", sub: "خلّك مستعد للانطلاق" },
  READY: { step: "READY", title: "طلبك جاهز", sub: "خلّك في سيارتك، الباقي علينا" },
  CUSTOMER_NOTIFIED: { step: "READY", title: "طلبك جاهز", sub: "توجه للمطعم — واضغط «وصلت» عند وصولك" },
  CUSTOMER_ON_THE_WAY: { step: "READY", title: "أنت في الطريق", sub: "المطعم يعرف وقت وصولك" },
  CUSTOMER_NEARBY: { step: "READY", title: "اقتربت!", sub: "تم رصد اقترابك — أبلغنا المطعم تلقائيًا" },
  CUSTOMER_ARRIVED: { step: "READY", title: "وصلت؟ إحنا عرفنا.", sub: "الموظف في طريقه إليك" },
  HANDOFF_IN_PROGRESS: { step: "READY", title: "الموظف متجه إليك", sub: "يحمل طلبك ويسلّمه لسيارتك" },
  COMPLETED: { step: "COMPLETED", title: "بالعافية!", sub: "قيّم استلامك بضغطة" },
  CANCELLED: { step: "SUBMITTED", title: "أُلغي الطلب", sub: "مبلغك يرجع لك حسب السياسة" }
};

const DRIVE_STATES = ["CUSTOMER_ON_THE_WAY", "CUSTOMER_NEARBY"];
const ARRIVED_STATES = ["CUSTOMER_ARRIVED", "HANDOFF_IN_PROGRESS"];
/** الحالات التي يُتاح فيها تأكيد «وصلت» — من قبول المطعم وحتى الطريق (نراقب الموقع فيها فقط) */
const ARRIVABLE_STATES = [
  "MERCHANT_ACCEPTED",
  "PREPARING",
  "READY",
  "CUSTOMER_NOTIFIED",
  "CUSTOMER_ON_THE_WAY",
  "CUSTOMER_NEARBY"
];
/** شاشة انتظار قبول المطعم — الشعار الحي + رسائل تطمئن العميل أن شيئاً يحدث */
const WAITING_STATES = ["ORDER_SUBMITTED", "MERCHANT_PENDING"];
const WAIT_MSGS = [
  "أرسلنا طلبك للمطعم",
  "المطعم يطّلع على طلبك الآن…",
  "عادةً يُقبل الطلب خلال دقيقة",
  "فور القبول يبدأ عدّاد التجهيز"
];
/** رسائل مطمئنة تتبدّل بالتلاشي تحت العدّاد أثناء التجهيز */
const PREP_MSGS = [
  "دقيقة تقريباً — حدده المطعم عند القبول",
  "نطبخه لك طازجاً الآن",
  "نار هادئة… ونكهة تنضج",
  "المطعم يجهّزه بعناية",
  "قربت تجهز — خلّك مستعد"
];
/** عبارات احتفالية تتبدّل تحت «كيس بيكلي» فور جاهزية الطلب */
const READY_MSGS = [
  "جهّزناه ومغلّف باسمك",
  "طازج ومربوط — تعال خذه",
  "كل شيء تمام، وباقي أنت",
  "ينتظرك — لا تطوّل عليه"
];

/** نقطة الالتقاء التي حدّدها الفرع من بوابته (مع إحداثياتها على الخريطة) — العميل يتّجه إليها فقط */
interface BranchSpot {
  id: string;
  label: string;
  lat: number | null;
  lng: number | null;
}

/** رابط ملاحة خارجي للنقطة — يفتح خرائط قوقل بالاتجاهات (نمط أوبر: المتوجه يقصد النقطة) */
const navUrl = (lat: number, lng: number) => `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;

/* أيقونات خطية من رموز P7.html — currentColor فقط */
/** سهم ملاحة — زر «الاتجاه إلى نقطة الالتقاء» */
const IconNav = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
    <path
      d="M50,14 L82,82 L50,64 L18,82 Z"
      fill="none"
      stroke="currentColor"
      strokeWidth="8"
      strokeLinejoin="round"
      transform="rotate(35 50 50)"
    />
  </svg>
);
/** جرس الإشعار — شريط «ستصلك فور جاهزية طلبك للاستلام» */
const IconBell = ({ size = 19 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    <path
      d="M12 3 a6.5 6.5 0 0 0 -6.5 6.5 v4 L3.5 16.5 h17 L18.5 13.5 v-4 A6.5 6.5 0 0 0 12 3 Z"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinejoin="round"
    />
    <path d="M9.5 19.5 a2.5 2.5 0 0 0 5 0" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
  </svg>
);
export default function TrackPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState<string | null>(null);
  // وضع الملاحة الحيّة داخل التطبيق (نمط أوبر/كريم)
  const [navOpen, setNavOpen] = useState(false);

  // نقطة الالتقاء التي حدّدها الفرع — مصدر الدبوس على الخريطة (لا اختيار موقف من العميل)
  const [branchSpots, setBranchSpots] = useState<BranchSpot[] | null>(null);

  // نقطة الالتقاء التي حدّدها الفرع
  const branchId = order?.branch_id;
  useEffect(() => {
    if (!branchId) return;
    api<BranchSpot[]>("GET", `/v1/branches/${branchId}/parking-spots`)
      .then(setBranchSpots)
      .catch(() => setBranchSpots([])); // لا مواقف معرفة → الوصف النصي يكفي
  }, [branchId]);

  const refresh = useCallback(async () => {
    try {
      const o = await api<Order>("GET", `/v1/orders/${id}`);
      setOrder(o);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);

  useEffect(() => {
    void refresh();
    const t = setInterval(refresh, 2500);
    return () => clearInterval(t);
  }, [refresh]);

  // شاشة الانتظار: رسائل متبدلة تحت الشعار الحي — يتوقف التبديل فور مغادرة حالة الانتظار
  const isWaiting = WAITING_STATES.includes(order?.order_status ?? "");
  const [waitIdx, setWaitIdx] = useState(0);
  const [waitOut, setWaitOut] = useState(false);
  useEffect(() => {
    if (!isWaiting) return;
    const t = setInterval(() => {
      setWaitOut(true);
      setTimeout(() => {
        setWaitIdx((i) => (i + 1) % WAIT_MSGS.length);
        setWaitOut(false);
      }, 220);
    }, 3400);
    return () => clearInterval(t);
  }, [isWaiting]);

  // حياة شريط الحالات: عند كل انتقال فعلي للطلب نطلق دفعة احتفالية على الخطوة الحالية
  // (نتجاهل أول تحميل حتى لا يحتفل عند فتح الصفحة على حالة قائمة).
  const status = order?.order_status;
  const [celebrate, setCelebrate] = useState(false);
  const firstStatusRef = useRef(true);
  useEffect(() => {
    if (!status) return;
    if (firstStatusRef.current) {
      firstStatusRef.current = false;
      return;
    }
    setCelebrate(true);
    const t = setTimeout(() => setCelebrate(false), 1100);
    return () => clearTimeout(t);
  }, [status]);

  // ساعة حية للعدّاد التنازلي — تدق أثناء التجهيز، وكذلك بعد وصول العميل مبكراً قبل الجاهزية
  const prepCountdownOn = Boolean(
    order &&
      ["MERCHANT_ACCEPTED", "PREPARING"].includes(order.order_status) &&
      order.prep_minutes !== null &&
      order.accepted_at &&
      !order.ready_at
  );
  // وصل العميل (تأكيد يدوي بالسحب) قبل أن يعلن المطعم «جاهز» — نطمئنه بعدّاد «على وشك» ونُخفي الخريطة
  const arrivedBeforeReady = Boolean(
    order && order.order_status === "CUSTOMER_ARRIVED" && !order.ready_at
  );
  // العدّاد الحي يدق في الحالتين — التجهيز أو الوصول المبكر — ما دام لدينا مرساة القبول والوقت
  const liveClockOn = prepCountdownOn || arrivedBeforeReady;
  const [nowTs, setNowTs] = useState(() => Date.now());
  useEffect(() => {
    if (!liveClockOn) return;
    setNowTs(Date.now());
    const t = setInterval(() => setNowTs(Date.now()), 1000);
    return () => clearInterval(t);
  }, [liveClockOn]);

  // لحظة الجاهزية — يحلّ «كيس بيكلي» المربوط محلّ القدر فور ضغطة المطعم «جاهز» وقبل الاكتمال
  const readyMoment = Boolean(
    order && order.ready_at && order.order_status !== "COMPLETED"
  );

  // احترام تفضيل تقليل الحركة — نوقف حركات القدر (SMIL) لمن يطلب ذلك
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduceMotion(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  // الرسالة المطمئنة تحت القدر تتبدّل بالتلاشي (نفس نبض شاشة الانتظار) — تتوقف مع تقليل الحركة
  const [prepMsgIdx, setPrepMsgIdx] = useState(0);
  const [prepMsgOut, setPrepMsgOut] = useState(false);
  useEffect(() => {
    if (!prepCountdownOn || reduceMotion) return;
    const t = setInterval(() => {
      setPrepMsgOut(true);
      setTimeout(() => {
        setPrepMsgIdx((i) => (i + 1) % PREP_MSGS.length);
        setPrepMsgOut(false);
      }, 220);
    }, 3400);
    return () => clearInterval(t);
  }, [prepCountdownOn, reduceMotion]);

  // العبارة الاحتفالية تحت الكيس تتبدّل بالتلاشي — تتوقف مع تقليل الحركة
  const [readyMsgIdx, setReadyMsgIdx] = useState(0);
  const [readyMsgOut, setReadyMsgOut] = useState(false);
  useEffect(() => {
    if (!readyMoment || reduceMotion) return;
    const t = setInterval(() => {
      setReadyMsgOut(true);
      setTimeout(() => {
        setReadyMsgIdx((i) => (i + 1) % READY_MSGS.length);
        setReadyMsgOut(false);
      }, 220);
    }, 3400);
    return () => clearInterval(t);
  }, [readyMoment, reduceMotion]);

  // بوابة «وصلت»: نراقب موقع العميل أثناء الحالات القابلة للوصول فقط (docs/17 — الموقع أثناء الطلب النشط فقط)
  const canArriveNow = ARRIVABLE_STATES.includes(order?.order_status ?? "");
  const [geoState, setGeoState] = useState<GeoState>("locating");
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  useEffect(() => {
    if (!canArriveNow) return;
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setGeoState("unavailable");
      return;
    }
    setGeoState((g) => (g === "denied" || g === "unavailable" ? g : "locating"));
    const wid = navigator.geolocation.watchPosition(
      (pos) => {
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setGeoState("ok");
      },
      (err) => setGeoState(err.code === err.PERMISSION_DENIED ? "denied" : "unavailable"),
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 20_000 }
    );
    return () => navigator.geolocation.clearWatch(wid);
  }, [canArriveNow]);

  const confirmArrival = async () => {
    await api("POST", `/v1/orders/${id}/arrival`);
    await refresh();
    // نقطة الالتقاء ثابتة يحدّدها الفرع — يكفي وصول العميل إليها، بلا اختيار موقف
  };

  // P8: تقييم بضغطة (BR-11)
  const [reviewDone, setReviewDone] = useState(false);
  const [savingReview, setSavingReview] = useState(false);
  const [hoverStar, setHoverStar] = useState(0);
  const submitReview = async (stars: number) => {
    setSavingReview(true);
    try {
      await api("POST", `/v1/orders/${id}/review`, { rating_overall: stars });
      setReviewDone(true);
    } catch {
      /* التقييم اختياري — لا نزعج */
    } finally {
      setSavingReview(false);
    }
  };

  // بعد التقييم: لحظة شكر ثم عودة تلقائية للرئيسية — انتهت رحلة الطلب
  useEffect(() => {
    if (!reviewDone) return;
    const t = setTimeout(() => router.replace("/"), 2500);
    return () => clearTimeout(t);
  }, [reviewDone, router]);

  if (error)
    return (
      <main className="pk-wrap" style={{ paddingBottom: 92 }}>
        <div className="pk-card" style={{ color: "var(--pk-error)" }}>{error}</div>
        <TabBar />
      </main>
    );
  if (!order)
    return (
      <main className="pk-wrap" style={{ paddingBottom: 92 }}>
        <QirtasLoader />
        <TabBar />
      </main>
    );

  const baseView = DISPLAY[order.order_status] ?? DISPLAY.MERCHANT_PENDING!;
  // رحلتك قد تسبق التجهيز (docs/05§3) — النص يصدُق: الطلب ما زال يُجهَّز
  const journeyBeforeReady =
    ["CUSTOMER_ON_THE_WAY", "CUSTOMER_NEARBY", "CUSTOMER_ARRIVED"].includes(order.order_status) &&
    !order.ready_at;
  const view = journeyBeforeReady
    ? {
        ...baseView,
        // الشريط لا يتقدم لـ«جاهز للاستلام» قبل ضغطة المطعم «جاهز» — الخطوة الصادقة «قيد التجهيز».
        // حتى بعد تأكيد العميل «وصلت»: الوصول ليس جاهزية؛ نبضة الرصد تعرض الوصول منفصلاً.
        step: "PREPARING",
        sub:
          order.order_status === "CUSTOMER_ARRIVED"
            ? "طلبك يُجهَّز الآن — نطلع لك فور جاهزيته"
            : "المطعم يجهّز طلبك على وقت وصولك"
      }
    : baseView;
  const stepIdx = STEPS.indexOf(view.step);
  const completed = order.order_status === "COMPLETED";
  // صدق شريط الخطوات: «قيد التجهيز» و«جاهز» تُعلَّمان بحقائق التجهيز لا بموقع الرحلة
  const stepDone = (i: number): boolean => {
    if (completed) return true;
    if (i >= stepIdx) return false;
    if (STEPS[i] === "PREPARING") return Boolean(order.preparing_at ?? order.ready_at);
    if (STEPS[i] === "READY") return Boolean(order.ready_at);
    return true;
  };
  const driveMode = DRIVE_STATES.includes(order.order_status);
  const arrived = ARRIVED_STATES.includes(order.order_status);
  const canStart = ["MERCHANT_ACCEPTED", "PREPARING", "READY", "CUSTOMER_NOTIFIED"].includes(order.order_status);
  // «وصلت» متاح من القبول وحتى الوصول — بلا زر «انطلقت الآن»: الخادم يفتح جلسة يدوية تلقائياً (J10)
  const canArrive = canStart || driveMode;
  // بوابة القرب: لا يُفتح السحب إلا داخل نصف القطر الذي يضبطه Super Admin (docs/14).
  // سماح احتياطي: إن تعذّر تحديد الموقع (رفض/غير مدعوم/أصل غير آمن HTTP) نفتح السحب يدوياً
  // مع تنبيه — كي لا يُحبس العميل خارج التأكيد؛ الموقع الآمن (HTTPS) يعيد البوابة الصارمة.
  const distanceM = coords
    ? distanceMeters(coords.lat, coords.lng, order.branch_lat, order.branch_lng)
    : null;
  const geoBlocked = geoState === "denied" || geoState === "unavailable";
  const withinRange = geoBlocked || (distanceM !== null && distanceM <= order.arrival_radius_m);

  /* شريط الحالات الخمس (steps — P7.html) — في حالة التجهيز ينزل تحت بطل الدائرة (مرجع لوحة العرض) */
  const stepsBar = (
    <div className={s.steps} aria-label="حالة الطلب">
      {STEP_LABELS.map((lb, i) => {
        const done = stepDone(i);
        const cur = !completed && i === stepIdx;
        return (
          <div
            key={lb}
            aria-current={cur ? "step" : undefined}
            className={`${s.step} ${done ? s.stepDone : ""} ${cur ? s.stepCur : ""} ${
              cur && celebrate ? s.stepBurst : ""
            }`}
          >
            <div className={s.dot}>{done ? "✓" : cur ? "●" : ""}</div>
            <div className={s.lbl}>{lb}</div>
          </div>
        );
      })}
    </div>
  );

  return (
    <div className={driveMode ? "pk-drive" : ""}>
      {/* مساحة سفلية للتبويب الثابت — كي لا يغطي السحبَ وبطاقات أسفل الصفحة */}
      <main className="pk-wrap" style={{ paddingBottom: 92 }}>
        <p className="pk-mono pk-muted" data-testid="order-code" style={{ marginBottom: 4 }}>{order.display_code}</p>

        {/* شريط الحالات في أعلى الصفحة — عدا حالة التجهيز حيث ينزل تحت البطل */}
        {!prepCountdownOn && stepsBar}

        {/* نبضة «تم رصد وصولك» — القرطاس المتحمس داخل البطاقة الليمونية (لحظة الوصول) */}
        {order.order_status === "CUSTOMER_ARRIVED" && !arrivedBeforeReady && (
          <div className={s.pulseWrap}>
            <div className={s.pulseIcon}><Qirtas mood="excited" size={68} /></div>
          </div>
        )}

        {/* شاشة انتظار قبول المطعم — شارة القرطاس الحية ترسّخ العلامة أثناء الترقب */}
        {isWaiting && (
          <div className={s.waitHero} data-testid="waiting-logo">
            <span className={s.waitRing} />
            <span className={s.waitRing} />
            <span className={s.waitRing} />
            <div className={s.waitLogo}><QirtasBadge size={96} /></div>
          </div>
        )}

        <h1 key={view.title} className={`pk-display ${s.titleSwap}`} data-testid="track-title" style={{ fontSize: driveMode ? "var(--pk-fs-34)" : "var(--pk-fs-24)", textAlign: isWaiting || prepCountdownOn ? "center" : undefined }}>
          {view.title}
        </h1>
        {isWaiting ? (
          <p className={`${s.waitMsg} ${waitOut ? s.waitMsgOut : ""}`}>{WAIT_MSGS[waitIdx]}</p>
        ) : prepCountdownOn ? (
          /* حالة التجهيز: اسم المطعم تحت العنوان مباشرة (مرجع لوحة العرض) */
          <p className="pk-muted" style={{ marginBottom: 4, textAlign: "center" }}>من {order.brand_name_ar}</p>
        ) : (
          <p className="pk-muted" style={{ marginBottom: 16 }}>{view.sub}</p>
        )}

        {/* عدّاد التجهيز التنازلي — من لحظة القبول + «متوسط وقت التجهيز» الذي حدده المطعم (قرار المالك 2026-07-12) */}
        {readyMoment ? (
          /* لحظة الجاهزية — كيس بيكلي المربوط يحلّ محلّ القدر (المفهوم المعتمد 2026-07-13) */
          <div className={`pk-card pk-in ${s.prepCard} ${s.readyCard}`} data-testid="ready-bag">
            <p style={{ fontWeight: 700 }}>طلبك جاهز!</p>
            <div className={s.readyRow}>
            {/* القرطاس المتحمس يلوّح: «تعال خذه!» — بجانب الكيس المربوط المعتمد */}
            <QirtasLive pose="wave" mood="excited" size={92} style={{ marginBottom: 8 }} />
            <div className={s.prepRingWrap}>
              <svg viewBox="0 0 160 160" className={s.readyBagSvg} aria-hidden="true">
                {/* بريق يتلألأ حول الكيس — ليموني ووردي (ألوان الهوية الفنكية) */}
                {!reduceMotion && (
                  <g className={s.bagSparks}>
                    <path d="M124 44 l2.4 5.2 l5.2 2.4 l-5.2 2.4 l-2.4 5.2 l-2.4 -5.2 l-5.2 -2.4 l5.2 -2.4 Z" fill="var(--pk-pink-500)">
                      <animate attributeName="opacity" values="0;1;0" dur="2.2s" begin="0s" repeatCount="indefinite" />
                      <animateTransform attributeName="transform" type="scale" values="0.6;1;0.6" additive="sum" dur="2.2s" begin="0s" repeatCount="indefinite" />
                    </path>
                    <circle cx="30" cy="58" r="3" fill="var(--pk-lime-500)">
                      <animate attributeName="opacity" values="0;1;0" dur="2.4s" begin="0.6s" repeatCount="indefinite" />
                    </circle>
                    <circle cx="34" cy="98" r="2.4" fill="var(--pk-lime-300)">
                      <animate attributeName="opacity" values="0;1;0" dur="2s" begin="1.1s" repeatCount="indefinite" />
                    </circle>
                  </g>
                )}

                {/* الكيس يتمايل فرحاً حول قاعدته */}
                <g className={s.bagBody}>
                  {/* المقبض المربوط بعقدة */}
                  <path d="M62 56 q18 -30 36 0" fill="none" stroke="var(--pk-ink-900)" strokeWidth="5" strokeLinecap="round" />
                  <path d="M74 40 q6 -9 12 0" fill="none" stroke="var(--pk-lime-500)" strokeWidth="4" strokeLinecap="round" />
                  {/* جسم الكيس */}
                  <path d="M50 58 h60 l6 62 a10 10 0 0 1 -10 11 H54 a10 10 0 0 1 -10 -11 Z" fill="var(--pk-ink-700)" stroke="var(--pk-ink-900)" strokeWidth="2" />
                  {/* طية علوية */}
                  <path d="M50 58 h60 l1.4 12 H48.6 Z" fill="var(--pk-ink-900)" />
                  {/* شارة بيكلي بعلامة صح */}
                  <rect x="62" y="82" width="36" height="24" rx="6" fill="var(--pk-lime-500)" />
                  <path d="M71 94 l5 5 l10 -12" fill="none" stroke="var(--pk-ink-900)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                </g>
              </svg>
            </div>
            </div>
            <p className={`pk-muted ${s.prepMsg} ${readyMsgOut ? s.prepMsgOut : ""}`}>
              {READY_MSGS[readyMsgIdx]}
            </p>
          </div>
        ) : arrivedBeforeReady && order.prep_minutes !== null && order.accepted_at ? (
          (() => {
            // عدّاد «على وشك» بعد الوصول المبكر — نفس مرساة القبول ومتوسط وقت التجهيز، معروضاً كحلقة تتقلص مع الوقت
            const totalMs = order.prep_minutes * 60_000;
            const leftMs = new Date(order.accepted_at).getTime() + totalMs - nowTs;
            const overtime = leftMs <= 0;
            const shown = Math.max(leftMs, 0);
            const mm = Math.floor(shown / 60_000);
            const ss = Math.floor((shown % 60_000) / 1000);
            const frac = Math.min(Math.max(shown / totalMs, 0), 1); // نسبة الوقت المتبقي
            const R = 52;
            const CIRC = 2 * Math.PI * R;
            const offset = overtime ? 0 : CIRC * (1 - frac); // الحلقة تتقلص مع تناقص الوقت
            return (
              <div className={`pk-card ${s.arriveCard}`} data-testid="arrived-countdown">
                <p style={{ fontWeight: 700 }}>{overtime ? "اللمسات الأخيرة على طلبك" : "طلبك على وشك الجهوز"}</p>
                <div className={s.cdRingWrap}>
                  <svg viewBox="0 0 126 126" className={s.cdRing} aria-hidden="true">
                    <circle cx="63" cy="63" r="52" fill="none" stroke="var(--pk-lime-100)" strokeWidth="10" />
                    <circle
                      cx="63"
                      cy="63"
                      r="52"
                      fill="none"
                      stroke={overtime ? "var(--pk-warn)" : "var(--pk-lime-500)"}
                      strokeWidth="10"
                      strokeLinecap="round"
                      strokeDasharray={CIRC}
                      strokeDashoffset={offset}
                      transform="rotate(-90 63 63)"
                      style={{ transition: reduceMotion ? "none" : "stroke-dashoffset 1s linear" }}
                    />
                  </svg>
                  <div className={s.cdNum}>
                    <b>{overtime ? "جاهز تقريباً" : `${mm}:${String(ss).padStart(2, "0")}`}</b>
                    <span>حتى الجهوز تقريباً</span>
                  </div>
                </div>
                <span className="pk-badge ok" data-testid="arrival-ack">أبلغنا المطعم بوصولك ✓</span>
              </div>
            );
          })()
        ) : arrivedBeforeReady ? (
          /* وصل مبكراً بلا مرساة وقت (طلب قديم) — نكتفي بتأكيد الإبلاغ والطمأنة */
          <div className={`pk-card ${s.arriveCard}`} data-testid="arrived-countdown">
            <p style={{ fontWeight: 700 }}>طلبك على وشك الجهوز</p>
            <p className="pk-muted" style={{ marginTop: 4, marginBottom: 10 }}>المطعم يُنهي تجهيزه — نطلع لك فور جهوزه</p>
            <span className="pk-badge ok" data-testid="arrival-ack">أبلغنا المطعم بوصولك ✓</span>
          </div>
        ) : prepCountdownOn && order.prep_minutes !== null && order.accepted_at ? (
          (() => {
            const totalMs = order.prep_minutes * 60_000;
            const leftMs = new Date(order.accepted_at).getTime() + totalMs - nowTs;
            const overtime = leftMs <= 0;
            const shown = Math.max(leftMs, 0);
            const mm = Math.floor(shown / 60_000);
            const ss = Math.floor((shown % 60_000) / 1000);
            return (
              <div data-testid="prep-expected">
                {/* بطل التجهيز — القرطاس الطبّاخ داخل الدائرة الليمونية (مرجع لوحة العرض) */}
                <div className={s.cookHero}>
                  <QirtasCook size={172} title="المطعم يجهّز طلبك الآن" />
                </div>

                {/* شريط الحالات تحت البطل — كما في اللوحة */}
                {stepsBar}

                {/* العدّاد الكبير — من لحظة القبول + «متوسط وقت التجهيز» الذي حدده المطعم */}
                <div className={s.cookTimer}>
                  <p className={s.cookLead}>{overtime ? "اللمسات الأخيرة على طلبك" : "طلبك سيكون جاهزاً خلال"}</p>
                  <b className={`${s.cookDigits} ${overtime ? s.cookDigitsOver : ""}`} data-testid="prep-countdown">
                    {overtime ? "جاهز تقريباً" : `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`}
                  </b>
                  <p className={`pk-muted ${s.prepMsg} ${prepMsgOut ? s.prepMsgOut : ""}`}>
                    {overtime ? "أطول من المتوقع بقليل — يوشك على الجهوز" : PREP_MSGS[prepMsgIdx]}
                  </p>
                </div>

                {/* شريط الطمأنة — جرس يهتز: الإشعار يصل فور الجاهزية */}
                <div className={s.notifyPill}>
                  <span className={s.bellIcon}><IconBell /></span>
                  ستصلك فور جاهزية طلبك للاستلام
                </div>
              </div>
            );
          })()
        ) : ["MERCHANT_ACCEPTED", "PREPARING"].includes(order.order_status) && order.prep_minutes !== null && !order.ready_at ? (
          /* طلبات قديمة بلا accepted_at — البطاقة الثابتة كما كانت */
          <div className="pk-card" data-testid="prep-expected" style={{ textAlign: "center", marginBottom: 12 }}>
            <p style={{ fontWeight: 700, marginBottom: 4 }}>الوقت المتوقع لتجهيز طلبك</p>
            <p className="pk-display" style={{ fontSize: "var(--pk-fs-34)", margin: "4px 0" }}>
              ~<span className="pk-mono">{order.prep_minutes}</span> دقيقة
            </p>
            <p className="pk-muted">متوسط وقت التجهيز لدى المطعم — انطلق بحسبه</p>
          </div>
        ) : null}

        {/*
         * نقطة الالتقاء — النقطة التي ثبتها الفرع: أول نقطة بإحداثيات مثبتة على الخريطة،
         * وإلا موقع الفرع نفسه. العميل يتّجه إليها والخريطة تؤكد وصوله (بلا اختيار موقف).
         */}
        {(() => {
          // نقطة الالتقاء مضمونة دائماً: موقف مثبّت بإحداثيات إن وُجد، وإلا موقع الفرع نفسه
          const meetingSpot = branchSpots?.find((sp) => sp.lat !== null && sp.lng !== null) ?? null;
          const destLat = meetingSpot?.lat ?? order.branch_lat;
          const destLng = meetingSpot?.lng ?? order.branch_lng;
          const destLabel = meetingSpot?.label ?? order.brand_name_ar;
          return (
            <>
              {/* الخريطة/الملاحة تختفيان فور تأكيد الوصول — يحلّ محلّهما عدّاد «على وشك» (المعتمد 2026-07-13) */}
              {!arrived &&
                (navOpen ? (
                  /* الملاحة الحيّة تحلّ محلّ الخريطة في مكانها وبحجمها نفسه — بلا تكبير ملء الشاشة */
                  <LiveNav
                    inline
                    target={{ lat: destLat, lng: destLng, label: destLabel }}
                    onClose={() => setNavOpen(false)}
                  />
                ) : (
                  /* خريطة تفاعلية: نقطة الالتقاء 🏁 + موقع العميل الحيّ + مسار الطريق — كله داخل التطبيق */
                  (canStart || driveMode) && (
                    <SpotsMap
                      target={{ lat: destLat, lng: destLng, label: destLabel }}
                      me={coords}
                      radiusM={order.arrival_radius_m}
                    />
                  )
                ))}

              {/* زر الملاحة الحيّة داخل التطبيق (نمط أوبر/كريم) — خريطة تتبعك + توجيه صوتي */}
              {(canStart || driveMode) && !navOpen && (
                <button
                  type="button"
                  className={s.mapsBtn}
                  data-testid="start-live-nav"
                  onClick={() => setNavOpen(true)}
                >
                  <IconNav />
                  ابدأ الملاحة إلى نقطة الالتقاء
                  <span className={s.mapsBtnHint}>ملاحة صوتية داخل التطبيق — بلا خروج</span>
                </button>
              )}

              {/* رابط اختياري صغير لمن يفضّل خرائط قوقل (ملاحة خارجية) */}
              {(canStart || driveMode) && (
                <a
                  data-testid="maps-directions"
                  href={`${navUrl(destLat, destLng)}&travelmode=driving`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    justifyContent: "center",
                    width: "100%",
                    fontSize: 13,
                    color: "var(--pk-text-2)",
                    textDecoration: "underline",
                    padding: "8px 0",
                    marginBottom: 8
                  }}
                >
                  <IconNav size={14} />
                  أو افتح خرائط قوقل ↗
                </a>
              )}

            </>
          );
        })()}

        {canArrive && (
          <ArriveSwipe
            enabled={withinRange}
            distanceM={distanceM}
            radiusM={order.arrival_radius_m}
            geoState={geoState}
            onConfirm={confirmArrival}
          />
        )}

        {/* مشهد «الموظف متجه إليك» — القرطاس بقبعة التجهيز يمشي بطلبك نحو سيارتك */}
        {order.order_status === "HANDOFF_IN_PROGRESS" && (
          <div className="pk-card pk-in" data-testid="handoff-scene" style={{ padding: "14px 10px 6px" }}>
            <HandoffScene />
          </div>
        )}

        {completed && (
          <div
            className="pk-card pk-in"
            data-testid="completed-box"
            style={{ textAlign: "center", position: "relative", overflow: "hidden" }}
          >
            {/* كونفيتي الهوية — لحظة «بالعافية!» تستحق مطراً ملوناً */}
            <ConfettiBurst count={14} />
            <span className="pk-badge ok">تم التسليم ✓</span>
            {/* P8: التقييم بضغطة — BR-11 (نافذة 7 أيام) · القرطاس المحتفل يرافق التقييم */}
            {!reviewDone ? (
              <div style={{ marginTop: 12 }}>
                <div style={{ display: "flex", justifyContent: "center", marginBottom: 6 }}>
                  <QirtasLive pose="celebrate" mood="excited" size={104} title="القرطاس يحتفل بطلبك" />
                </div>
                <div style={{ display: "flex", justifyContent: "center", gap: 8 }} dir="ltr">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      type="button"
                      data-testid={`rate-${n}`}
                      aria-label={`${n} من 5`}
                      className="pk-pop"
                      onClick={() => submitReview(n)}
                      disabled={savingReview}
                      style={{
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        fontSize: 30,
                        lineHeight: 1,
                        color: n <= hoverStar ? "var(--pk-warn)" : "var(--pk-line)",
                        animationDelay: `${250 + n * 90}ms`,
                        transition: "transform 0.15s var(--pk-ease), color 0.15s var(--pk-ease)",
                        transform: n <= hoverStar ? "scale(1.25)" : "scale(1)"
                      }}
                      onMouseEnter={() => setHoverStar(n)}
                      onMouseLeave={() => setHoverStar(0)}
                    >
                      ★
                    </button>
                  ))}
                </div>
                <p className="pk-muted" style={{ marginTop: 4 }}>قيّم استلامك بضغطة</p>
              </div>
            ) : (
              <div style={{ marginTop: 10 }} data-testid="review-thanks">
                <div style={{ display: "flex", justifyContent: "center", marginBottom: 4 }}>
                  <Qirtas mood="wink" size={64} />
                </div>
                <p className="pk-muted">شكراً لك — تقييمك يطوّر التجربة 🌟 نرجعك للرئيسية…</p>
              </div>
            )}
            <button
              type="button"
              className="pk-btn"
              data-testid="back-home"
              style={{ marginTop: 14 }}
              onClick={() => router.replace("/")}
            >
              العودة للرئيسية
            </button>
          </div>
        )}

        {/* التنقل السفلي — يبقى متاحاً أثناء التتبع للتنقل في التطبيق */}
        <TabBar />
      </main>
    </div>
  );
}
