"use client";

/**
 * A-10: الاسترجاعات — GET /api/v1/admin/refunds جدول +
 * قرار POST /refunds/{id}/decision {decision: approve|reject, reason} بنافذة سبب إلزامي.
 */
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, apiGet, apiPost, sar, shortDateTime } from "@/lib/api";
import ReasonModal from "@/components/ReasonModal";

type Refund = {
  id: string;
  order_code: string;
  amount_halalas: number;
  reason: string;
  status: string;
  requested_by: string;
  created_at: string;
};

const STATUS_AR: Record<string, { label: string; cls: string }> = {
  pending: { label: "بانتظار قرار", cls: "b-warn" },
  processing: { label: "قيد التنفيذ", cls: "b-warn" },
  completed: { label: "نُفذ ✓", cls: "b-ok" },
  failed: { label: "فشل التنفيذ", cls: "b-err" },
  rejected: { label: "مرفوض", cls: "b-err" }
};

type PendingDecision = { refund: Refund; decision: "approve" | "reject" };

export default function Refunds() {
  const router = useRouter();
  const [refunds, setRefunds] = useState<Refund[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingDecision | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    apiGet<Refund[]>("/api/v1/admin/refunds")
      .then(setRefunds)
      .catch((e: unknown) => {
        if (e instanceof ApiError && e.status === 401) {
          router.replace("/");
          return;
        }
        setError((e as Error).message);
      });
  }, [router]);

  useEffect(load, [load]);

  const confirm = async (reason: string) => {
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      await apiPost(`/api/v1/admin/refunds/${pending.refund.id}/decision`, {
        decision: pending.decision,
        reason
      });
      setNotice(
        pending.decision === "approve"
          ? `اعتُمد استرجاع ${pending.refund.order_code} — ينفذه معالج الاسترجاعات عند البوابة`
          : `رُفض استرجاع ${pending.refund.order_code} — السبب دخل سجل التدقيق`
      );
      setPending(null);
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const pendingCount = refunds?.filter((r) => r.status === "pending").length ?? 0;

  return (
    <>
      {error && (
        <div className="note err" data-testid="refunds-error">
          {error}
        </div>
      )}
      {notice && (
        <div className="note info" data-testid="refunds-notice">
          {notice}
        </div>
      )}

      {!refunds && !error && <div className="skl" style={{ height: 260 }} />}

      {refunds && (
        <div className="kpis">
          <div className="kpi" data-testid="admin-stat" data-stat="refunds_pending_decision">
            <div className="k">بانتظار قرار</div>
            <div className="v">{pendingCount}</div>
          </div>
          <div className="kpi" data-testid="admin-stat" data-stat="refunds_total">
            <div className="k">إجمالي السجل المعروض</div>
            <div className="v">{refunds.length}</div>
          </div>
        </div>
      )}

      {refunds && refunds.length === 0 && (
        <div className="empty">
          <div className="ic">↩</div>
          <b>لا استرجاعات</b>
          <p>يظهر طابور القرارات هنا فور ورود طلبات استرجاع</p>
        </div>
      )}

      {refunds && refunds.length > 0 && (
        <div className="tblwrap">
          <table className="tbl" data-testid="refunds-table">
            <thead>
              <tr>
                <th>الطلب</th>
                <th>السبب</th>
                <th>المبلغ</th>
                <th>طلبه</th>
                <th>الوقت</th>
                <th>الحالة</th>
                <th>قرار</th>
              </tr>
            </thead>
            <tbody>
              {refunds.map((r) => {
                const badge = STATUS_AR[r.status] ?? { label: r.status, cls: "b-soft" };
                return (
                  <tr key={r.id} data-testid="refund-row">
                    <td className="mono">
                      <b>{r.order_code}</b>
                    </td>
                    <td>{r.reason}</td>
                    <td className="mono">{sar(r.amount_halalas)}</td>
                    <td className="mono">{r.requested_by}</td>
                    <td className="mono">{shortDateTime(r.created_at)}</td>
                    <td>
                      <span className={`badge ${badge.cls}`} style={{ fontSize: "10.5px" }} data-testid="refund-status">
                        {badge.label}
                      </span>
                    </td>
                    <td>
                      {r.status === "pending" ? (
                        <span style={{ display: "inline-flex", gap: 6 }}>
                          <button
                            type="button"
                            className="btn sm"
                            data-testid="refund-decision"
                            data-decision="approve"
                            onClick={() => setPending({ refund: r, decision: "approve" })}
                          >
                            اعتماد
                          </button>
                          <button
                            type="button"
                            className="btn sm dgh"
                            data-testid="refund-decision"
                            data-decision="reject"
                            onClick={() => setPending({ refund: r, decision: "reject" })}
                          >
                            رفض
                          </button>
                        </span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="note soft">
        منع التكرار: refund_items يقفل العناصر المسترجعة — أي محاولة استرجاع ثانية على نفس العنصر تُرفض آلياً وتُسجل.
      </div>

      {pending && (
        <ReasonModal
          title={
            pending.decision === "approve"
              ? `اعتماد استرجاع ${pending.refund.order_code} بقيمة ${sar(pending.refund.amount_halalas)} ريال`
              : `رفض استرجاع ${pending.refund.order_code}`
          }
          confirmLabel={pending.decision === "approve" ? "اعتماد الاسترجاع" : "رفض الاسترجاع"}
          danger={pending.decision === "reject"}
          busy={busy}
          onConfirm={confirm}
          onClose={() => setPending(null)}
        />
      )}
    </>
  );
}
