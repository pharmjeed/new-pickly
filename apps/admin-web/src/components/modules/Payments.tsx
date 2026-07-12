"use client";

/**
 * طرق الدفع والمحفظة (قرار المالك 2026-07-12 — docs/01§1):
 * - قائمة طرق الدفع الظاهرة للعميل (system_settings:payments.methods — سجل تاريخي):
 *   تفعيل/إيقاف/ترتيب/شارة، والأولى الفعّالة هي الافتراضية عند العميل.
 * - محفظة بيكلي: بحث عميل بالجوال → الرصيد وآخر الحركات + إيداع/خصم بسبب مُدقق.
 */
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, apiGet, apiPost } from "@/lib/api";
import ReasonModal from "@/components/ReasonModal";

type MethodKey = "apple_pay" | "card" | "stc_pay";

type Method = {
  key: MethodKey;
  name_ar: string;
  desc_ar: string | null;
  badge_ar: string | null;
  is_active: boolean;
};

type WalletEntry = {
  id: string;
  amount_halalas: number;
  entry_type: string;
  reference: string | null;
  created_at: string;
};

type WalletView = {
  user_id: string;
  phone: string;
  full_name: string | null;
  balance_halalas: number;
  entries: WalletEntry[];
};

type PendingSave = { kind: "methods" } | { kind: "adjust"; amount_halalas: number };

const METHOD_LABEL: Record<MethodKey, string> = {
  apple_pay: "Apple Pay",
  card: "بطاقة",
  stc_pay: "stc pay"
};

const sar = (halalas: number): string => `${(halalas / 100).toFixed(2)} ر.س`;

