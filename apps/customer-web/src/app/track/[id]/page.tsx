"use client";

/**
 * P7 ⭐ الطلب الحي: صفحة واحدة تقودها آلة الحالات —
 * الهيكل ثابت والمحتوى يتبدل (docs/21§1، design/customer/P7.html C-38→C-51).
 * وضع القيادة داكن إجباري أثناء الطريق. النبضة عند رصد الوصول هي الاحتفالية الوحيدة.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
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

const STEPS = ["SUBMITTED", "ACCEPTED", "PREPARING", "READY", "ON_THE_WAY", "ARRIVED", "COMPLETED"];
/* عناوين شريط الحالات السبع — حرفياً من P7.html (steps7) */
const STEP_LABELS = [
  "تم استلام الطلب",
  "تم قبول الطلب",
  "قيد التجهيز",
  "جاهز للاستلام",
  "في طريقك",
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
  CUSTOMER_NOTIFIED: { step: "READY", title: "طلبك جاهز", sub: "اضغط «انطلقت الآن» حين تتحرك" },
  CUSTOMER_ON_THE_WAY: { step: "ON_THE_WAY", title: "أنت في الطريق", sub: "المطعم يعرف وقت وصولك" },
  CUSTOMER_NEARBY: { step: "ON_THE_WAY", title: "اقتربت!", sub: "تم رصد اقترابك — أبلغنا المطعم تلقائيًا" },
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
const IconCar = ({ size = 24 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
    <g fill="none" stroke="currentColor" strokeWidth="7" strokeLinecap="round">
      <path d="M30,56 Q35,40 50,40 Q65,40 70,56" />
      <rect x="18" y="54" width="64" height="18" rx="9" />
      <circle cx="34" cy="78" r="6" strokeWidth="6" />
      <circle cx="66" cy="78" r="6" strokeWidth="6" />
    </g>
  </svg>
);
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
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [eta, setEta] = useState<number | null>(null);
  const tripTimer = useRef<ReturnType<typeof setInterval> | null>(null);

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

  useEffect(
    () => () => {
      if (tripTimer.current) clearInterval(tripTimer.current);
    },
    []
  );

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

  const startTrip = async () => {
    await api("POST", `/v1/orders/${id}/trip/start`);
    // إرسال الموقع الفعلي إن توفر — والرحلة تعمل يدوياً بدونه (docs/14§8)
    if (navigator.geolocation && !tripTimer.current) {
      tripTimer.current = setInterval(() => {
        navigator.geolocation.getCurrentPosition(async (pos) => {
          try {
            const res = await api<{ eta_minutes: number | null }>(
              "POST",
              `/v1/orders/${id}/trip/location`,
              {
                lat: pos.coords.latitude,
                lng: pos.coords.longitude,
                speed: pos.coords.speed,
                heading: pos.coords.heading,
                accuracy: pos.coords.accuracy
              }
            );
            if (res.eta_minutes !== null) setEta(res.eta_minutes);
          } catch {
            /* التتبع تحسين لا شرط */
          }
        });
      }, 8000);
    }
    await refresh();
  };

  const confirmArrival = async () => {
    if (tripTimer.current) clearInterval(tripTimer.current);
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
  const canArrive = DRIVE_STATES.includes(order.order_status);

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
            const C = 402.1; // محيط الحلقة r=64
            const frac = Math.min(Math.max(shown / totalMs, 0), 1);
            return (
              <div className={`pk-card ${s.prepCard} ${overtime ? s.prepOvertime : ""}`} data-testid="prep-expected">
                <p style={{ fontWeight: 700 }}>طلبك على النار الآن</p>
                <div className={s.prepRingWrap}>
                  <svg width="148" height="148" viewBox="0 0 148 148" fill="none">
                    <circle className={s.prepTrack} cx="74" cy="74" r="64" strokeWidth="9" />
                    <circle
                      className={s.prepFill}
                      cx="74"
                      cy="74"
                      r="64"
                      strokeWidth="9"
                      strokeDasharray={C}
                      strokeDashoffset={C * (1 - frac)}
                    />
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

        {/* بطاقة ETA الكبيرة — وضع القيادة (C-45) */}
        {driveMode && eta !== null && (
          <div className={`pk-card ${s.etaCard}`}>
            <span className={s.etaValue}>{eta} دقيقة</span>
            <p className="pk-muted">حتى وصولك — {order.brand_name_ar}</p>
          </div>
        )}

        {/* بطاقة السيارة (C-42/C-49) */}
        {order.vehicle && (
          <div className={`pk-card ${s.vehicleCard}`}>
            <span className={s.vehicleIcon}><IconCar /></span>
            <span className={s.parkingGrow}>
              <span className={s.vehicleName}>
                {[order.vehicle.model_ar, order.vehicle.color_ar, order.vehicle.plate_short].filter(Boolean).join(" · ")}
              </span>
              <span className="pk-muted">الموظف يعرف سيارتك مسبقًا</span>
            </span>
            {parkingLabel && <span className={s.spotBadge}>{parkingLabel}</span>}
          </div>
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

        {canStart && (
          <button className="pk-btn" data-testid="start-trip" onClick={startTrip}>انطلقت الآن</button>
        )}
        {canArrive && (
          <>
            <button className="pk-btn" data-testid="confirm-arrival" onClick={confirmArrival} style={{ marginTop: 8 }}>
              وصلت
            </button>
            <p className={s.footNote}>«وصلت» بيدك دائماً — ما نحوّل حالتك بالـGPS وحده أبداً</p>
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
                شكراً لك — تقييمك يطوّر التجربة 🌟
              </p>
            )}
          </div>
        )}
      </main>

      {/* Sheet الموقف (C-48): موقف مرقم 1–5 أو وصف حر */}
      {sheetOpen && (
        <div className={s.dim} role="dialog" aria-modal="true" aria-label="وين وقفت؟" onClick={() => setSheetOpen(false)}>
          <div className={s.sheet} onClick={(e) => e.stopPropagation()}>
            <div className={s.grab} />
            <b className={s.sheetTitle}>{arrived ? "وين وقفت؟" : "اختر موقفك"}</b>
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
