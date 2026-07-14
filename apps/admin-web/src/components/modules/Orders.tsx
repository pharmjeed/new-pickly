"use client";

/**
 * A-08: طلبات المنصة — GET /api/v1/admin/orders?limit=50 جدول،
 * وعند الضغط GET /orders/{id}/timeline يعرض الخط الزمني (drawer اللوحة A-08).
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, apiGet, sar, shortDateTime, shortTime } from "@/lib/api";
import s from "./orders.module.css";
import { Qirtas, QirtasLoader } from "@/components/qirtas";

type AdminOrder = {
  id: string;
  display_code: string;
  order_status: string;
  brand: string;
  branch: string;
  customer_phone_masked: string;
  total_halalas: number;
  created_at: string;
};

type TimelineEvent = {
  from: string | null;
  to: string;
  actor: string;
  reason: string | null;
  at: string;
};

/** فئة شارة الحالة الداخلية — ألوان حالات الطلب (08§2) */
function statusCls(st: string): string {
  if (["COMPLETED", "REFUNDED", "PARTIALLY_REFUNDED"].includes(st)) return "p-done";
  if (["ORDER_SUBMITTED", "MERCHANT_PENDING"].includes(st)) return "p-new";
  if (["MERCHANT_ACCEPTED", "PREPARING", "READY", "CUSTOMER_NOTIFIED"].includes(st)) return "p-prep";
  if (["CUSTOMER_ON_THE_WAY", "CUSTOMER_NEARBY"].includes(st)) return "p-near";
  if (["CUSTOMER_ARRIVED", "HANDOFF_IN_PROGRESS"].includes(st)) return "p-arr";
  if (["CANCELLED", "NO_SHOW", "EXPIRED", "PAYMENT_FAILED", "MERCHANT_REJECTED"].includes(st)) return "p-over";
  return "b-soft";
}

const ACTOR_AR: Record<string, string> = {
  customer: "العميل",
  merchant_staff: "طاقم الفرع",
  admin: "الأدمن",
  system: "النظام"
};

export default function Orders() {
  const router = useRouter();
  const [orders, setOrders] = useState<AdminOrder[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<TimelineEvent[] | null>(null);
  const [timelineError, setTimelineError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<AdminOrder[]>("/api/v1/admin/orders?limit=50")
      .then(setOrders)
      .catch((e: unknown) => {
        if (e instanceof ApiError && e.status === 401) {
          router.replace("/");
          return;
        }
        setError((e as Error).message);
      });
  }, [router]);

  const openTimeline = (id: string) => {
    if (openId === id) {
      setOpenId(null);
      setTimeline(null);
      return;
    }
    setOpenId(id);
    setTimeline(null);
    setTimelineError(null);
    apiGet<TimelineEvent[]>(`/api/v1/admin/orders/${id}/timeline`)
      .then(setTimeline)
      .catch((e: unknown) => setTimelineError((e as Error).message));
  };

  const open = orders?.find((o) => o.id === openId) ?? null;

  return (
    <>
      {error && (
        <div className="note err" data-testid="orders-error">
          {error}
        </div>
      )}

      {!orders && !error && <div className="loadwrap" style={{ minHeight: 260 }}><QirtasLoader /></div>}

      {orders && orders.length === 0 && (
        <div className="empty">
          <div className="qr"><Qirtas mood="sleepy" size={72} /></div>
          <b>لا طلبات بعد</b>
          <p>تظهر طلبات كل التجار هنا فور وصولها</p>
        </div>
      )}

      {orders && orders.length > 0 && (
        <div className={open ? s.split : undefined}>
          <div className="tblwrap">
            <table className="tbl" data-testid="orders-table">
              <thead>
                <tr>
                  <th>الطلب</th>
                  <th>التاجر / الفرع</th>
                  <th>العميل</th>
                  <th>القيمة</th>
                  <th>الحالة الداخلية</th>
                  <th>الوقت</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr
                    key={o.id}
                    data-testid="order-row"
                    className={`${s.row} ${openId === o.id ? s.rowOn : ""}`}
                    onClick={() => openTimeline(o.id)}
                  >
                    <td className="mono">
                      <b>{o.display_code}</b>
                    </td>
                    <td>
                      {o.brand} / {o.branch}
                    </td>
                    <td className="mono">{o.customer_phone_masked}</td>
                    <td className="mono">{sar(o.total_halalas)}</td>
                    <td>
                      <span className={`badge ${statusCls(o.order_status)}`} style={{ fontSize: "10px" }}>
                        <span className="mono">{o.order_status}</span>
                      </span>
                    </td>
                    <td className="mono">{shortDateTime(o.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {open && (
            <aside className={`pcardx ${s.drawer}`} data-testid="order-timeline">
              <h3>
                <span className="mono">{open.display_code}</span> — سجل كامل
                <span className="sp">
                  <span className={`badge ${statusCls(open.order_status)}`} style={{ fontSize: "10.5px" }}>
                    <span className="mono">{open.order_status}</span>
                  </span>
                </span>
              </h3>
              {timelineError && <div className="note err">{timelineError}</div>}
              {!timeline && !timelineError && <div className="loadwrap" style={{ minHeight: 120 }}><QirtasLoader /></div>}
              {timeline && timeline.length === 0 && <p className="muted">لا انتقالات مسجلة.</p>}
              {timeline && timeline.length > 0 && (
                <div className="tline">
                  {timeline.map((ev, i) => (
                    <div key={i} className={`ev ${ev.reason ? "warn" : "ok"}`} data-testid="timeline-event">
                      <div className="t">
                        <span className="mono">{ev.to}</span> · {ACTOR_AR[ev.actor] ?? ev.actor}
                        {ev.reason ? ` — ${ev.reason}` : ""}
                      </div>
                      <div className="m">{shortTime(ev.at)}</div>
                    </div>
                  ))}
                </div>
              )}
              <p className="muted" style={{ fontSize: 11 }}>
                كل انتقال حالة محفوظ بمن ومتى ولماذا — لا حذف ولا تعديل من أي واجهة (05§4-5).
              </p>
            </aside>
          )}
        </div>
      )}
    </>
  );
}
