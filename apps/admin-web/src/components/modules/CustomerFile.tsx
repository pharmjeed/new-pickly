"use client";

/**
 * A-07ب — ملف العميل الشامل (قرار المالك 2026-07-19): كل ما يخص العميل في شاشة واحدة —
 * البروفايل والتفضيلات، المحفظة بقيودها (+إيداع/خصم بسبب)، النقاط بحركاتها (+تسوية بسبب)،
 * الدعوات، الطلبات، السيارات (لوحة مختصرة — docs/17)، البطاقات (آخر 4)، المفضلة، التذاكر، الكوبونات.
 */
import { useCallback, useEffect, useState } from "react";
import { apiGet, apiPost, sar, shortDateTime } from "@/lib/api";
import ReasonModal from "@/components/ReasonModal";
import { QirtasLoader } from "@/components/qirtas";
import s from "@/components/reason-modal.module.css";

type Entry = { id: string; amount_halalas: number; entry_type: string; reference: string | null; created_at: string };
type CustomerDetail = {
  id: string;
  phone: string;
  full_name: string | null;
  status: string;
  created_at: string;
  last_seen_at: string | null;
  profile: {
    preferred_language: string;
    marketing_opt_in: boolean;
    no_show_count_30d: number;
    risk_flagged: boolean;
  };
  wallet: { balance_halalas: number; entries: Entry[] };
  rewards: {
    points: number;
    transactions: { id: string; points: number; reason: string; created_at: string }[];
  };
  referral: {
    code: string | null;
    invited_count: number;
    rewarded_count: number;
    referred_by: { full_name: string | null; phone_masked: string } | null;
    rewarded_at: string | null;
  };
  orders: {
    total: number;
    completed: number;
    recent: { id: string; display_code: string; order_status: string; brand_name_ar: string; total_halalas: number; created_at: string }[];
  };
  vehicles: { id: string; make_ar: string | null; model_ar: string | null; color_ar: string; plate_short: string }[];
  cards: { id: string; brand: string; last4: string; is_default: boolean }[];
  favorites: { brand_id: string; name_ar: string }[];
  support_tickets: { id: string; subject: string; status: string; updated_at: string }[];
  coupon_redemptions: { id: string; code: string; amount_halalas: number; created_at: string }[];
};

export const CUSTOMER_STATUS_AR: Record<string, { label: string; cls: string }> = {
  active: { label: "نشط", cls: "b-lime" },
  blocked: { label: "محظور", cls: "b-err" },
  deleted: { label: "حذف قيد المعالجة", cls: "b-soft" }
};

const ENTRY_AR = (e: Entry): string => {
  if (e.reference === "referral:welcome") return "هدية انضمام بدعوة";
  if (e.reference === "referral:reward") return "مكافأة دعوة صديق";
  if (e.reference === "admin") return e.amount_halalas > 0 ? "إيداع إداري" : "خصم إداري";
  if (e.reference?.startsWith("order:")) return e.reference;
  if (e.reference?.startsWith("refund:")) return "استرجاع";
  return e.entry_type;
};

const TICKET_AR: Record<string, string> = {
  open: "مفتوحة",
  pending_customer: "بانتظار العميل",
  pending_merchant: "لدى المطعم",
  resolved: "حُلّت",
  closed: "مغلقة"
};

