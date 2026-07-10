"use client";

/**
 * A-15: الدعم (مرحلة 2) — تذاكر ببيانات الطلب مدمجة (FR-A09):
 * قائمة GET /support-tickets + تفصيلة برسائلها + رد يعلّم pending_customer
 * + تغيير حالة بسبب يدخل سجل التدقيق.
 */
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, apiGet, apiPost, shortDateTime } from "@/lib/api";
import ReasonModal from "@/components/ReasonModal";

type TicketRow = {
  id: string;
  subject: string;
  status: string;
  priority: string;
  customer_phone_masked: string | null;
  customer_name: string | null;
  order_code: string | null;
  messages: number;
  created_at: string;
  updated_at: string;
};

type TicketDetail = {
  id: string;
  subject: string;
  status: string;
  customer_phone_masked: string | null;
  customer_name: string | null;
  order_id: string | null;
  messages: Array<{ id: string; author: string; body: string; created_at: string }>;
};

const STATUS_AR: Record<string, { label: string; cls: string }> = {
  open: { label: "مفتوحة", cls: "b-warn" },
  pending_customer: { label: "بانتظار العميل", cls: "b-soft" },
  pending_merchant: { label: "بانتظار التاجر", cls: "b-soft" },
  resolved: { label: "محلولة ✓", cls: "b-ok" },
  closed: { label: "مغلقة", cls: "b-soft" }
};

const AUTHOR_AR: Record<string, string> = {
  customer: "العميل",
  admin: "الدعم",
  merchant_staff: "التاجر",
  system: "النظام"
};

export default function Support() {
  const router = useRouter();
  const [tickets, setTickets] = useState<TicketRow[] | null>(null);
  const [detail, setDetail] = useState<TicketDetail | null>(null);
  const [reply, setReply] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingStatus, setPendingStatus] = useState<"resolved" | "closed" | null>(null);

  const load = useCallback(() => {
    apiGet<TicketRow[]>("/api/v1/admin/support-tickets")
      .then(setTickets)
      .catch((e: unknown) => {
        if (e instanceof ApiError && e.status === 401) {
          router.replace("/");
          return;
        }
        setError((e as Error).message);
      });
  }, [router]);

  useEffect(load, [load]);

  const open = (id: string) => {
    setDetail(null);
    setReply("");
    apiGet<TicketDetail>(`/api/v1/admin/support-tickets/${id}`)
      .then(setDetail)
      .catch((e: unknown) => setError((e as Error).message));
  };

  const sendReply = async () => {
    if (!detail || reply.trim().length === 0) return;
    setBusy(true);
    setError(null);
    try {
      await apiPost(`/api/v1/admin/support-tickets/${detail.id}/reply`, { body: reply.trim() });
      setNotice("أُرسل الرد وأُشعر العميل داخل التطبيق");
      setReply("");
      open(detail.id);
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const confirmStatus = async (reason: string) => {
    if (!detail || !pendingStatus) return;
    setBusy(true);
    setError(null);
    try {
      await apiPost(`/api/v1/admin/support-tickets/${detail.id}/status`, {
        status: pendingStatus,
        reason
      });
      setNotice(pendingStatus === "resolved" ? "عُلّمت التذكرة محلولة" : "أُغلقت التذكرة");
      setPendingStatus(null);
      open(detail.id);
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const openCount = tickets?.filter((t) => t.status === "open").length ?? 0;

  return (
    <>
      {error && <div className="note err" data-testid="support-error">{error}</div>}
      {notice && <div className="note info" data-testid="support-notice">{notice}</div>}
      {!tickets && !error && <div className="skl" style={{ height: 260 }} />}

      {tickets && (
        <div className="kpis">
          <div className="kpi" data-testid="admin-stat" data-stat="tickets_open">
            <div className="k">مفتوحة</div>
            <div className="v">{openCount}</div>
          </div>
          <div className="kpi" data-testid="admin-stat" data-stat="tickets_total">
            <div className="k">إجمالي السجل المعروض</div>
            <div className="v">{tickets.length}</div>
          </div>
        </div>
      )}

      {tickets && tickets.length === 0 && (
        <div className="empty">
          <div className="ic">🎧</div>
          <b>لا تذاكر</b>
          <p>تظهر تذاكر العملاء هنا فور إنشائها من التطبيق</p>
        </div>
      )}

      {tickets && tickets.length > 0 && (
        <div className="tblwrap">
          <table className="tbl" data-testid="support-table">
            <thead>
              <tr>
                <th>الموضوع</th>
                <th>العميل</th>
                <th>الطلب</th>
                <th>رسائل</th>
                <th>آخر تحديث</th>
                <th>الحالة</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {tickets.map((t) => {
                const badge = STATUS_AR[t.status] ?? { label: t.status, cls: "b-soft" };
                return (
                  <tr key={t.id} data-testid="ticket-row">
                    <td><b>{t.subject}</b></td>
                    <td className="mono">{t.customer_name ?? t.customer_phone_masked ?? "—"}</td>
                    <td className="mono">{t.order_code ?? "—"}</td>
                    <td className="mono">{t.messages}</td>
                    <td className="mono">{shortDateTime(t.updated_at)}</td>
                    <td>
                      <span className={`badge ${badge.cls}`} data-testid="ticket-status">{badge.label}</span>
                    </td>
                    <td>
                      <button type="button" className="btn sm" data-testid="ticket-open" onClick={() => open(t.id)}>
                        فتح
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {detail && (
        <div className="pcardx" style={{ marginTop: 14 }} data-testid="ticket-detail">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <b>{detail.subject}</b>
            <span style={{ display: "inline-flex", gap: 6 }}>
              {detail.status !== "resolved" && (
                <button type="button" className="btn sm" data-testid="ticket-resolve" onClick={() => setPendingStatus("resolved")}>
                  حُلّت
                </button>
              )}
              {detail.status !== "closed" && (
                <button type="button" className="btn sm dgh" data-testid="ticket-close" onClick={() => setPendingStatus("closed")}>
                  إغلاق
                </button>
              )}
            </span>
          </div>
          <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
            {detail.messages.map((m) => (
              <div key={m.id} className={`note ${m.author === "admin" ? "info" : "soft"}`} data-testid="ticket-message">
                <b>{AUTHOR_AR[m.author] ?? m.author}:</b> {m.body}
                <span className="muted" style={{ marginInlineStart: 8, fontSize: 11 }}>{shortDateTime(m.created_at)}</span>
              </div>
            ))}
          </div>
          {detail.status !== "closed" && (
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <input
                className="inp"
                style={{ flex: 1 }}
                placeholder="اكتب ردك للعميل…"
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                data-testid="ticket-reply-input"
              />
              <button type="button" className="btn sm" disabled={busy || reply.trim().length === 0} onClick={sendReply} data-testid="ticket-reply-send">
                إرسال الرد
              </button>
            </div>
          )}
        </div>
      )}

      <div className="note soft">
        الرد يصل صندوق إشعارات العميل (C-62) ويحوّل الحالة لبانتظار العميل — الحل والإغلاق بسبب يدخل سجل التدقيق.
      </div>

      {pendingStatus && detail && (
        <ReasonModal
          title={pendingStatus === "resolved" ? `تعليم «${detail.subject}» محلولة` : `إغلاق «${detail.subject}»`}
          confirmLabel={pendingStatus === "resolved" ? "حُلّت" : "إغلاق نهائي"}
          danger={pendingStatus === "closed"}
          busy={busy}
          onConfirm={confirmStatus}
          onClose={() => setPendingStatus(null)}
        />
      )}
    </>
  );
}
