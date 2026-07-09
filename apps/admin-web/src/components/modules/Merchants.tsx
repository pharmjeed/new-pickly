"use client";

/**
 * A-03/A-04: التجار — GET /api/v1/admin/merchants جدول،
 * قبول POST /merchants/{id}/approve وتعليق POST /merchants/{id}/suspend —
 * كلاهما عبر نافذة سبب إلزامي ≥3 أحرف (BR-15).
 */
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, apiGet, apiPost, shortDate } from "@/lib/api";
import ReasonModal from "@/components/ReasonModal";

type Merchant = {
  id: string;
  name_ar: string;
  status: string;
  plan_key: string;
  branches: number;
  orders: number;
  created_at: string;
};

const STATUS_AR: Record<string, { label: string; cls: string }> = {
  pending_review: { label: "قيد الاعتماد", cls: "b-warn" },
  approved: { label: "نشط", cls: "b-lime" },
  suspended: { label: "معلق", cls: "b-err" },
  churned: { label: "منسحب", cls: "b-soft" }
};

const PLAN_AR: Record<string, string> = {
  pilot_basic: "باقة الطيار"
};

type PendingAction = { merchant: Merchant; kind: "approve" | "suspend" };

export default function Merchants() {
  const router = useRouter();
  const [merchants, setMerchants] = useState<Merchant[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<PendingAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    apiGet<Merchant[]>("/api/v1/admin/merchants")
      .then(setMerchants)
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
    if (!action) return;
    setBusy(true);
    setError(null);
    try {
      await apiPost(`/api/v1/admin/merchants/${action.merchant.id}/${action.kind}`, { reason });
      setNotice(
        action.kind === "approve"
          ? `اعتُمد التاجر «${action.merchant.name_ar}» — السبب دخل سجل التدقيق`
          : `عُلّق التاجر «${action.merchant.name_ar}» — السبب دخل سجل التدقيق`
      );
      setAction(null);
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {error && (
        <div className="note err" data-testid="merchants-error">
          {error}
        </div>
      )}
      {notice && (
        <div className="note info" data-testid="merchants-notice">
          {notice}
        </div>
      )}

      {!merchants && !error && <div className="skl" style={{ height: 260 }} />}

      {merchants && merchants.length === 0 && (
        <div className="empty">
          <div className="ic">🏪</div>
          <b>لا تجار بعد</b>
          <p>يظهر التجار هنا فور تقديم طلبات الانضمام</p>
        </div>
      )}

      {merchants && merchants.length > 0 && (
        <div className="tblwrap">
          <table className="tbl" data-testid="merchants-table">
            <thead>
              <tr>
                <th>التاجر</th>
                <th>الباقة</th>
                <th>الفروع</th>
                <th>الطلبات</th>
                <th>الانضمام</th>
                <th>الحالة</th>
                <th>أوامر المنصة</th>
              </tr>
            </thead>
            <tbody>
              {merchants.map((m) => {
                const badge = STATUS_AR[m.status] ?? { label: m.status, cls: "b-soft" };
                return (
                  <tr key={m.id} data-testid="merchant-row">
                    <td>
                      <b>{m.name_ar}</b>
                    </td>
                    <td>{PLAN_AR[m.plan_key] ?? m.plan_key}</td>
                    <td className="mono">{m.branches}</td>
                    <td className="mono">{m.orders.toLocaleString("en")}</td>
                    <td className="mono">{shortDate(m.created_at)}</td>
                    <td>
                      <span className={`badge ${badge.cls}`} style={{ fontSize: "10.5px" }} data-testid="merchant-status">
                        {badge.label}
                      </span>
                    </td>
                    <td>
                      <span style={{ display: "inline-flex", gap: 6 }}>
                        {m.status !== "approved" && (
                          <button
                            type="button"
                            className="btn sm"
                            data-testid="merchant-approve"
                            onClick={() => setAction({ merchant: m, kind: "approve" })}
                          >
                            قبول
                          </button>
                        )}
                        {m.status !== "suspended" && (
                          <button
                            type="button"
                            className="btn sm dgh"
                            data-testid="merchant-suspend"
                            onClick={() => setAction({ merchant: m, kind: "suspend" })}
                          >
                            تعليق
                          </button>
                        )}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {action && (
        <ReasonModal
          title={
            action.kind === "approve"
              ? `اعتماد التاجر «${action.merchant.name_ar}»`
              : `تعليق التاجر «${action.merchant.name_ar}» — يوقف الاستقبال`
          }
          confirmLabel={action.kind === "approve" ? "اعتماد" : "تعليق"}
          danger={action.kind === "suspend"}
          busy={busy}
          onConfirm={confirm}
          onClose={() => setAction(null)}
        />
      )}
    </>
  );
}
