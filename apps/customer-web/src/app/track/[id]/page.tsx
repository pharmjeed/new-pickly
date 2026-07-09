"use client";

/**
 * P7 ⭐ الطلب الحي (مصغرة): صفحة واحدة تقودها آلة الحالات —
 * الهيكل ثابت والمحتوى يتبدل (docs/21§1). وضع القيادة داكن أثناء الطريق.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "@/lib/api";

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

export default function TrackPage() {
  const { id } = useParams<{ id: string }>();
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [eta, setEta] = useState<number | null>(null);
  const tripTimer = useRef<ReturnType<typeof setInterval> | null>(null);

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
  };

  if (error) return <main className="pk-wrap"><div className="pk-card" style={{ color: "var(--pk-error)" }}>{error}</div></main>;
  if (!order) return <main className="pk-wrap"><div className="pk-loader"><span /><span /><span /></div></main>;

  const view = DISPLAY[order.order_status] ?? DISPLAY.MERCHANT_PENDING!;
  const stepIdx = STEPS.indexOf(view.step);
  const driveMode = DRIVE_STATES.includes(order.order_status);
  const canStart = ["MERCHANT_ACCEPTED", "PREPARING", "READY", "CUSTOMER_NOTIFIED"].includes(order.order_status);
  const canArrive = DRIVE_STATES.includes(order.order_status);

  return (
    <div className={driveMode ? "pk-drive" : ""}>
      <main className="pk-wrap">
        <p className="pk-mono pk-muted" data-testid="order-code" style={{ marginBottom: 4 }}>{order.display_code}</p>
        <div className="pk-steps" aria-label="حالة الطلب">
          {STEPS.map((s, i) => <i key={s} className={i <= stepIdx ? "on" : ""} />)}
        </div>

        <h1 className="pk-display" data-testid="track-title" style={{ fontSize: driveMode ? "var(--pk-fs-34)" : "var(--pk-fs-24)" }}>
          {view.title}
        </h1>
        <p className="pk-muted" style={{ marginBottom: 16 }}>{view.sub}</p>

        {driveMode && eta !== null && (
          <div className="pk-card" style={{ textAlign: "center" }}>
            <span className="pk-display" style={{ fontSize: "var(--pk-fs-34)" }}>{eta} دقيقة</span>
            <p className="pk-muted">حتى وصولك — {order.brand_name_ar}</p>
          </div>
        )}

        {order.vehicle && (
          <div className="pk-card">
            <span className="pk-chip">
              {[order.vehicle.model_ar, order.vehicle.color_ar, order.vehicle.plate_short].filter(Boolean).join(" · ")}
            </span>
            <p className="pk-muted" style={{ marginTop: 4 }}>الموظف يعرف سيارتك مسبقًا</p>
          </div>
        )}

        {order.handoff_code && ["CUSTOMER_ARRIVED", "HANDOFF_IN_PROGRESS"].includes(order.order_status) && (
          <div className="pk-card" style={{ textAlign: "center", background: "var(--pk-lime-500)", border: "none" }}>
            <p style={{ color: "var(--pk-ink-900)", fontSize: "var(--pk-fs-14)" }}>رمز الاستلام</p>
            <span className="pk-mono pk-display" data-testid="handoff-code" style={{ fontSize: 40, color: "var(--pk-ink-900)", letterSpacing: 8 }}>
              {order.handoff_code}
            </span>
          </div>
        )}

        {canStart && (
          <button className="pk-btn" data-testid="start-trip" onClick={startTrip}>انطلقت الآن</button>
        )}
        {canArrive && (
          <button className="pk-btn" data-testid="confirm-arrival" onClick={confirmArrival} style={{ marginTop: 8 }}>
            وصلت
          </button>
        )}

        {order.order_status === "COMPLETED" && (
          <div className="pk-card" data-testid="completed-box" style={{ textAlign: "center" }}>
            <span className="pk-badge ok">تم التسليم ✓</span>
          </div>
        )}
      </main>
    </div>
  );
}
