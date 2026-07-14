"use client";

/**
 * A-12: العروض والكوبونات (مرحلة 2) — BR-7:
 * جدول GET /coupons + إنشاء POST /coupons + تفعيل/إطفاء بسبب.
 * التحقق والخصم خادميان حصراً — الواجهة تعرض فقط.
 */
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, apiGet, apiPost, sar, shortDate } from "@/lib/api";
import ReasonModal from "@/components/ReasonModal";
import { Qirtas, QirtasLoader } from "@/components/qirtas";

type Coupon = {
  id: string;
  code: string;
  type: "amount" | "percent" | "free_product";
  value: number;
  min_order_halalas: number | null;
  max_uses_total: number | null;
  max_uses_per_user: number | null;
  new_users_only: boolean;
  starts_at: string | null;
  ends_at: string | null;
  merchant: string | null;
  merchant_share_bp: number;
  is_active: boolean;
  redemptions: number;
};

type Draft = {
  code: string;
  type: "percent" | "amount";
  value: string;
  min_order_sar: string;
  max_uses_total: string;
  max_uses_per_user: string;
  new_users_only: boolean;
};

const EMPTY_DRAFT: Draft = {
  code: "",
  type: "percent",
  value: "",
  min_order_sar: "",
  max_uses_total: "",
  max_uses_per_user: "",
  new_users_only: false
};

