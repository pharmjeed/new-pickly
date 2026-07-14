"use client";

/**
 * C-56 / W-09 — طلباتي: قائمة طلبات العميل من GET /v1/customers/me/orders
 * بتبويبات (نشطة / سابقة / ملغاة) — كل بطاقة تفتح صفحة التتبع /track/[id].
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { api, fmtSar, getToken } from "@/lib/api";
import { GuestGate, IStore, TabBar } from "../shell";
import { QirtasEmptyLive } from "../qirtas-motion";
import styles from "../page.module.css";

interface OrderSummary {
  id: string;
  display_code: string;
  order_status: string;
  branch_id: string;
  brand_name_ar: string;
  logo_url: string | null;
  items_count: number;
  items_preview_ar: string | null;
  total_halalas: number;
  pickup_time: string;
  scheduled_start: string | null;
  created_at: string;
}

const ACTIVE_STATES = new Set([
  "ORDER_SUBMITTED",
  "MERCHANT_PENDING",
  "MERCHANT_ACCEPTED",
  "PREPARING",
  "READY",
  "CUSTOMER_NOTIFIED",
  "CUSTOMER_ON_THE_WAY",
  "CUSTOMER_NEARBY",
  "CUSTOMER_ARRIVED",
  "HANDOFF_IN_PROGRESS"
]);
const CANCELLED_STATES = new Set([
  "MERCHANT_REJECTED",
  "CANCELLATION_REQUESTED",
  "CANCELLED",
  "NO_SHOW",
  "REFUND_PENDING",
  "PARTIALLY_REFUNDED",
  "REFUNDED"
]);

const STATUS_AR: Record<string, string> = {
  ORDER_SUBMITTED: "أُرسل الطلب",
  MERCHANT_PENDING: "بانتظار قبول المطعم",
  MERCHANT_ACCEPTED: "قبل المطعم طلبك",
  MERCHANT_REJECTED: "اعتذر المطعم",
  PREPARING: "قيد التجهيز",
  READY: "جاهز للاستلام",
  CUSTOMER_NOTIFIED: "جاهز — بانتظار انطلاقك",
  CUSTOMER_ON_THE_WAY: "أنت في الطريق",
  CUSTOMER_NEARBY: "اقتربت",
  CUSTOMER_ARRIVED: "وصلت",
  HANDOFF_IN_PROGRESS: "الموظف متجه إليك",
  COMPLETED: "تم التسليم",
  CANCELLATION_REQUESTED: "جارٍ الإلغاء",
  CANCELLED: "أُلغي",
  NO_SHOW: "لم يُستلم",
  REFUND_PENDING: "جارٍ الاسترجاع",
  PARTIALLY_REFUNDED: "استُرجع جزئياً",
  REFUNDED: "استُرجع"
};

type Tab = "active" | "past" | "cancelled";

function chipClass(status: string): string {
  if (ACTIVE_STATES.has(status)) return `${styles.stChip} ${styles.stChipActive}`;
  if (CANCELLED_STATES.has(status)) return `${styles.stChip} ${styles.stChipBad}`;
  return `${styles.stChip} ${styles.stChipDone}`;
}

export default function OrdersPage() {
  const [orders, setOrders] = useState<OrderSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("active");
  const [guest, setGuest] = useState<boolean | null>(null);

  useEffect(() => {
    if (!getToken()) {
      setGuest(true);
      return;
    }
    setGuest(false);
    api<OrderSummary[]>("GET", "/v1/customers/me/orders")
      .then(setOrders)
      .catch((e: Error) => setError(e.message));
  }, []);

  const byTab = (o: OrderSummary): Tab =>
    ACTIVE_STATES.has(o.order_status) ? "active" : CANCELLED_STATES.has(o.order_status) ? "cancelled" : "past";
  const filtered = (orders ?? []).filter((o) => byTab(o) === tab);
  // «نشطة» فارغة وثمة طلبات سابقة؟ لا نترك المستخدم أمام شاشة فارغة عند الدخول
  useEffect(() => {
    if (orders && tab === "active" && orders.every((o) => byTab(o) !== "active") && orders.length > 0) {
      setTab("past");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders]);

  return (
    <main className={styles.page}>
      <div className={styles.pageHead}>
        <h1>طلباتي</h1>
      </div>

      <div className={styles.body}>
        {guest && <GuestGate next="/orders" message="طلباتك النشطة والسابقة تظهر هنا بعد تسجيل الدخول" />}

        {guest === false && (
          <>
            <div className={styles.chips} data-testid="orders-tabs">
              {(
                [
                  ["active", "نشطة"],
                  ["past", "سابقة"],
                  ["cancelled", "ملغاة ومسترجعة"]
                ] as Array<[Tab, string]>
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  className={key === tab ? `${styles.chip} ${styles.chipOn}` : styles.chip}
                  onClick={() => setTab(key)}
                >
                  {label}
                </button>
              ))}
            </div>

            {error && (
              <div className={styles.noteErr} role="alert">
                <span>{error}</span>
              </div>
            )}

            {!orders && !error && (
              <div className={styles.col} aria-label="جارٍ التحميل" aria-busy="true">
                <div className={`${styles.skl} ${styles.sklH96}`} />
                <div className={`${styles.skl} ${styles.sklH96}`} />
              </div>
            )}

            {orders && filtered.length === 0 && (
              <div className={`${styles.empty} pk-in`}>
                <QirtasEmptyLive mood="sleepy">
                  <b>{tab === "active" ? "لا طلبات نشطة" : "لا طلبات هنا"}</b>
                  <p>اطلب من مطعمك المفضل وخلّنا على السيارة</p>
                  <Link href="/restaurants" className={styles.gateBtn}>
                    تصفح المطاعم
                  </Link>
                </QirtasEmptyLive>
              </div>
            )}

            {filtered.map((o, i) => (
              <Link
                key={o.id}
                href={`/track/${o.id}`}
                className={`${styles.ordCard} pk-in`}
                style={{ animationDelay: `${Math.min(i, 7) * 60}ms` }}
                data-testid="order-card"
              >
                <div className={styles.ordLogo}>
                  {o.logo_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={o.logo_url} alt="" />
                  ) : (
                    <IStore size={24} />
                  )}
                </div>
                <div className={styles.ordBd}>
                  <div className={styles.ordTop}>
                    <span className={styles.ordBrand}>{o.brand_name_ar}</span>
                    <span className={chipClass(o.order_status)}>{STATUS_AR[o.order_status] ?? o.order_status}</span>
                  </div>
                  <div className={styles.ordMeta}>
                    {o.items_count} {o.items_count === 1 ? "صنف" : "أصناف"}
                    {o.items_preview_ar ? ` — ${o.items_preview_ar}` : ""}
                    {o.scheduled_start
                      ? ` · مجدول ${new Date(o.scheduled_start).toLocaleString("ar-SA", { weekday: "long", hour: "2-digit", minute: "2-digit" })}`
                      : ""}
                  </div>
                  <div className={styles.ordFoot}>
                    <span className={styles.ordCode}>
                      {o.display_code} ·{" "}
                      {new Date(o.created_at).toLocaleDateString("ar-SA", { day: "numeric", month: "short" })}
                    </span>
                    <b>{fmtSar(o.total_halalas)}</b>
                  </div>
                </div>
              </Link>
            ))}
          </>
        )}
      </div>

      <TabBar />
    </main>
  );
}
