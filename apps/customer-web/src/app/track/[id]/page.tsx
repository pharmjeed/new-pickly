"use client";

/**
 * P7 ⭐ الطلب الحي: صفحة واحدة تقودها آلة الحالات —
 * الهيكل ثابت والمحتوى يتبدل (docs/21§1، design/customer/P7.html C-38→C-51).
 * وضع القيادة داكن إجباري أثناء الطريق. النبضة عند رصد الوصول هي الاحتفالية الوحيدة.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/lib/api";
import SpotsMap from "./SpotsMap";
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
  handoff_code: string | null;
  /** الوقت المتوقع — «متوسط وقت التجهيز» المختوم عند القبول من إعدادات المطعم */
  prep_minutes: number | null;
  /** لحظة قبول المطعم — مرساة العدّاد التنازلي للتجهيز */
  accepted_at: string | null;
  /** موقع الفرع وعنوانه المختصر — زر «الاتجاه للمطعم» */
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

const STEPS = ["SUBMITTED", "ACCEPTED", "PREPARING", "READY", "ARRIVED", "COMPLETED"];
/* عناوين شريط الحالات الست — «جاهز للاستلام» لا تُضاء إلا بضغطة المطعم «جاهز» (ready_at) */
const STEP_LABELS = [
  "تم استلام الطلب",
  "تم قبول الطلب",
  "قيد التجهيز",
  "جاهز للاستلام",
  "وصلت",
  "تم التسليم"
];
const DISPLAY: Record<string, { step: string; title: string; sub: string }> = {
  CHECKOUT_PENDING: { step: "SUBMITTED", title: "لحظات…", sub: "نجهّز طلبك للدفع" },
  PAYMENT_PENDING: { step: "SUBMITTED", title: "جارٍ الدفع…", sub: "لا تغلق الصفحة" },
  PAYMENT_FAILED: { step: "SUBMITTED", title: "ما تمّ الدفع", sub: "جرّب بطاقة ثانية — طلبك محفوظ" },
  ORDER_SUBMITTED: { step: "SUBMITTED", title: "أُرسل طلبك", sub: "ننتظر تأكيد المطعم" },
  MERCHANT_PENDING: { step: "SUBMITTED", title: "أُرسل طلبك", sub: "ننتظر تأكيد المطعم" },
  MERCHANT_ACCEPTED: { step: "ACCEPTED", title: "قيد التجهيز", sub: "قبل المطعم طلبك — بدأ تجهيزه الآن" },
  MERCHANT_REJECTED: { step: "SUBMITTED", title: "نعتذر — ما قدر المطعم يستقبل طلبك", sub: "مبلغك يرجع لك كاملاً" },
  PREPARING: { step: "PREPARING", title: "قيد التجهيز", sub: "خلّك مستعد للانطلاق" },
  READY: { step: "READY", title: "طلبك جاهز", sub: "خلّك في سيارتك، الباقي علينا" },
  CUSTOMER_NOTIFIED: { step: "READY", title: "طلبك جاهز", sub: "توجه للمطعم — واضغط «وصلت» عند وصولك" },
  CUSTOMER_ON_THE_WAY: { step: "READY", title: "أنت في الطريق", sub: "المطعم يعرف وقت وصولك" },
  CUSTOMER_NEARBY: { step: "READY", title: "اقتربت!", sub: "تم رصد اقترابك — أبلغنا المطعم تلقائيًا" },
  CUSTOMER_ARRIVED: { step: "ARRIVED", title: "وصلت؟ إحنا عرفنا.", sub: "الموظف في طريقه إليك" },
  HANDOFF_IN_PROGRESS: { step: "ARRIVED", title: "الموظف متجه إليك", sub: "يحمل طلبك — جهّز الرمز" },
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

/** موقف استلام يخدمه الفرع — يحدده المطعم من بوابته (مع نقطته على الخريطة) والعميل يختار منها فقط */
interface BranchSpot {
  id: string;
  label: string;
  lat: number | null;
  lng: number | null;
}

/** رابط ملاحة خارجي للنقطة — يفتح خرائط قوقل بالاتجاهات (نمط أوبر: المتوجه يقصد النقطة) */
const navUrl = (lat: number, lng: number) => `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;

/* أيقونات خطية من رموز P7.html — currentColor فقط */
/** شعار بيكلي — الشارة الليمونية بخطوط السرعة (هوية الحركة skew -8°) */
const PicklyBadge = ({ size = 96 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
    <rect width="100" height="100" rx="24" fill="var(--pk-lime-500)" />
    <g transform="skewX(-8) translate(4,0)" stroke="var(--pk-ink-900)" fill="none">
      <path d="M36,34 L62,34 L59,72 L39,72 Z" strokeWidth="4" strokeLinejoin="round" />
      <path d="M43,34 Q49,24 55,34" strokeWidth="3.5" strokeLinecap="round" />
      <path className={s.sl1} d="M70,40 H88" strokeWidth="5" strokeLinecap="round" />
      <path className={s.sl2} d="M74,52 H88" strokeWidth="5" strokeLinecap="round" />
      <path className={s.sl3} d="M70,64 H80" strokeWidth="5" strokeLinecap="round" />
    </g>
  </svg>
);
/** سهم ملاحة — زر «الاتجاه للمطعم» */
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
const IconRadar = ({ size = 44 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
    <g fill="none" stroke="currentColor" strokeWidth="7" strokeLinecap="round">
      <path d="M34,32 A22,22 0 0 1 66,32" />
      <path d="M24,19 A36,36 0 0 1 76,19" opacity=".5" />
      <circle cx="50" cy="57" r="12" />
      <path d="M50,69 V86" />
    </g>
  </svg>
);

export default function TrackPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Sheet الموقف (C-48): مواقف الفرع المعرفة من المطعم أو وصف حر — POST /v1/orders/{id}/parking-spot
  const [sheetOpen, setSheetOpen] = useState(false);
  const [branchSpots, setBranchSpots] = useState<BranchSpot[] | null>(null);
  const [spotSel, setSpotSel] = useState<string | null>(null);
  const [freeText, setFreeText] = useState("");
  const [parkingLabel, setParkingLabel] = useState<string | null>(null);
  // الموقف المؤكد بنقطته — يقود الخريطة وزر «التوجه للموقف»
  const [chosenSpot, setChosenSpot] = useState<BranchSpot | null>(null);
  const [savingSpot, setSavingSpot] = useState(false);
  const [spotErr, setSpotErr] = useState<string | null>(null);

  // Sheet مفتوح → قفل تمرير الصفحة خلفه + الإغلاق بـEscape
  useEffect(() => {
    if (!sheetOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSheetOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [sheetOpen]);

  // مواقف الفرع — موقف واحد أو أكثر والعميل يختار منها
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

  // ساعة حية للعدّاد التنازلي — تدق فقط أثناء التجهيز قبل الجاهزية
  const prepCountdownOn = Boolean(
    order &&
      ["MERCHANT_ACCEPTED", "PREPARING"].includes(order.order_status) &&
      order.prep_minutes !== null &&
      order.accepted_at &&
      !order.ready_at
  );
  const [nowTs, setNowTs] = useState(() => Date.now());
  useEffect(() => {
    if (!prepCountdownOn) return;
    setNowTs(Date.now());
    const t = setInterval(() => setNowTs(Date.now()), 1000);
    return () => clearInterval(t);
  }, [prepCountdownOn]);

  // احترام تفضيل تقليل الحركة — نوقف حركات القدر (SMIL) لمن يطلب ذلك
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduceMotion(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

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
    // بعد تأكيد الوصول → «وين وقفت؟» (C-47 → C-48)
    setSheetOpen(true);
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

  const submitParking = async () => {
    const chosen = branchSpots?.find((s) => s.id === spotSel) ?? null;
    const text = freeText.trim();
    if (!chosen && !text) return;
    setSavingSpot(true);
    setSpotErr(null);
    try {
      // موقف معرف من الفرع → spot_id (الخادم يتحقق أنه يخص فرع الطلب)؛ وإلا وصف حر
      await api("POST", `/v1/orders/${id}/parking-spot`, chosen ? { spot_id: chosen.id } : { free_text: text });
      setParkingLabel(chosen ? chosen.label : text);
      setChosenSpot(chosen);
      setSheetOpen(false);
    } catch (e) {
      setSpotErr((e as Error).message);
    } finally {
      setSavingSpot(false);
    }
  };

  if (error)
    return (
      <main className="pk-wrap">
        <div className="pk-card" style={{ color: "var(--pk-error)" }}>{error}</div>
      </main>
    );
  if (!order)
    return (
      <main className="pk-wrap">
        <div className="pk-loader"><span /><span /><span /></div>
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
        // الشريط لا يتقدم لـ«جاهز للاستلام» قبل ضغطة المطعم «جاهز» — الخطوة الصادقة «قيد التجهيز»
        step: order.order_status === "CUSTOMER_ARRIVED" ? baseView.step : "PREPARING",
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

  return (
    <div className={driveMode ? "pk-drive" : ""}>
      <main className="pk-wrap">
        <p className="pk-mono pk-muted" data-testid="order-code" style={{ marginBottom: 4 }}>{order.display_code}</p>

        {/* شريط الحالات السبع (steps7 — P7.html) */}
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

        {/* نبضة «تم رصد وصولك» — الاحتفالية الوحيدة (C-46/C-47) */}
        {order.order_status === "CUSTOMER_ARRIVED" && (
          <div className={s.pulseWrap}>
            <div className={s.pulseIcon}><IconRadar /></div>
          </div>
        )}

        {/* شاشة انتظار قبول المطعم — الشعار الحي يرسّخ العلامة أثناء الترقب */}
        {isWaiting && (
          <div className={s.waitHero} data-testid="waiting-logo">
            <span className={s.waitRing} />
            <span className={s.waitRing} />
            <span className={s.waitRing} />
            <div className={s.waitLogo}><PicklyBadge /></div>
          </div>
        )}

        <h1 key={view.title} className={`pk-display ${s.titleSwap}`} data-testid="track-title" style={{ fontSize: driveMode ? "var(--pk-fs-34)" : "var(--pk-fs-24)", textAlign: isWaiting ? "center" : undefined }}>
          {view.title}
        </h1>
        {isWaiting ? (
          <p className={`${s.waitMsg} ${waitOut ? s.waitMsgOut : ""}`}>{WAIT_MSGS[waitIdx]}</p>
        ) : (
          <p className="pk-muted" style={{ marginBottom: 16 }}>{view.sub}</p>
        )}

        {/* عدّاد التجهيز التنازلي — من لحظة القبول + «متوسط وقت التجهيز» الذي حدده المطعم (قرار المالك 2026-07-12) */}
        {prepCountdownOn && order.prep_minutes !== null && order.accepted_at ? (
          (() => {
            const totalMs = order.prep_minutes * 60_000;
            const leftMs = new Date(order.accepted_at).getTime() + totalMs - nowTs;
            const overtime = leftMs <= 0;
            const shown = Math.max(leftMs, 0);
            const mm = Math.floor(shown / 60_000);
            const ss = Math.floor((shown % 60_000) / 1000);
            const frac = Math.min(Math.max(shown / totalMs, 0), 1); // نسبة الوقت المتبقي
            const cook = overtime ? 1 : 1 - frac;                    // نسبة اكتمال الطبخ
            // مستوى السائل داخل القدر: يرتفع مع النضج (تغيّره خلال الثانية دون البكسل — بلا حاجة لتنعيم)
            const liquidTy = 9 - 25 * cook;
            const liquidFill = overtime ? "var(--pk-warn)" : "url(#pk-pot-liquid)";
            const waveFill = overtime ? "#F6C260" : "#DDF87A";
            const anim = !reduceMotion;
            return (
              <div className={`pk-card ${s.prepCard} ${overtime ? s.prepOvertime : ""}`} data-testid="prep-expected">
                <p style={{ fontWeight: 700 }}>{overtime ? "اللمسات الأخيرة على طلبك" : "طلبك على النار الآن"}</p>
                <div className={s.prepRingWrap}>
                  <svg viewBox="0 0 160 160" className={s.pot} aria-hidden="true">
                    <defs>
                      <linearGradient id="pk-pot-liquid" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0" stopColor="#DDF87A" />
                        <stop offset="1" stopColor="#C9F339" />
                      </linearGradient>
                      <linearGradient id="pk-pot-body" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0" stopColor="#2E4A3C" />
                        <stop offset="1" stopColor="#10241B" />
                      </linearGradient>
                      <linearGradient id="pk-pot-lid" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0" stopColor="#2E4A3C" />
                        <stop offset="1" stopColor="#1C3329" />
                      </linearGradient>
                      <clipPath id="pk-pot-clip">
                        <path d="M42 74 h76 v34 a10 10 0 0 1 -10 10 H52 a10 10 0 0 1 -10 -10 Z" />
                      </clipPath>
                    </defs>

                    {/* بخار يتصاعد */}
                    <g className={s.potSteam}>
                      {[
                        { x: 66, dur: "3.2s", begin: "0s", o: 0.5 },
                        { x: 80, dur: "3.6s", begin: "0.7s", o: 0.45 },
                        { x: 94, dur: "3.4s", begin: "1.4s", o: 0.5 },
                      ].map((p) => (
                        <path key={p.x} d={`M${p.x} 44 q-6 -8 0 -16 q6 -8 0 -16`} opacity={anim ? 0 : 0.4}>
                          {anim && (
                            <>
                              <animate attributeName="opacity" values={`0;${p.o};0`} dur={p.dur} begin={p.begin} repeatCount="indefinite" />
                              <animateTransform attributeName="transform" type="translate" values="0 4; 0 -5; 0 -10" dur={p.dur} begin={p.begin} repeatCount="indefinite" />
                            </>
                          )}
                        </path>
                      ))}
                    </g>

                    {/* المقبضان */}
                    <rect x="30" y="82" width="12" height="9" rx="4.5" fill="#1C3329" />
                    <rect x="118" y="82" width="12" height="9" rx="4.5" fill="#1C3329" />

                    {/* جسم القدر */}
                    <path className={s.potBody} d="M42 74 h76 v34 a10 10 0 0 1 -10 10 H52 a10 10 0 0 1 -10 -10 Z" fill="url(#pk-pot-body)" strokeWidth="2" />

                    {/* السائل — مستواه يرتفع مع النضج، والموجة والفقاعات تغلي داخله */}
                    <g clipPath="url(#pk-pot-clip)">
                      <g transform={`translate(0 ${liquidTy})`}>
                        <rect x="40" y="96" width="80" height="34" fill={liquidFill} />
                        <path d="M40 96 q10 -5 20 0 t20 0 t20 0 t20 0 v6 H40 Z" fill={waveFill}>
                          {anim && (
                            <animate
                              attributeName="d"
                              values="M40 96 q10 -5 20 0 t20 0 t20 0 t20 0 v6 H40 Z; M40 96 q10 5 20 0 t20 0 t20 0 t20 0 v6 H40 Z; M40 96 q10 -5 20 0 t20 0 t20 0 t20 0 v6 H40 Z"
                              dur="2.6s"
                              repeatCount="indefinite"
                            />
                          )}
                        </path>
                        {anim && (
                          <>
                            <circle cx="60" cy="118" r="2.4" fill="#F2FCD1">
                              <animate attributeName="cy" values="120;99" dur="2.4s" repeatCount="indefinite" />
                              <animate attributeName="opacity" values="0;0.9;0" dur="2.4s" repeatCount="indefinite" />
                            </circle>
                            <circle cx="80" cy="118" r="3" fill="#FFFFFF">
                              <animate attributeName="cy" values="121;100" dur="2.9s" begin="0.6s" repeatCount="indefinite" />
                              <animate attributeName="opacity" values="0;0.85;0" dur="2.9s" begin="0.6s" repeatCount="indefinite" />
                            </circle>
                            <circle cx="98" cy="118" r="2" fill="#F2FCD1">
                              <animate attributeName="cy" values="119;101" dur="2.2s" begin="1.1s" repeatCount="indefinite" />
                              <animate attributeName="opacity" values="0;0.9;0" dur="2.2s" begin="1.1s" repeatCount="indefinite" />
                            </circle>
                          </>
                        )}
                      </g>
                    </g>

                    {/* الغطاء والمقبض */}
                    <g>
                      {anim && (
                        <animateTransform attributeName="transform" type="rotate" values="0 80 70; 0 80 70; 1.2 80 70; -1.2 80 70; 0 80 70; 0 80 70" dur="4s" repeatCount="indefinite" />
                      )}
                      <path d="M40 70 q40 -16 80 0 Z" fill="url(#pk-pot-lid)" stroke="#10241B" strokeWidth="2" />
                      <rect x="38" y="68" width="84" height="6" rx="3" fill="#1C3329" />
                      <circle cx="80" cy="55" r="4.5" fill="#C9F339" stroke="#10241B" strokeWidth="1.5" />
                    </g>
                  </svg>
                  <div className={s.prepDigits}>
                    <b>{overtime ? "جاهز تقريباً" : `${mm}:${String(ss).padStart(2, "0")}`}</b>
                  </div>
                </div>
                <p className="pk-muted">
                  {overtime ? "أطول من المتوقع بقليل — يوشك على الجهوز" : "حتى جاهزية طلبك تقريباً"}
                </p>
                <p className="pk-muted">الوقت المتوقع ~{order.prep_minutes} دقيقة — حدده المطعم عند القبول</p>
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

        {/* خريطة نقاط المواقف التي ثبتها المطعم — الموقف المختار مميز 🏁 (نمط أوبر) */}
        {(canStart || driveMode || arrived) && branchSpots && (
          <SpotsMap spots={branchSpots} chosenId={chosenSpot?.id ?? null} />
        )}

        {/*
         * «الاتجاه» — يفتح خرائط Google بالاتجاهات، متاح من القبول وحتى الوصول:
         * اختار العميل موقفاً بنقطة مثبتة → الوجهة نقطة الموقف نفسها؛ وإلا → الفرع.
         */}
        {(canStart || driveMode) && (
          <a
            className={s.mapsBtn}
            data-testid="maps-directions"
            href={
              chosenSpot && chosenSpot.lat !== null && chosenSpot.lng !== null
                ? `${navUrl(chosenSpot.lat, chosenSpot.lng)}&travelmode=driving`
                : `https://www.google.com/maps/dir/?api=1&destination=${order.branch_lat},${order.branch_lng}&travelmode=driving`
            }
            target="_blank"
            rel="noopener noreferrer"
          >
            <IconNav />
            {chosenSpot && chosenSpot.lat !== null ? `الاتجاه لموقفك — ${chosenSpot.label}` : "الاتجاه للمطعم"}
            <span className={s.mapsBtnHint}>
              {chosenSpot && chosenSpot.lat !== null ? "نقطة الموقف كما ثبتها المطعم" : order.branch_address_short}
            </span>
          </a>
        )}

        {/* اختيار الموقف مسبقاً — قبل الوصول، ليتوجه العميل لنقطته مباشرة */}
        {(canStart || driveMode) && !parkingLabel && branchSpots && branchSpots.length > 0 && (
          <button
            type="button"
            className={s.parkingBtn}
            data-testid="pre-parking-btn"
            onClick={() => { setSpotErr(null); setSheetOpen(true); }}
          >
            اختر موقفك مسبقاً — نوجهك لنقطته
          </button>
        )}

        {/* بطاقة الرمز الليمونية (C-50/C-51) */}
        {order.handoff_code && arrived && (
          <div className={s.codeCard}>
            <p className={s.codeLabel}>رمز الاستلام</p>
            <span className={s.codeDigits} data-testid="handoff-code">{order.handoff_code}</span>
          </div>
        )}

        {/* الموقف — يفتح Sheet «وين وقفت؟» (C-48) */}
        {arrived && !parkingLabel && (
          <button type="button" className={s.parkingBtn} onClick={() => { setSpotErr(null); setSheetOpen(true); }}>
            وين وقفت؟
          </button>
        )}

        {canArrive && (
          <ArriveSwipe
            enabled={withinRange}
            distanceM={distanceM}
            radiusM={order.arrival_radius_m}
            geoState={geoState}
            onConfirm={confirmArrival}
          />
        )}

        {completed && (
          <div className="pk-card" data-testid="completed-box" style={{ textAlign: "center" }}>
            <span className="pk-badge ok">تم التسليم ✓</span>
            {/* P8: التقييم بضغطة — BR-11 (نافذة 7 أيام) */}
            {!reviewDone ? (
              <div style={{ marginTop: 12 }}>
                <div style={{ display: "flex", justifyContent: "center", gap: 8 }} dir="ltr">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      type="button"
                      data-testid={`rate-${n}`}
                      aria-label={`${n} من 5`}
                      onClick={() => submitReview(n)}
                      disabled={savingReview}
                      style={{
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        fontSize: 30,
                        lineHeight: 1,
                        color: n <= hoverStar ? "var(--pk-warn)" : "var(--pk-line)"
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
              <p className="pk-muted" style={{ marginTop: 8 }} data-testid="review-thanks">
                شكراً لك — تقييمك يطوّر التجربة 🌟 نرجعك للرئيسية…
              </p>
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
      </main>

      {/* Sheet الموقف (C-48): موقف مرقم 1–5 أو وصف حر */}
      {sheetOpen && (
        <div className={s.dim} role="dialog" aria-modal="true" aria-label="وين وقفت؟" onClick={() => setSheetOpen(false)}>
          <div className={s.sheet} onClick={(e) => e.stopPropagation()}>
            <div className={s.grab} />
            <div className={s.sheetHead}>
              <b className={s.sheetTitle}>{arrived ? "وين وقفت؟" : "اختر موقفك"}</b>
              <button type="button" className={s.closeBtn} aria-label="إغلاق" onClick={() => setSheetOpen(false)}>
                ✕
              </button>
            </div>
            <p className={s.sheetHint}>
              {arrived
                ? "تحديد موقفك يوصل راشد لسيارتك مباشرة — بلا لف ولا اتصال."
                : "اختر موقفك الآن ونوجهك لنقطته على الخريطة — والمطعم يعرف وين تقف."}
            </p>
            {branchSpots && branchSpots.length > 0 && (
              <>
                <div className={s.spotGrid}>
                  {branchSpots.map((sp) => (
                    <button
                      key={sp.id}
                      type="button"
                      data-testid="parking-spot-option"
                      className={`${s.spotBtn} ${spotSel === sp.id ? s.spotBtnOn : ""}`}
                      onClick={() => { setSpotSel(spotSel === sp.id ? null : sp.id); setFreeText(""); }}
                    >
                      {sp.label}
                    </button>
                  ))}
                </div>
                <p className={s.spotGridHint}>
                  {branchSpots.length === 1
                    ? "المطعم يخدم هذا الموقف — اختره ليصلك طلبك مباشرة"
                    : "المواقف التي يخدمها المطعم — اختر موقفك منها"}
                </p>
              </>
            )}
            <div>
              <label className={s.fldLabel} htmlFor="parking-free-text">
                {branchSpots && branchSpots.length > 0 ? "أو صف مكان سيارتك للموظف" : "صف مكان سيارتك للموظف"}
              </label>
              <input
                id="parking-free-text"
                className="pk-input"
                value={freeText}
                placeholder="على يمين البوابة الخلفية، جنب شاحنة التوريد"
                onChange={(e) => { setFreeText(e.target.value); setSpotSel(null); }}
              />
            </div>
            {spotErr && <p className={s.sheetErr}>{spotErr}</p>}
            <button
              className="pk-btn"
              onClick={submitParking}
              disabled={savingSpot || (spotSel === null && freeText.trim() === "")}
            >
              تأكيد الموقف
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
