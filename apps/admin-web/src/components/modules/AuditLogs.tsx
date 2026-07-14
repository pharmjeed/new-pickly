"use client";

/**
 * A-22: سجل العمليات — GET /api/v1/admin/audit-logs جدول (append-only، لا حذف من الواجهة).
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, apiGet, shortDateTime } from "@/lib/api";
import { Qirtas, QirtasLoader } from "@/components/qirtas";

type AuditLog = {
  id: string;
  actor_type: string;
  action: string;
  entity_type: string;
  entity_id: string;
  reason: string | null;
  created_at: string;
};

const ACTOR_AR: Record<string, string> = {
  customer: "عميل",
  merchant_staff: "طاقم تاجر",
  admin: "أدمن",
  system: "النظام"
};

export default function AuditLogs() {
  const router = useRouter();
  const [logs, setLogs] = useState<AuditLog[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<AuditLog[]>("/api/v1/admin/audit-logs")
      .then(setLogs)
      .catch((e: unknown) => {
        if (e instanceof ApiError && e.status === 401) {
          router.replace("/");
          return;
        }
        setError((e as Error).message);
      });
  }, [router]);

  return (
    <>
      {error && (
        <div className="note err" data-testid="audit-error">
          {error}
        </div>
      )}

      {!logs && !error && <div className="loadwrap" style={{ minHeight: 260 }}><QirtasLoader /></div>}

      {logs && logs.length === 0 && (
        <div className="empty">
          <div className="qr"><Qirtas mood="sleepy" size={72} /></div>
          <b>السجل فارغ</b>
          <p>يظهر هنا كل فعل حساس بسببه ومنفّذه</p>
        </div>
      )}

      {logs && logs.length > 0 && (
        <div className="tblwrap">
          <table className="tbl" data-testid="audit-table">
            <thead>
              <tr>
                <th>الوقت</th>
                <th>المنفّذ</th>
                <th>الحدث</th>
                <th>الكيان</th>
                <th>السبب المسجل</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id} data-testid="audit-row">
                  <td className="mono">{shortDateTime(l.created_at)}</td>
                  <td>{ACTOR_AR[l.actor_type] ?? l.actor_type}</td>
                  <td className="mono">{l.action}</td>
                  <td>
                    <span className="mono" style={{ fontSize: 11 }}>
                      {l.entity_type} · {l.entity_id.slice(0, 8)}…
                    </span>
                  </td>
                  <td>{l.reason ?? <span className="muted">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="note soft">
        السجل قابل للإلحاق فقط (append-only) — لا واجهة حذف أو تعديل لأي دور بما فيه Super Admin.
      </div>
    </>
  );
}
