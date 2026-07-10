"use client";

/**
 * A-16: المخاطر (مرحلة 2) — إشارات docs/17§6 محسوبة آلياً من البيانات:
 * تعليم يدوي، تكرار عدم الحضور (BR-3)، إساءة الاسترجاع، نزاعات مفتوحة.
 * الإجراء: تعليم/رفع تعليم بسبب (يبث risk.alert_raised) — الحظر من وحدة العملاء.
 */
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, apiGet, apiPost } from "@/lib/api";
import ReasonModal from "@/components/ReasonModal";

type Alert = {
  user_id: string | null;
  phone_masked: string | null;
  name: string | null;
  signal: string;
  severity: "high" | "medium";
  detail: string;
  user_status: string | null;
};

const SIGNAL_AR: Record<string, string> = {
  risk_flagged: "مُعلَّم",
  no_show_repeat: "تكرار عدم حضور",
  refund_abuse: "إساءة استرجاع",
  open_dispute: "نزاع مفتوح"
};

type PendingAction = { alert: Alert; action: "flag" | "clear" };

export default function Risk() {
  const router = useRouter();
  const [alerts, setAlerts] = useState<Alert[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PendingAction | null>(null);

  const load = useCallback(() => {
    apiGet<Alert[]>("/api/v1/admin/risk/alerts")
      .then(setAlerts)
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
    if (!pending?.alert.user_id) return;
    setBusy(true);
    setError(null);
    try {
      await apiPost(`/api/v1/admin/risk/customers/${pending.alert.user_id}/flag`, {
        action: pending.action,
        reason
      });
      setNotice(pending.action === "flag" ? "عُلّم العميل وبُث risk.alert_raised" : "رُفع التعليم عن العميل");
      setPending(null);
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const highCount = alerts?.filter((a) => a.severity === "high").length ?? 0;

  return (
    <>
      {error && <div className="note err" data-testid="risk-error">{error}</div>}
      {notice && <div className="note info" data-testid="risk-notice">{notice}</div>}
      {!alerts && !error && <div className="skl" style={{ height: 260 }} />}

      {alerts && (
        <div className="kpis">
          <div className="kpi" data-testid="admin-stat" data-stat="risk_high">
            <div className="k">تنبيهات عالية</div>
            <div className="v">{highCount}</div>
          </div>
          <div className="kpi" data-testid="admin-stat" data-stat="risk_total">
            <div className="k">إجمالي التنبيهات</div>
            <div className="v">{alerts.length}</div>
          </div>
        </div>
      )}

      {alerts && alerts.length === 0 && (
        <div className="empty">
          <div className="ic">🛡</div>
          <b>لا تنبيهات مخاطر</b>
          <p>الإشارات تُحسب آلياً من عدم الحضور والاسترجاعات والنزاعات</p>
        </div>
      )}

      {alerts && alerts.length > 0 && (
        <div className="tblwrap">
          <table className="tbl" data-testid="risk-table">
            <thead>
              <tr>
                <th>الإشارة</th>
                <th>العميل</th>
                <th>التفصيل</th>
                <th>الخطورة</th>
                <th>حالة الحساب</th>
                <th>إجراء</th>
              </tr>
            </thead>
            <tbody>
              {alerts.map((a, i) => (
                <tr key={`${a.signal}-${a.user_id ?? i}`} data-testid="risk-row">
                  <td><b>{SIGNAL_AR[a.signal] ?? a.signal}</b></td>
                  <td className="mono">{a.name ?? a.phone_masked ?? "—"}</td>
                  <td>{a.detail}</td>
                  <td>
                    <span className={`badge ${a.severity === "high" ? "b-err" : "b-warn"}`} data-testid="risk-severity">
                      {a.severity === "high" ? "عالية" : "متوسطة"}
                    </span>
                  </td>
                  <td>
                    {a.user_status ? (
                      <span className={`badge ${a.user_status === "blocked" ? "b-err" : "b-soft"}`}>
                        {a.user_status === "blocked" ? "محظور" : "نشط"}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>
                    {a.user_id ? (
                      <button
                        type="button"
                        className={`btn sm${a.signal === "risk_flagged" ? "" : " dgh"}`}
                        data-testid="risk-action"
                        onClick={() => setPending({ alert: a, action: a.signal === "risk_flagged" ? "clear" : "flag" })}
                      >
                        {a.signal === "risk_flagged" ? "رفع التعليم" : "تعليم"}
                      </button>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="note soft">
        كل إشارة بدرجة وسبب وأدلة (docs/17§6) — الحظر النهائي من وحدة العملاء بسبب موثق، وكل قرار يدخل سجل التدقيق.
      </div>

      {pending && (
        <ReasonModal
          title={pending.action === "flag" ? `تعليم ${pending.alert.name ?? pending.alert.phone_masked ?? "العميل"} كمخاطرة` : "رفع تعليم المخاطرة"}
          confirmLabel={pending.action === "flag" ? "تعليم" : "رفع التعليم"}
          danger={pending.action === "flag"}
          busy={busy}
          onConfirm={confirm}
          onClose={() => setPending(null)}
        />
      )}
    </>
  );
}