/** نافذة تعديل رصيد/نقاط: قيمة موجبة إيداع وسالبة خصم + سبب إلزامي */
function AdjustModal({
  title,
  unit,
  busy,
  onConfirm,
  onClose
}: {
  title: string;
  unit: string;
  busy: boolean;
  onConfirm: (value: number, reason: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const num = Number(value);
  const valid = Number.isFinite(num) && num !== 0 && reason.trim().length >= 3;

  return (
    <div className={s.backdrop} role="dialog" aria-modal="true" aria-label={title} data-testid="adjust-modal">
      <div className={s.modal}>
        <h3 className={s.title}>{title}</h3>
        <div className="fld">
          <label htmlFor="adjust-value">القيمة ({unit}) — موجبة إيداع وسالبة خصم</label>
          <input
            id="adjust-value"
            data-testid="adjust-value"
            type="number"
            inputMode="decimal"
            placeholder="مثال: 50 أو -20"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            autoFocus
          />
        </div>
        <div className="fld">
          <label htmlFor="adjust-reason">السبب (إلزامي — يدخل سجل التدقيق)</label>
          <textarea
            id="adjust-reason"
            data-testid="adjust-reason"
            placeholder="اكتب السبب بوضوح…"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
        <div className={s.actions}>
          <button
            type="button"
            className="btn sm"
            data-testid="adjust-submit"
            disabled={!valid || busy}
            onClick={() => onConfirm(num, reason.trim())}
          >
            تنفيذ
          </button>
          <button type="button" className="btn sm sec2" onClick={onClose}>
            إلغاء
          </button>
        </div>
      </div>
    </div>
  );
}

function InfoRow({ label, value, mono }: { label: string; value: string | null | undefined; mono?: boolean }) {
  return (
    <div className="kv">
      <span className="muted" style={{ whiteSpace: "nowrap" }}>{label}</span>
      <b className={mono ? "mono" : undefined} style={{ textAlign: "left" }}>{value != null && value !== "" ? value : "—"}</b>
    </div>
  );
}

export default function CustomerFile({
  customerId,
  onBack,
  onChanged
}: {
  customerId: string;
  onBack: () => void;
  onChanged: () => void;
}) {
  const [detail, setDetail] = useState<CustomerDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [adjust, setAdjust] = useState<"wallet" | "points" | null>(null);
  const [blockAction, setBlockAction] = useState<"block" | "unblock" | null>(null);

  const load = useCallback(() => {
    apiGet<CustomerDetail>(`/api/v1/admin/customers/${customerId}`)
      .then(setDetail)
      .catch((e: unknown) => setError((e as Error).message));
  }, [customerId]);

  useEffect(load, [load]);

  const doAdjust = async (value: number, reason: string) => {
    if (!adjust) return;
    setBusy(true);
    setError(null);
    try {
      if (adjust === "wallet") {
        await apiPost("/api/v1/admin/wallet/adjust", {
          user_id: customerId,
          amount_halalas: Math.round(value * 100),
          reason
        });
        setNotice(`${value > 0 ? "أُودع" : "خُصم"} ${sar(Math.round(Math.abs(value) * 100))} — السبب دخل سجل التدقيق`);
      } else {
        await apiPost("/api/v1/admin/loyalty/adjust", {
          user_id: customerId,
          points: Math.round(value),
          reason
        });
        setNotice(`عُدّلت النقاط (${value > 0 ? "+" : ""}${Math.round(value)}) — السبب دخل سجل التدقيق`);
      }
      setAdjust(null);
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const doBlock = async (reason: string) => {
    if (!blockAction || !detail) return;
    setBusy(true);
    setError(null);
    try {
      await apiPost(`/api/v1/admin/customers/${customerId}/block`, { action: blockAction, reason });
      setNotice(blockAction === "block" ? "حُظر العميل — السبب دخل سجل التدقيق" : "رُفع الحظر عن العميل");
      setBlockAction(null);
      load();
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (error && !detail) {
    return (
      <>
        <button type="button" className="btn sm" onClick={onBack} data-testid="customer-file-back">
          → عودة للعملاء
        </button>
        <div className="note err" style={{ marginTop: 10 }}>{error}</div>
      </>
    );
  }
  if (!detail) return <div className="loadwrap" style={{ minHeight: 260 }}><QirtasLoader /></div>;

  const badge = CUSTOMER_STATUS_AR[detail.status] ?? { label: detail.status, cls: "b-soft" };

  return (
    <div data-testid="customer-file">
      {/* رأس الملف */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        <button type="button" className="btn sm" onClick={onBack} data-testid="customer-file-back">
          → عودة للعملاء
        </button>
        <h2 style={{ margin: 0, fontSize: 20 }} data-testid="customer-file-name">
          {detail.full_name ?? "بدون اسم"}
        </h2>
        <span className="mono" dir="ltr">{detail.phone}</span>
        <span className={`badge ${badge.cls}`}>{badge.label}</span>
        {detail.profile.risk_flagged && <span className="badge b-warn">إشارة مخاطر</span>}
        <span style={{ marginInlineStart: "auto" }}>
          {detail.status === "blocked" ? (
            <button type="button" className="btn sm sec2" onClick={() => setBlockAction("unblock")} data-testid="customer-file-unblock">
              رفع الحظر
            </button>
          ) : (
            <button type="button" className="btn sm dgh" onClick={() => setBlockAction("block")} data-testid="customer-file-block">
              حظر
            </button>
          )}
        </span>
      </div>

      {error && <div className="note err">{error}</div>}
      {notice && <div className="note info" data-testid="customer-file-notice">{notice}</div>}

      {/* مؤشرات */}
      <div className="kpis" data-testid="customer-file-kpis">
        <div className="kpi"><div className="k">الطلبات</div><div className="v">{detail.orders.total.toLocaleString("en")}</div></div>
        <div className="kpi"><div className="k">مكتملة</div><div className="v">{detail.orders.completed.toLocaleString("en")}</div></div>
        <div className="kpi"><div className="k">رصيد المحفظة</div><div className="v">{sar(detail.wallet.balance_halalas)}</div></div>
        <div className="kpi"><div className="k">النقاط</div><div className="v">{detail.rewards.points.toLocaleString("en")}</div></div>
        <div className="kpi"><div className="k">أصدقاء دعاهم</div><div className="v">{detail.referral.invited_count.toLocaleString("en")}</div></div>
        <div className="kpi"><div className="k">No-show (30ي)</div><div className="v">{detail.profile.no_show_count_30d}</div></div>
      </div>

      {/* البيانات + الدعوة */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12, marginTop: 14 }}>
        <div className="pcardx" data-testid="customer-file-info">
          <h3>البيانات والتفضيلات</h3>
          <InfoRow label="الجوال" value={detail.phone} mono />
          <InfoRow label="اللغة" value={detail.profile.preferred_language === "en" ? "English" : "العربية"} />
          <InfoRow label="إشعارات العروض" value={detail.profile.marketing_opt_in ? "مفعلة" : "موقوفة"} />
          <InfoRow label="التسجيل" value={shortDateTime(detail.created_at)} mono />
          <InfoRow label="آخر ظهور" value={detail.last_seen_at ? shortDateTime(detail.last_seen_at) : "—"} mono />
        </div>
        <div className="pcardx" data-testid="customer-file-referral">
          <h3>دعوة الأصدقاء</h3>
          <InfoRow label="كوده" value={detail.referral.code} mono />
          <InfoRow label="أصدقاء انضموا بكوده" value={detail.referral.invited_count.toLocaleString("en")} mono />
          <InfoRow label="مكافآت صُرفت له" value={detail.referral.rewarded_count.toLocaleString("en")} mono />
          <InfoRow
            label="مدعو من"
            value={detail.referral.referred_by ? `${detail.referral.referred_by.full_name ?? "بدون اسم"} (${detail.referral.referred_by.phone_masked})` : "—"}
          />
          <InfoRow label="مكافأة دعوته صُرفت" value={detail.referral.rewarded_at ? shortDateTime(detail.referral.rewarded_at) : "—"} mono />
        </div>
      </div>

      {/* المحفظة + النقاط */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12, marginTop: 12 }}>
        <div className="pcardx" data-testid="customer-file-wallet">
          <h3>
            المحفظة <span className="sp mono">{sar(detail.wallet.balance_halalas)}</span>
            <button type="button" className="btn sm" style={{ marginInlineStart: "auto" }} onClick={() => setAdjust("wallet")} data-testid="wallet-adjust-open">
              إيداع / خصم
            </button>
          </h3>
          {detail.wallet.entries.length === 0 && <p className="muted">لا حركات بعد.</p>}
          {detail.wallet.entries.length > 0 && (
            <div className="tblwrap">
              <table className="tbl">
                <thead><tr><th>الحركة</th><th>المبلغ</th><th>التاريخ</th></tr></thead>
                <tbody>
                  {detail.wallet.entries.map((e) => (
                    <tr key={e.id}>
                      <td>{ENTRY_AR(e)}</td>
                      <td className="mono" style={{ color: e.amount_halalas > 0 ? "var(--ok, #12A472)" : undefined }}>
                        {e.amount_halalas > 0 ? "+" : ""}{sar(e.amount_halalas)}
                      </td>
                      <td className="mono">{shortDateTime(e.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div className="pcardx" data-testid="customer-file-rewards">
          <h3>
            نقاط المكافآت <span className="sp mono">{detail.rewards.points.toLocaleString("en")}</span>
            <button type="button" className="btn sm" style={{ marginInlineStart: "auto" }} onClick={() => setAdjust("points")} data-testid="points-adjust-open">
              تسوية نقاط
            </button>
          </h3>
          {detail.rewards.transactions.length === 0 && <p className="muted">لا حركات نقاط بعد.</p>}
          {detail.rewards.transactions.length > 0 && (
            <div className="tblwrap">
              <table className="tbl">
                <thead><tr><th>السبب</th><th>النقاط</th><th>التاريخ</th></tr></thead>
                <tbody>
                  {detail.rewards.transactions.map((t) => (
                    <tr key={t.id}>
                      <td>{t.reason}</td>
                      <td className="mono">{t.points > 0 ? "+" : ""}{t.points}</td>
                      <td className="mono">{shortDateTime(t.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* الطلبات الأخيرة */}
      <div className="pcardx" style={{ marginTop: 12 }} data-testid="customer-file-orders">
        <h3>آخر الطلبات <span className="sp mono">{detail.orders.total}</span></h3>
        {detail.orders.recent.length === 0 && <p className="muted">لا طلبات بعد.</p>}
        {detail.orders.recent.length > 0 && (
          <div className="tblwrap">
            <table className="tbl">
              <thead><tr><th>الطلب</th><th>المطعم</th><th>الحالة</th><th>الإجمالي</th><th>التاريخ</th></tr></thead>
              <tbody>
                {detail.orders.recent.map((o) => (
                  <tr key={o.id}>
                    <td className="mono">{o.display_code}</td>
                    <td>{o.brand_name_ar}</td>
                    <td className="mono" style={{ fontSize: 11 }}>{o.order_status}</td>
                    <td className="mono">{sar(o.total_halalas)}</td>
                    <td className="mono">{shortDateTime(o.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* السيارات + البطاقات + المفضلة */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12, marginTop: 12 }}>
        <div className="pcardx" data-testid="customer-file-vehicles">
          <h3>السيارات <span className="sp mono">{detail.vehicles.length}</span></h3>
          {detail.vehicles.length === 0 && <p className="muted">لا سيارات.</p>}
          {detail.vehicles.map((v) => (
            <div key={v.id} className="kv">
              <span>{[v.model_ar ?? v.make_ar, v.color_ar].filter(Boolean).join(" · ") || v.color_ar}</span>
              <span className="mono">•••• {v.plate_short}</span>
            </div>
          ))}
          <p className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>
            اللوحة الكاملة مشفرة — تظهر لموظف التسليم أثناء الطلب النشط فقط (docs/17).
          </p>
        </div>
        <div className="pcardx" data-testid="customer-file-cards">
          <h3>البطاقات <span className="sp mono">{detail.cards.length}</span></h3>
          {detail.cards.length === 0 && <p className="muted">لا بطاقات محفوظة.</p>}
          {detail.cards.map((c) => (
            <div key={c.id} className="kv">
              <span>{c.brand}{c.is_default ? " · الافتراضية" : ""}</span>
              <span className="mono">•••• {c.last4}</span>
            </div>
          ))}
        </div>
        <div className="pcardx" data-testid="customer-file-favorites">
          <h3>المفضلة <span className="sp mono">{detail.favorites.length}</span></h3>
          {detail.favorites.length === 0 && <p className="muted">لا مفضلة.</p>}
          {detail.favorites.map((f) => (
            <div key={f.brand_id} className="kv"><span>{f.name_ar}</span></div>
          ))}
        </div>
      </div>

      {/* التذاكر + الكوبونات */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12, marginTop: 12 }}>
        <div className="pcardx" data-testid="customer-file-tickets">
          <h3>تذاكر الدعم <span className="sp mono">{detail.support_tickets.length}</span></h3>
          {detail.support_tickets.length === 0 && <p className="muted">لا تذاكر.</p>}
          {detail.support_tickets.map((t) => (
            <div key={t.id} className="kv">
              <span>{t.subject}</span>
              <span className="badge b-soft" style={{ fontSize: "10.5px" }}>{TICKET_AR[t.status] ?? t.status}</span>
              <span className="mono" style={{ fontSize: 11 }}>{shortDateTime(t.updated_at)}</span>
            </div>
          ))}
        </div>
        <div className="pcardx" data-testid="customer-file-coupons">
          <h3>كوبونات استخدمها <span className="sp mono">{detail.coupon_redemptions.length}</span></h3>
          {detail.coupon_redemptions.length === 0 && <p className="muted">لا كوبونات مستخدمة.</p>}
          {detail.coupon_redemptions.map((r) => (
            <div key={r.id} className="kv">
              <span className="mono">{r.code}</span>
              <span className="mono">{sar(r.amount_halalas)}</span>
              <span className="mono" style={{ fontSize: 11 }}>{shortDateTime(r.created_at)}</span>
            </div>
          ))}
        </div>
      </div>

      {adjust && (
        <AdjustModal
          title={adjust === "wallet" ? "إيداع / خصم من المحفظة" : "تسوية نقاط المكافآت"}
          unit={adjust === "wallet" ? "ر.س" : "نقطة"}
          busy={busy}
          onConfirm={(v, r) => void doAdjust(v, r)}
          onClose={() => setAdjust(null)}
        />
      )}
      {blockAction && (
        <ReasonModal
          title={blockAction === "block" ? "حظر العميل" : "رفع الحظر عن العميل"}
          confirmLabel={blockAction === "block" ? "حظر" : "رفع الحظر"}
          danger={blockAction === "block"}
          busy={busy}
          onConfirm={(r) => void doBlock(r)}
          onClose={() => setBlockAction(null)}
        />
      )}
    </div>
  );
}
