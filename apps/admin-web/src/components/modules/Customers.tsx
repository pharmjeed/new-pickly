"use client";

/**
 * A-07: عملاء المنصة — GET /api/v1/admin/customers جدول (شارة خطر عند risk_flagged)
 * + حظر/رفع POST /customers/{id}/block {action, reason} بنافذة سبب إلزامي.
 */
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, apiGet, apiPost } from "@/lib/api";
import ReasonModal from "@/components/ReasonModal";

type Customer = {
  id: string;
  phone_masked: string;
  full_name: string | null;
  status: string;
  orders: number;
  no_show_count_30d: number;
  risk_flagged: boolean;
};

const STATUS_AR: Record<string, { label: string; cls: string }> = {
  active: { label: "نشط", cls: "b-lime" },
  blocked: { label: "محظور", cls: "b-err" },
  deleted: { label: "حذف قيد المعالجة", cls: "b-soft" }
};

type PendingBlock = { customer: Customer; action: "block" | "unblock" };

export default function Customers() {
  const router = useRouter();
  const [customers, setCustomers] = useState<Customer[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingBlock | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    apiGet<Customer[]>("/api/v1/admin/customers")
      .then(setCustomers)
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
      await apiPost(`/api/v1/admin/customers/${pending.customer.id}/block`, {
        action: pending.action,
        reason
      });
      setNotice(
        pending.action === "block"
          ? `حُظر العميل ${pending.customer.phone_masked} — السبب دخل سجل التدقيق`
          : `رُفع الحظر عن العميل ${pending.customer.phone_masked}`
      );
      setPending(null);
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
        <div className="note err" data-testid="customers-error">
          {error}
        </div>
      )}
      {notice && (
        <div className="note info" data-testid="customers-notice">
          {notice}
        </div>
      )}

      {!customers && !error && <div className="skl" style={{ height: 260 }} />}

      {customers && customers.length === 0 && (
        <div className="empty">
          <div className="ic">👥</div>
          <b>لا عملاء بعد</b>
          <p>يظهر عملاء المنصة هنا فور تسجيلهم</p>
        </div>
      )}

      {customers && customers.length > 0 && (
        <div className="tblwrap">
          <table className="tbl" data-testid="customers-table">
            <thead>
              <tr>
                <th>العميل</th>
                <th>الجوال</th>
                <th>الطلبات</th>
                <th>No-show (30 يوماً)</th>
                <th>الحالة</th>
                <th>إجراء</th>
              </tr>
            </thead>
            <tbody>
              {customers.map((c) => {
                const badge = STATUS_AR[c.status] ?? { label: c.status, cls: "b-soft" };
                return (
                  <tr key={c.id} data-testid="customer-row">
                    <td>
                      <b>{c.full_name ?? "بدون اسم"}</b>
                      {c.risk_flagged && (
                        <span
                          className="badge b-warn"
                          style={{ fontSize: "10px", marginInlineStart: 8 }}
                          data-testid="customer-risk-badge"
                        >
                          إشارة مخاطر
                        </span>
                      )}
                    </td>
                    <td className="mono">{c.phone_masked}</td>
                    <td className="mono">{c.orders.toLocaleString("en")}</td>
                    <td className="mono">{c.no_show_count_30d}</td>
                    <td>
                      <span className={`badge ${badge.cls}`} style={{ fontSize: "10.5px" }} data-testid="customer-status">
                        {badge.label}
                      </span>
                    </td>
                    <td>
                      {c.status === "blocked" ? (
                        <button
                          type="button"
                          className="btn sm sec2"
                          data-testid="customer-block"
                          data-action="unblock"
                          onClick={() => setPending({ customer: c, action: "unblock" })}
                        >
                          رفع الحظر
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="btn sm dgh"
                          data-testid="customer-block"
                          data-action="block"
                          onClick={() => setPending({ customer: c, action: "block" })}
                        >
                          حظر
                        </button>
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
        البيانات مقنّعة افتراضياً — كشف جوال كامل يتطلب صلاحية أعلى وسبباً يُسجل · 3 No-show في 30 يوماً = إشارة مخاطر تلقائية (BR-3).
      </div>

      {pending && (
        <ReasonModal
          title={
            pending.action === "block"
              ? `حظر العميل ${pending.customer.phone_masked}`
              : `رفع الحظر عن العميل ${pending.customer.phone_masked}`
          }
          confirmLabel={pending.action === "block" ? "حظر" : "رفع الحظر"}
          danger={pending.action === "block"}
          busy={busy}
          onConfirm={confirm}
          onClose={() => setPending(null)}
        />
      )}
    </>
  );
}
