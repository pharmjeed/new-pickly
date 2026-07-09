"use client";

/**
 * A-11: تسويات التجار — GET /api/v1/admin/settlements جدول (قراءة فقط عبر كل التجار).
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, apiGet, sar, shortDate } from "@/lib/api";

type Settlement = {
  id: string;
  merchant: string;
  period_start: string;
  period_end: string;
  net_halalas: number;
  status: string;
};

const STATUS_AR: Record<string, { label: string; cls: string }> = {
  draft: { label: "قيد التجميع", cls: "b-warn" },
  generated: { label: "جاهزة للتحويل", cls: "b-lime" },
  paid: { label: "حُوّلت", cls: "b-ok" },
  disputed: { label: "محجوزة — نزاع مفتوح", cls: "b-err" }
};

export default function Settlements() {
  const router = useRouter();
  const [settlements, setSettlements] = useState<Settlement[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<Settlement[]>("/api/v1/admin/settlements")
      .then(setSettlements)
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
        <div className="note err" data-testid="settlements-error">
          {error}
        </div>
      )}

      {!settlements && !error && <div className="skl" style={{ height: 260 }} />}

      {settlements && settlements.length === 0 && (
        <div className="empty">
          <div className="ic">🧾</div>
          <b>لا تسويات بعد</b>
          <p>تظهر دورات التسوية هنا بعد أول تجميع أسبوعي</p>
        </div>
      )}

      {settlements && settlements.length > 0 && (
        <div className="tblwrap">
          <table className="tbl" data-testid="settlements-table">
            <thead>
              <tr>
                <th>التاجر</th>
                <th>الفترة</th>
                <th>الصافي</th>
                <th>الحالة</th>
              </tr>
            </thead>
            <tbody>
              {settlements.map((st) => {
                const badge = STATUS_AR[st.status] ?? { label: st.status, cls: "b-soft" };
                return (
                  <tr key={st.id} data-testid="settlement-row">
                    <td>
                      <b>{st.merchant}</b>
                    </td>
                    <td className="mono">
                      {shortDate(st.period_start)} – {shortDate(st.period_end)}
                    </td>
                    <td className="mono">
                      <b>{sar(st.net_halalas)}</b> <span className="muted">SAR</span>
                    </td>
                    <td>
                      <span className={`badge ${badge.cls}`} style={{ fontSize: "10.5px" }}>
                        {badge.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="note soft">كل بند يرجع لحركة Ledger — لا أرقام يدوية (وثيقة 13).</div>
    </>
  );
}