export default function Promos() {
  const router = useRouter();
  const [coupons, setCoupons] = useState<Coupon[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pendingCreate, setPendingCreate] = useState(false);
  const [pendingToggle, setPendingToggle] = useState<Coupon | null>(null);

  const load = useCallback(() => {
    apiGet<Coupon[]>("/api/v1/admin/coupons")
      .then(setCoupons)
      .catch((e: unknown) => {
        if (e instanceof ApiError && e.status === 401) {
          router.replace("/");
          return;
        }
        setError((e as Error).message);
      });
  }, [router]);

  useEffect(load, [load]);

  const validDraft =
    draft &&
    draft.code.trim().length >= 2 &&
    Number(draft.value) > 0 &&
    (draft.type !== "percent" || Number(draft.value) <= 100);

  const confirmCreate = async (reason: string) => {
    if (!draft || !validDraft) return;
    setBusy(true);
    setError(null);
    try {
      await apiPost("/api/v1/admin/coupons", {
        code: draft.code.trim(),
        type: draft.type,
        // percent: نسبة مئوية · amount: هللات (الإدخال بالريال)
        value: draft.type === "percent" ? Number(draft.value) : Math.round(Number(draft.value) * 100),
        min_order_halalas: draft.min_order_sar ? Math.round(Number(draft.min_order_sar) * 100) : null,
        max_uses_total: draft.max_uses_total ? Number(draft.max_uses_total) : null,
        max_uses_per_user: draft.max_uses_per_user ? Number(draft.max_uses_per_user) : null,
        new_users_only: draft.new_users_only,
        reason
      });
      setNotice(`أُنشئ الكوبون ${draft.code.trim().toUpperCase()} — دخل سجل التدقيق`);
      setDraft(null);
      setPendingCreate(false);
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const confirmToggle = async (reason: string) => {
    if (!pendingToggle) return;
    setBusy(true);
    setError(null);
    try {
      await apiPost(`/api/v1/admin/coupons/${pendingToggle.id}/toggle`, {
        is_active: !pendingToggle.is_active,
        reason
      });
      setNotice(`${pendingToggle.code} أصبح ${pendingToggle.is_active ? "مطفأً" : "فعالاً"}`);
      setPendingToggle(null);
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const activeCount = coupons?.filter((c) => c.is_active).length ?? 0;
  const totalRedemptions = coupons?.reduce((s, c) => s + c.redemptions, 0) ?? 0;

  return (
    <>
      {error && <div className="note err" data-testid="promos-error">{error}</div>}
      {notice && <div className="note info" data-testid="promos-notice">{notice}</div>}
      {!coupons && !error && <div className="loadwrap" style={{ minHeight: 260 }}><QirtasLoader /></div>}

      {coupons && (
        <div className="kpis">
          <div className="kpi" data-testid="admin-stat" data-stat="coupons_active">
            <div className="k">كوبونات فعالة</div>
            <div className="v">{activeCount}</div>
          </div>
          <div className="kpi" data-testid="admin-stat" data-stat="coupons_redemptions">
            <div className="k">مرات الاستخدام</div>
            <div className="v">{totalRedemptions}</div>
          </div>
          <div className="kpi">
            <div className="k">إنشاء</div>
            <button type="button" className="btn sm" data-testid="coupon-new" onClick={() => setDraft({ ...EMPTY_DRAFT })}>
              + كوبون جديد
            </button>
          </div>
        </div>
      )}

      {draft && (
        <div className="pcardx" style={{ marginTop: 14 }} data-testid="coupon-form">
          <h3>كوبون جديد</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
            <div className="fld">
              <label>الكود</label>
              <input className="inp" value={draft.code} onChange={(e) => setDraft({ ...draft, code: e.target.value })} placeholder="WELCOME10" data-testid="coupon-code" />
            </div>
            <div className="fld">
              <label>النوع</label>
              <select className="inp" value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value as Draft["type"] })} data-testid="coupon-type">
                <option value="percent">نسبة %</option>
                <option value="amount">مبلغ ثابت (ر.س)</option>
              </select>
            </div>
            <div className="fld">
              <label>{draft.type === "percent" ? "النسبة %" : "المبلغ (ر.س)"}</label>
              <input className="inp mono" inputMode="numeric" value={draft.value} onChange={(e) => setDraft({ ...draft, value: e.target.value })} data-testid="coupon-value" />
            </div>
            <div className="fld">
              <label>حد أدنى للطلب (ر.س)</label>
              <input className="inp mono" inputMode="numeric" value={draft.min_order_sar} onChange={(e) => setDraft({ ...draft, min_order_sar: e.target.value })} placeholder="اختياري" />
            </div>
            <div className="fld">
              <label>سقف الاستخدام الكلي</label>
              <input className="inp mono" inputMode="numeric" value={draft.max_uses_total} onChange={(e) => setDraft({ ...draft, max_uses_total: e.target.value })} placeholder="اختياري" />
            </div>
            <div className="fld">
              <label>سقف لكل عميل</label>
              <input className="inp mono" inputMode="numeric" value={draft.max_uses_per_user} onChange={(e) => setDraft({ ...draft, max_uses_per_user: e.target.value })} placeholder="اختياري" />
            </div>
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, fontSize: 13 }}>
            <input type="checkbox" checked={draft.new_users_only} onChange={(e) => setDraft({ ...draft, new_users_only: e.target.checked })} />
            للعملاء الجدد فقط
          </label>
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button type="button" className="btn sm" disabled={!validDraft || busy} onClick={() => setPendingCreate(true)} data-testid="coupon-save">
              حفظ الكوبون
            </button>
            <button type="button" className="btn sm dgh" onClick={() => setDraft(null)}>إلغاء</button>
          </div>
        </div>
      )}

      {coupons && coupons.length === 0 && !draft && (
        <div className="empty">
          <div className="qr"><Qirtas mood="sleepy" size={72} /></div>
          <b>لا كوبونات</b>
          <p>أنشئ أول كوبون — التحقق والخصم خادميان بالكامل (BR-7)</p>
        </div>
      )}

      {coupons && coupons.length > 0 && (
        <div className="tblwrap" style={{ marginTop: draft ? 14 : 0 }}>
          <table className="tbl" data-testid="coupons-table">
            <thead>
              <tr>
                <th>الكود</th>
                <th>الخصم</th>
                <th>حد أدنى</th>
                <th>استخدام</th>
                <th>نافذة السريان</th>
                <th>النطاق</th>
                <th>الحالة</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {coupons.map((c) => (
                <tr key={c.id} data-testid="coupon-row">
                  <td className="mono"><b>{c.code}</b>{c.new_users_only && <span className="badge b-lime" style={{ marginInlineStart: 6 }}>جدد</span>}</td>
                  <td className="mono">{c.type === "percent" ? `${c.value}%` : `${sar(c.value)} ر.س`}</td>
                  <td className="mono">{c.min_order_halalas ? `${sar(c.min_order_halalas)}` : "—"}</td>
                  <td className="mono">{c.redemptions}{c.max_uses_total ? ` / ${c.max_uses_total}` : ""}</td>
                  <td className="mono">
                    {c.starts_at || c.ends_at
                      ? `${c.starts_at ? shortDate(c.starts_at) : "…"} ← ${c.ends_at ? shortDate(c.ends_at) : "…"}`
                      : "دائم"}
                  </td>
                  <td>{c.merchant ?? "المنصة"}</td>
                  <td>
                    <span className={`badge ${c.is_active ? "b-ok" : "b-soft"}`} data-testid="coupon-status">
                      {c.is_active ? "فعال" : "مطفأ"}
                    </span>
                  </td>
                  <td>
                    <button type="button" className={`btn sm${c.is_active ? " dgh" : ""}`} data-testid="coupon-toggle" onClick={() => setPendingToggle(c)}>
                      {c.is_active ? "إطفاء" : "تفعيل"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="note soft">
        تكلفة العرض تُنسب لطرفها (BR-7): كوبونات المنصة على Pickly، وكوبونات التاجر تُخصم من تسويته وفق merchant_share_bp.
      </div>

      {pendingCreate && draft && (
        <ReasonModal
          title={`إنشاء الكوبون ${draft.code.trim().toUpperCase()}`}
          confirmLabel="إنشاء"
          busy={busy}
          onConfirm={confirmCreate}
          onClose={() => setPendingCreate(false)}
        />
      )}
      {pendingToggle && (
        <ReasonModal
          title={`${pendingToggle.is_active ? "إطفاء" : "تفعيل"} الكوبون ${pendingToggle.code}`}
          confirmLabel={pendingToggle.is_active ? "إطفاء" : "تفعيل"}
          danger={pendingToggle.is_active}
          busy={busy}
          onConfirm={confirmToggle}
          onClose={() => setPendingToggle(null)}
        />
      )}
    </>
  );
}
