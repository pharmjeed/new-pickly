"use client";

/**
 * P7 ⭐ الطلب الحي: صفحة واحدة تقودها آلة الحالات —
 * الهيكل ثابت والمحتوى يتبدل (docs/21§1، design/customer/P7.html C-38→C-51).
 * وضع القيادة داكن إجباري أثناء الطريق. النبضة عند رصد الوصول هي الاحتفالية الوحيدة.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "@/lib/api";
import s from "./track.module.css";

interface Order {
  id: string;
  display_code: string;
  order_status: string;
  brand_name_ar: string;
  handoff_code: string | null;
  prep_minutes: number | null;
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
  MERCHANT_ACCEPTED: { step: "ACCEPTED", title: "قبل المطعم طلبك", sub: "المطعم يجهّز طلبك على وقت وصولك" },
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
const PARKING_SPOTS = [1, 2, 3, 4, 5];

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

  // Sheet الموقف (C-48): موقف مرقم أو وصف حر — POST /v1/orders/{id}/parking-spot
  const [sheetOpen, setSheetOpen] = useState(false);
  const [spotSel, setSpotSel] = useState<number | null>(null);
  const [freeText, setFreeText] = useState("");
  const [parkingLabel, setParkingLabel] = useState<string | null>(null);
  const [savingSpot, setSavingSpot] = useState(false);
  const [spotErr, setSpotErr] = useState<string | null>(null);

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
    const text = spotSel !== null ? `الموقف ${spotSel}` : freeText.trim();
    if (!text) return;
    setSavingSpot(true);
    setSpotErr(null);
    try {
      await api("POST", `/v1/orders/${id}/parking-spot`, { free_text: text });
      setParkingLabel(text);
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

  const view = DISPLAY[order.order_status] ?? DISPLAY.MERCHANT_PENDING!;
  const stepIdx = STEPS.indexOf(view.step);
  const completed = order.order_status === "COMPLETED";
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
            const done = completed || i < stepIdx;
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

        <h1 className="pk-display" data-testid="track-title" style={{ fontSize: driveMode ? "var(--pk-fs-34)" : "var(--pk-fs-24)" }}>
          {view.title}
        </h1>
        <p className="pk-muted" style={{ marginBottom: 16 }}>{view.sub}</p>

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
            <b className={s.sheetTitle}>وين وقفت؟</b>
            <p className={s.sheetHint}>تحديد موقفك يوصل راشد لسيارتك مباشرة — بلا لف ولا اتصال.</p>
            <div className={s.spotGrid}>
              {PARKING_SPOTS.map((n) => (
                <button
                  key={n}
                  type="button"
                  className={`${s.spotBtn} ${spotSel === n ? s.spotBtnOn : ""}`}
                  onClick={() => { setSpotSel(spotSel === n ? null : n); setFreeText(""); }}
                >
                  {n}
                </button>
              ))}
            </div>
            <p className={s.spotGridHint}>مواقف «استلام بيكلي» المرقمة — خلف الواجهة</p>
            <div>
              <label className={s.fldLabel} htmlFor="parking-free-text">صف مكان سيارتك للموظف</label>
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
