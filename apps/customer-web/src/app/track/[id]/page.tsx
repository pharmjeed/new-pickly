"use client";

/**
 * P7 ⭐ الطلب الحي: صفحة واحدة تقودها آلة الحالات —
 * الهيكل ثابت والمحتوى يتبدل (docs/21§1، design/customer/P7.html C-38→C-51).
 * وضع القيادة داكن إجباري أثناء الطريق. النبضة عند رصد الوصول هي الاحتفالية الوحيدة.
 */
import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/lib/api";
import SpotsMap from "./SpotsMap";
import s from "./track.module.css";

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
              <div key={lb} className={`${s.step} ${done ? s.stepDone : ""} ${cur ? s.stepCur : ""}`}>
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

        <h1 className="pk-display" data-testid="track-title" style={{ fontSize: driveMode ? "var(--pk-fs-34)" : "var(--pk-fs-24)", textAlign: isWaiting ? "center" : undefined }}>
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
            const frac = Math.min(Math.max(shown / totalMs, 0), 1);
            const cook = overtime ? 1 : 1 - frac;      // نسبة اكتمال الطبخ
            const liquidFrac = 0.3 + 0.7 * cook;       // القدر يمتلئ كلما نضج الطلب
            const liquidTop = 120 - 52 * liquidFrac;   // 120 قاع الداخل · 52 ارتفاعه
            return (
              <div className={`pk-card ${s.prepCard} ${overtime ? s.prepOvertime : ""}`} data-testid="prep-expected">
                <p style={{ fontWeight: 700 }}>طلبك على النار الآن</p>
                <div className={s.prepRingWrap}>
                  <svg width="148" height="148" viewBox="0 0 148 148" fill="none" className={s.pot}>
                    {/* بخار يتصاعد من القدر */}
                    <g className={s.potSteam}>
                      <path className={s.steamA} d="M60 44 q-6 -7 0 -14 q6 -7 0 -14" />
                      <path className={s.steamB} d="M74 42 q-6 -7 0 -14 q6 -7 0 -14" />
                      <path className={s.steamC} d="M88 44 q-6 -7 0 -14 q6 -7 0 -14" />
                    </g>
                    <defs>
                      <clipPath id="pk-pot-clip">
                        <path d="M34 66 H114 L108 118 Q108 122 104 122 H44 Q40 122 40 118 Z" />
                      </clipPath>
                    </defs>
                    {/* السائل يرتفع كلما اقترب نضج الطلب */}
                    <g clipPath="url(#pk-pot-clip)">
                      <rect className={s.potLiquid} x="34" y={liquidTop} width="80" height={124 - liquidTop} />
                      <circle className={s.bubbleA} cx="60" cy="110" r="3" />
                      <circle className={s.bubbleB} cx="80" cy="112" r="2.4" />
                      <circle className={s.bubbleC} cx="92" cy="108" r="2.8" />
                    </g>
                    {/* جسم القدر */}
                    <path className={s.potBody} d="M34 66 H114 L108 118 Q108 122 104 122 H44 Q40 122 40 118 Z" />
                    {/* المقبضان */}
                    <path className={s.potHandle} d="M34 76 q-11 1 -11 11" />
                    <path className={s.potHandle} d="M114 76 q11 1 11 11" />
                    {/* الحافة */}
                    <rect className={s.potRim} x="27" y="58" width="94" height="11" rx="5.5" />
                    {/* الغطاء والمقبض */}
                    <path className={s.potLid} d="M41 58 Q74 43 107 58" />
                    <line className={s.potKnobStem} x1="74" y1="46" x2="74" y2="51" />
                    <circle className={s.potKnob} cx="74" cy="44" r="3.2" />
                  </svg>
                  <div className={s.prepDigits}>
                    <b>{overtime ? "اللمسات الأخيرة…" : `${mm}:${String(ss).padStart(2, "0")}`}</b>
                    <span>{overtime ? "أطول من المتوقع قليلاً" : "حتى جاهزية طلبك تقريباً"}</span>
                  </div>
                </div>
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
          <>
            <button className="pk-btn" data-testid="confirm-arrival" onClick={confirmArrival} style={{ marginTop: 8 }}>
              وصلت
            </button>
            <p className={s.footNote}>«وصلت» بيدك دائماً — اضغطه فور وقوفك عند المطعم</p>
          </>
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
