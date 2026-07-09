"use client";

/**
 * M-15: المالية والتسويات — GET /api/v1/merchant/settlements
 * كشف السطور: GET /api/v1/merchant/settlements/{id}/lines
 * الشكل: design/merchant/M-15.html (جدول الدورات + بطاقة البنود)
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Shell from "@/components/Shell";
import { ApiError, apiGet, sar } from "@/lib/api";
import s from "./settlements.module.css";

type Settlement = {
  id: string;
  period_start: string;
  period_end: string;
  gross_halalas: number;
  refunds_halalas: number;
  promo_share_halalas: number;
  pickly_fees_halalas: number;
  payment_fees_halalas: number;
  tips_halalas: number;
  net_halalas: number;
  status: string;
};

type Line = {
  id: string;
  line_type: string;
  amount_halalas: number;
  order_code: string | null;
};

const STATUS_AR: Record<string, { label: string; cls: string }> = {
  draft: { label: "قيد التجميع", cls: "b-warn" },
  generated: { label: "جاهزة للتحويل", cls: "b-lime" },
  paid: { label: "حُوّلت", cls: "b-ok" },
  disputed: { label: "نزاع مفتوح", cls: "b-err" }
};

const LINE_AR: Record<string, string> = {
  sale: "مبيعات طلب مكتمل",
  refund: "استرجاع منفذ",
  promo_share: "حصة بيكلي من العروض",
  pickly_fee: "رسوم بيكلي",
  payment_fee: "رسوم معاملات الدفع",
  tip: "بقشيش الفريق (تمرير كامل)"
};

/** تاريخ ميلادي قصير بأرقام لاتينية */
const d = (iso: string): string => new Date(iso).toLocaleDateString("en-GB");

export default function SettlementsPage() {
  const router = useRouter();
  const [settlements, setSettlements] = useState<Settlement[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[] | null>(null);
  const [linesError, setLinesError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<Settlement[]>("/api/v1/merchant/settlements")
      .then(setSettlements)
      .catch((e: unknown) => {
        if (e instanceof ApiError && e.status === 401) {
          router.replace("/");
          return;
        }
        setError((e as Error).message);
      });
  }, [router]);

  const openLines = (id: string) => {
    if (openId === id) {
      setOpenId(null);
      setLines(null);
      return;
    }
    setOpenId(id);
    setLines(null);
    setLinesError(null);
    apiGet<Line[]>(`/api/v1/merchant/settlements/${id}/lines`)
      .then(setLines)
      .catch((e: unknown) => setLinesError((e as Error).message));
  };

  const open = settlements?.find((x) => x.id === openId) ?? null;

  return (
    <Shell title="المالية والتسويات" crumb="دورات التسوية وكشوف البنود — Ledger غير قابل للتعديل">
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
          <p>تظهر الدورات هنا بعد أول تجميع أسبوعي</p>
        </div>
      )}

      {settlements && settlements.length > 0 && (
        <div className="tblwrap">
          <table className="tbl" data-testid="settlements-table">
            <thead>
              <tr>
                <th>الفترة</th>
                <th>الإجمالي</th>
                <th>استرجاعات</th>
                <th>حصة العروض</th>
                <th>رسوم بيكلي</th>
                <th>رسوم الدفع</th>
                <th>بقشيش</th>
                <th>الصافي</th>
                <th>الحالة</th>
              </tr>
            </thead>
            <tbody>
              {settlements.map((st) => {
                const badge = STATUS_AR[st.status] ?? { label: st.status, cls: "b-soft" };
                return (
                  <tr
                    key={st.id}
                    className={`${s.row} ${openId === st.id ? s.rowOn : ""}`}
                    data-testid="settlement-row"
                    onClick={() => openLines(st.id)}
                  >
                    <td className="mono">
                      {d(st.period_start)} – {d(st.period_end)}
                    </td>
                    <td className="mono">{sar(st.gross_halalas)}</td>
                    <td className={`mono ${st.refunds_halalas > 0 ? s.neg : ""}`}>
                      {st.refunds_halalas > 0 ? `−${sar(st.refunds_halalas)}` : sar(st.refunds_halalas)}
                    </td>
                    <td className={`mono ${st.promo_share_halalas > 0 ? s.pos : ""}`}>{sar(st.promo_share_halalas)}</td>
                    <td className="mono">{sar(st.pickly_fees_halalas)}</td>
                    <td className="mono">{sar(st.payment_fees_halalas)}</td>
                    <td className="mono">{sar(st.tips_halalas)}</td>
                    <td className={`mono ${s.net}`}>{sar(st.net_halalas)}</td>
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

      {open && (
        <div className={s.grid2}>
          <div className="pcardx" data-testid="settlement-lines">
            <h3>
              كشف بنود التسوية
              <span className="sp muted mono" style={{ fontSize: 11 }}>
                {d(open.period_start)} – {d(open.period_end)}
              </span>
            </h3>
            {linesError && <div className="note err">{linesError}</div>}
            {!lines && !linesError && <div className="skl" style={{ height: 120 }} />}
            {lines && lines.length === 0 && <p className="muted">لا بنود في هذه الدورة بعد.</p>}
            {lines &&
              lines.map((l) => (
                <div key={l.id} className="kv" data-testid="settlement-line">
                  <span className="k">
                    {LINE_AR[l.line_type] ?? l.line_type}
                    {l.order_code && <span className={s.orderCode}> · {l.order_code}</span>}
                  </span>
                  <span className={`v mono ${l.amount_halalas < 0 ? s.neg : ""}`}>
                    {l.amount_halalas < 0 ? `−${sar(-l.amount_halalas)}` : sar(l.amount_halalas)}
                  </span>
                </div>
              ))}
            <div className="srow tot">
              <span>الصافي</span>
              <span className="v">{sar(open.net_halalas)} SAR</span>
            </div>
            <p className="muted" style={{ fontSize: 11, marginTop: 6 }}>
              Ledger مستقل لكل حركة — لا تعديل يدوياً على البنود.
            </p>
          </div>
          <div className="pcardx">
            <h3>ملخص الدورة</h3>
            <div className="kv">
              <span className="k">مبيعات مكتملة</span>
              <span className="v mono">{sar(open.gross_halalas)}</span>
            </div>
            <div className="kv">
              <span className="k">استرجاعات</span>
              <span className="v mono">−{sar(open.refunds_halalas)}</span>
            </div>
            <div className="kv">
              <span className="k">بقشيش الفريق</span>
              <span className="v mono">+{sar(open.tips_halalas)}</span>
            </div>
            <div className="srow tot">
              <span>الصافي المتوقع</span>
              <span className="v">{sar(open.net_halalas)} SAR</span>
            </div>
          </div>
        </div>
      )}
    </Shell>
  );
}