export default function Payments() {
  const router = useRouter();
  const [methods, setMethods] = useState<Method[] | null>(null);
  const [methodsDirty, setMethodsDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingSave, setPendingSave] = useState<PendingSave | null>(null);
  // محفظة بيكلي
  const [phone, setPhone] = useState("");
  const [walletBusy, setWalletBusy] = useState(false);
  const [walletView, setWalletView] = useState<WalletView | null>(null);
  const [amountSar, setAmountSar] = useState("");

  const load = useCallback(() => {
    apiGet<{ methods: Method[] }>("/api/v1/admin/payments/methods")
      .then((r) => {
        setMethods(r.methods);
        setMethodsDirty(false);
      })
      .catch((e: unknown) => {
        if (e instanceof ApiError && e.status === 401) {
          router.replace("/");
          return;
        }
        setError((e as Error).message);
      });
  }, [router]);

  useEffect(load, [load]);

  const setMethod = (i: number, patch: Partial<Method>) => {
    if (!methods) return;
    setMethods(methods.map((m, idx) => (idx === i ? { ...m, ...patch } : m)));
    setMethodsDirty(true);
  };

  const moveMethod = (i: number, dir: -1 | 1) => {
    if (!methods) return;
    const j = i + dir;
    if (j < 0 || j >= methods.length) return;
    const next = [...methods];
    const a = next[i];
    const b = next[j];
    if (!a || !b) return;
    next[i] = b;
    next[j] = a;
    setMethods(next);
    setMethodsDirty(true);
  };

  const searchWallet = async () => {
    setWalletBusy(true);
    setError(null);
    setWalletView(null);
    try {
      const w = await apiGet<WalletView>(`/api/v1/admin/wallet?phone=${encodeURIComponent(phone.trim())}`);
      setWalletView(w);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setWalletBusy(false);
    }
  };

  const confirmSave = async (reason: string) => {
    if (!pendingSave) return;
    setBusy(true);
    setError(null);
    try {
      if (pendingSave.kind === "methods" && methods) {
        await apiPost("/api/v1/admin/payments/methods", { methods, reason });
        setNotice("حُفظت طرق الدفع — تسري فوراً عند العميل");
        load();
      } else if (pendingSave.kind === "adjust" && walletView) {
        await apiPost("/api/v1/admin/wallet/adjust", {
          user_id: walletView.user_id,
          amount_halalas: pendingSave.amount_halalas,
          reason
        });
        setNotice(
          `${pendingSave.amount_halalas > 0 ? "أُودع" : "خُصم"} ${sar(Math.abs(pendingSave.amount_halalas))} لمحفظة ${walletView.phone}`
        );
        setAmountSar("");
        await searchWallet();
      }
      setPendingSave(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  /** المبلغ بالريال (يقبل سالباً للخصم) → هللات int */
  const parsedAmount = Math.round(Number(amountSar.replace(",", ".")) * 100);
  const amountValid = Number.isFinite(parsedAmount) && parsedAmount !== 0;

  return (
    <>
      {error && <div className="note err" data-testid="payments-error">{error}</div>}
      {notice && <div className="note info" data-testid="payments-notice">{notice}</div>}
      {!methods && !error && <div className="skl" style={{ height: 220 }} />}

      {methods && (
        <div className="pcardx" data-testid="payment-methods">
          <h3>
            طرق الدفع الظاهرة للعميل
            <span className="sp">
              <button
                type="button"
                className="btn sm"
                disabled={!methodsDirty || busy}
                data-testid="methods-save"
                onClick={() => setPendingSave({ kind: "methods" })}
              >
                حفظ طرق الدفع
              </button>
            </span>
          </h3>
          <div style={{ display: "grid", gap: 8 }}>
            {methods.map((m, i) => (
              <div
                key={m.key}
                style={{ display: "grid", gridTemplateColumns: "auto auto 90px 1fr 1fr 110px auto", gap: 8, alignItems: "center" }}
                data-testid="method-row"
              >
                <button type="button" className="btn sm" disabled={i === 0} aria-label="أعلى" onClick={() => moveMethod(i, -1)}>
                  ↑
                </button>
                <button type="button" className="btn sm" disabled={i === methods.length - 1} aria-label="أسفل" onClick={() => moveMethod(i, 1)}>
                  ↓
                </button>
                <b>{METHOD_LABEL[m.key]}</b>
                <input className="inp" value={m.name_ar} onChange={(e) => setMethod(i, { name_ar: e.target.value })} data-testid="method-name" />
                <input
                  className="inp"
                  placeholder="وصف يظهر تحت الاسم (اختياري)"
                  value={m.desc_ar ?? ""}
                  onChange={(e) => setMethod(i, { desc_ar: e.target.value || null })}
                />
                <input
                  className="inp"
                  placeholder="شارة — جديد"
                  value={m.badge_ar ?? ""}
                  onChange={(e) => setMethod(i, { badge_ar: e.target.value || null })}
                />
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, whiteSpace: "nowrap" }}>
                  <input type="checkbox" checked={m.is_active} onChange={(e) => setMethod(i, { is_active: e.target.checked })} data-testid="method-active" />
                  فعال
                </label>
              </div>
            ))}
          </div>
          <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            الترتيب هنا هو ترتيب الظهور في «اختر طريقة الدفع» — والأولى الفعّالة هي الافتراضية · المعطلة تختفي فوراً
            ويرفض الخادم أي intent بها · Apple Pay المختارة تعرض زر الدفع الأسود بشعارهم.
          </p>
        </div>
      )}

      <div className="pcardx" style={{ marginTop: 14 }} data-testid="wallet-tool">
        <h3>محفظة بيكلي — رصيد العملاء</h3>
        <div style={{ display: "flex", gap: 8, alignItems: "end" }}>
          <div className="fld" style={{ flex: 1 }}>
            <label>جوال العميل</label>
            <input
              className="inp mono"
              dir="ltr"
              placeholder="05XXXXXXXX"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              data-testid="wallet-phone"
            />
          </div>
          <button type="button" className="btn sm" disabled={walletBusy || phone.trim().length < 9} onClick={() => void searchWallet()} data-testid="wallet-search">
            {walletBusy ? "جارٍ البحث…" : "عرض المحفظة"}
          </button>
        </div>

        {walletView && (
          <div style={{ marginTop: 12 }} data-testid="wallet-view">
            <div className="note soft">
              <b>{walletView.full_name ?? "بدون اسم"}</b> · <span className="mono" dir="ltr">{walletView.phone}</span> — الرصيد:{" "}
              <b data-testid="wallet-balance">{sar(walletView.balance_halalas)}</b>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "end", marginTop: 10 }}>
              <div className="fld" style={{ flex: 1 }}>
                <label>المبلغ بالريال — موجب إيداع، سالب خصم</label>
                <input
                  className="inp mono"
                  dir="ltr"
                  placeholder="مثال: 25 أو -10"
                  value={amountSar}
                  onChange={(e) => setAmountSar(e.target.value)}
                  data-testid="wallet-amount"
                />
              </div>
              <button
                type="button"
                className="btn sm"
                disabled={busy || !amountValid}
                data-testid="wallet-adjust"
                onClick={() => setPendingSave({ kind: "adjust", amount_halalas: parsedAmount })}
              >
                تنفيذ الحركة
              </button>
            </div>
            {walletView.entries.length > 0 && (
              <div className="tblwrap" style={{ marginTop: 10 }}>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>التاريخ</th>
                      <th>النوع</th>
                      <th>المرجع</th>
                      <th>المبلغ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {walletView.entries.map((e) => (
                      <tr key={e.id} data-testid="wallet-entry">
                        <td className="mono">{new Date(e.created_at).toLocaleString("ar-SA")}</td>
                        <td>
                          <span className={`badge ${e.amount_halalas > 0 ? "b-ok" : "b-soft"}`}>
                            {e.amount_halalas > 0 ? "إيداع" : "صرف"}
                          </span>
                        </td>
                        <td className="mono">{e.reference ?? "—"}</td>
                        <td style={{ fontWeight: 700 }}>
                          {e.amount_halalas > 0 ? "+" : "−"}
                          {sar(Math.abs(e.amount_halalas))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
        <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
          الرصيد يُصرف في الإتمام (كلياً أو جزئياً) ويعود إليه نصيب الاسترجاع تلقائياً · كل حركة يدوية بسبب تدخل
          سجل التدقيق · الرصيد لا يهبط تحت الصفر.
        </p>
      </div>

      {pendingSave && (
        <ReasonModal
          title={pendingSave.kind === "methods" ? "حفظ طرق الدفع" : "حركة محفظة يدوية"}
          confirmLabel={pendingSave.kind === "methods" ? "حفظ" : "تنفيذ"}
          busy={busy}
          onConfirm={confirmSave}
          onClose={() => setPendingSave(null)}
        />
      )}
    </>
  );
}
