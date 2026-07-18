"use client";

/**
 * A-04ب: ملف التاجر الكامل — GET /api/v1/admin/merchants/{id}:
 * مؤشرات الطلبات والمبيعات، بيانات المنشأة القانونية والبنكية (آخر 4 من IBAN فقط)،
 * العلامات، الفروع، الفريق، آخر الطلبات، التسويات والحوالات، وسجل قرارات المنصة —
 * مع قبول/تعليق من داخل الملف بسبب إلزامي (BR-15).
 */
import { useCallback, useEffect, useState } from "react";
import { apiGet, apiPost, sar, shortDate, shortDateTime } from "@/lib/api";
import ReasonModal from "@/components/ReasonModal";
import rm from "@/components/reason-modal.module.css";
import { QirtasLoader } from "@/components/qirtas";

export const MERCHANT_STATUS_AR: Record<string, { label: string; cls: string }> = {
  pending_review: { label: "قيد الاعتماد", cls: "b-warn" },
  approved: { label: "نشط", cls: "b-lime" },
  suspended: { label: "معلق", cls: "b-err" },
  churned: { label: "منسحب", cls: "b-soft" }
};

export const PLAN_AR: Record<string, string> = {
  pilot_basic: "باقة الطيار"
};

const BRANCH_STATUS_AR: Record<string, { label: string; cls: string }> = {
  open: { label: "مفتوح", cls: "b-lime" },
  busy: { label: "مشغول", cls: "b-warn" },
  paused: { label: "موقف مؤقتاً", cls: "b-warn" },
  closed: { label: "مغلق", cls: "b-soft" }
};

const STAFF_STATUS_AR: Record<string, { label: string; cls: string }> = {
  active: { label: "نشط", cls: "b-lime" },
  suspended: { label: "موقوف", cls: "b-err" },
  removed: { label: "محذوف", cls: "b-soft" }
};

const ROLE_AR: Record<string, string> = {
  owner: "مالك المنشأة",
  general_manager: "مدير عام",
  operations_manager: "مدير عمليات",
  branch_manager: "مدير فرع",
  cashier: "كاشير",
  kitchen: "مطبخ (KDS)",
  handoff: "موظف تسليم",
  finance: "محاسب",
  analyst: "محلل تقارير"
};

const SETTLEMENT_STATUS_AR: Record<string, { label: string; cls: string }> = {
  draft: { label: "مسودة", cls: "b-soft" },
  generated: { label: "مولّدة", cls: "b-warn" },
  paid: { label: "مدفوعة", cls: "b-ok" },
  disputed: { label: "متنازع عليها", cls: "b-err" }
};

const PAYOUT_STATUS_AR: Record<string, { label: string; cls: string }> = {
  pending: { label: "بانتظار التحويل", cls: "b-warn" },
  sent: { label: "أُرسلت", cls: "b-soft" },
  confirmed: { label: "مؤكدة", cls: "b-ok" },
  failed: { label: "فشلت", cls: "b-err" }
};

const AUDIT_ACTION_AR: Record<string, string> = {
  merchant_approved: "اعتماد التاجر",
  merchant_suspended: "تعليق التاجر"
};

/** فئة شارة حالة الطلب الداخلية — نفس ألوان وحدة الطلبات (08§2) */
function orderStatusCls(st: string): string {
  if (["COMPLETED", "REFUNDED", "PARTIALLY_REFUNDED"].includes(st)) return "p-done";
  if (["ORDER_SUBMITTED", "MERCHANT_PENDING"].includes(st)) return "p-new";
  if (["MERCHANT_ACCEPTED", "PREPARING", "READY", "CUSTOMER_NOTIFIED"].includes(st)) return "p-prep";
  if (["CUSTOMER_ON_THE_WAY", "CUSTOMER_NEARBY"].includes(st)) return "p-near";
  if (["CUSTOMER_ARRIVED", "HANDOFF_IN_PROGRESS"].includes(st)) return "p-arr";
  if (["CANCELLED", "NO_SHOW", "EXPIRED", "PAYMENT_FAILED", "MERCHANT_REJECTED"].includes(st)) return "p-over";
  return "b-soft";
}

type MerchantDetail = {
  id: string;
  name_ar: string;
  name_en: string | null;
  status: string;
  plan_key: string;
  settlement_cycle: string;
  trial_ends_at: string | null;
  created_at: string;
  legal: {
    legal_name: string | null;
    cr_number: string | null;
    vat_number: string | null;
    address: string | null;
  } | null;
  bank_accounts: Array<{ id: string; bank_name: string; iban_short: string; is_primary: boolean }>;
  brands: Array<{ id: string; name_ar: string; cuisine_ar: string | null; is_active: boolean; branches: number }>;
  branches: Array<{
    id: string;
    name_ar: string;
    brand: string;
    branch_code: string;
    status: string;
    city: string;
    address_short: string;
    phone: string | null;
    is_active: boolean;
    orders: number;
  }>;
  staff: Array<{
    id: string;
    full_name: string;
    username: string;
    role_key: string;
    status: string;
    branches: string[];
    /** للسوبر أدمن فقط — null: غير قابلة للعرض حتى تعيين جديدة، undefined: دور بلا صلاحية */
    pin?: string | null;
  }>;
  stats: {
    orders_total: number;
    orders_today: number;
    orders_completed: number;
    orders_missed: number;
    sales_halalas: number;
    last_order_at: string | null;
  };
  recent_orders: Array<{
    id: string;
    display_code: string;
    order_status: string;
    branch: string;
    total_halalas: number;
    created_at: string;
  }>;
  settlements: Array<{
    id: string;
    period_start: string;
    period_end: string;
    gross_halalas: number;
    net_halalas: number;
    status: string;
  }>;
  payouts: Array<{ id: string; amount_halalas: number; bank_ref: string | null; status: string; created_at: string }>;
  audit_trail: Array<{ id: string; action: string; reason: string | null; created_at: string }>;
};

type Props = {
  merchantId: string;
  onBack: () => void;
  /** يُستدعى بعد قبول/تعليق ناجح ليحدّث جدول القائمة خلف الملف */
  onChanged: () => void;
};

/** نافذة تغيير كلمة مرور موظف — رمز 4-6 أرقام + سبب إلزامي يدخل سجل التدقيق (BR-15) */
function PinModal({
  staffName,
  username,
  busy,
  onConfirm,
  onClose
}: {
  staffName: string;
  username: string;
  busy: boolean;
  onConfirm: (pin: string, reason: string) => void;
  onClose: () => void;
}) {
  const [pin, setPin] = useState("");
  const [reason, setReason] = useState("");
  const validPin = /^\d{4,6}$/.test(pin);
  const valid = validPin && reason.trim().length >= 3;
  const title = `تغيير كلمة مرور «${staffName}» (${username})`;

  return (
    <div className={rm.backdrop} role="dialog" aria-modal="true" aria-label={title} data-testid="pin-modal">
      <div className={rm.modal}>
        <h3 className={rm.title}>{title}</h3>
        <div className="fld">
          <label htmlFor="staff-new-pin">كلمة المرور الجديدة (4-6 أرقام)</label>
          <input
            id="staff-new-pin"
            className="inp mono"
            inputMode="numeric"
            dir="ltr"
            maxLength={6}
            placeholder="1234"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
            data-testid="pin-input"
            autoFocus
          />
        </div>
        <div className="fld">
          <label htmlFor="staff-pin-reason">السبب (إلزامي — يدخل سجل التدقيق)</label>
          <textarea
            id="staff-pin-reason"
            data-testid="pin-reason"
            placeholder="مثل: طلب المالك إعادة تعيين"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <span className="hint">3 أحرف على الأقل</span>
        </div>
        <div className={rm.actions}>
          <button
            type="button"
            className="btn sm"
            data-testid="pin-submit"
            disabled={!valid || busy}
            onClick={() => onConfirm(pin, reason.trim())}
          >
            تغيير
          </button>
          <button type="button" className="btn sm sec2" data-testid="pin-cancel" onClick={onClose}>
            إلغاء
          </button>
        </div>
      </div>
    </div>
  );
}

/** صف عنوان/قيمة داخل بطاقة بيانات المنشأة */
function InfoRow({ label, value, mono }: { label: string; value: string | null | undefined; mono?: boolean }) {
  return (
    <div className="kv">
      <span className="muted" style={{ whiteSpace: "nowrap" }}>{label}</span>
      <b className={mono ? "mono" : undefined} style={{ textAlign: "left" }}>{value != null && value !== "" ? value : "—"}</b>
    </div>
  );
}

export default function MerchantFile({ merchantId, onBack, onChanged }: Props) {
  const [detail, setDetail] = useState<MerchantDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [action, setAction] = useState<"approve" | "suspend" | null>(null);
  const [busy, setBusy] = useState(false);
  const [pinTarget, setPinTarget] = useState<{ id: string; full_name: string; username: string } | null>(null);

  const load = useCallback(() => {
    apiGet<MerchantDetail>(`/api/v1/admin/merchants/${merchantId}`)
      .then(setDetail)
      .catch((e: unknown) => setError((e as Error).message));
  }, [merchantId]);

  useEffect(load, [load]);

  const changePin = async (pin: string, reason: string) => {
    if (!pinTarget) return;
    setBusy(true);
    setError(null);
    try {
      await apiPost(`/api/v1/admin/merchants/${merchantId}/staff/${pinTarget.id}/pin`, { pin, reason });
      setNotice(`غُيّرت كلمة مرور «${pinTarget.full_name}» (${pinTarget.username}) — السبب دخل سجل التدقيق`);
      setPinTarget(null);
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const confirm = async (reason: string) => {
    if (!action || !detail) return;
    setBusy(true);
    setError(null);
    try {
      await apiPost(`/api/v1/admin/merchants/${merchantId}/${action}`, { reason });
      setNotice(
        action === "approve"
          ? `اعتُمد التاجر «${detail.name_ar}» — السبب دخل سجل التدقيق`
          : `عُلّق التاجر «${detail.name_ar}» — السبب دخل سجل التدقيق`
      );
      setAction(null);
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
        <button type="button" className="btn sm" onClick={onBack} data-testid="merchant-file-back">
          → عودة للتجار
        </button>
        <div className="note err" style={{ marginTop: 10 }} data-testid="merchant-file-error">{error}</div>
      </>
    );
  }

  if (!detail) return <div className="loadwrap" style={{ minHeight: 260 }}><QirtasLoader /></div>;

  const badge = MERCHANT_STATUS_AR[detail.status] ?? { label: detail.status, cls: "b-soft" };

  return (
    <div data-testid="merchant-file">
      {/* رأس الملف: عودة + الاسم + الحالة + أوامر المنصة */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        <button type="button" className="btn sm" onClick={onBack} data-testid="merchant-file-back">
          → عودة للتجار
        </button>
        <h2 style={{ margin: 0, fontSize: 20 }} data-testid="merchant-file-name">{detail.name_ar}</h2>
        {detail.name_en && <span className="muted mono">{detail.name_en}</span>}
        <span className={`badge ${badge.cls}`} data-testid="merchant-file-status">{badge.label}</span>
        <span style={{ marginInlineStart: "auto", display: "inline-flex", gap: 6 }}>
          {detail.status !== "approved" && (
            <button type="button" className="btn sm" data-testid="merchant-file-approve" onClick={() => setAction("approve")}>
              قبول
            </button>
          )}
          {detail.status !== "suspended" && (
            <button type="button" className="btn sm dgh" data-testid="merchant-file-suspend" onClick={() => setAction("suspend")}>
              تعليق
            </button>
          )}
        </span>
      </div>

      {error && <div className="note err" data-testid="merchant-file-error">{error}</div>}
      {notice && <div className="note info" data-testid="merchant-file-notice">{notice}</div>}

      {/* مؤشرات */}
      <div className="kpis" data-testid="merchant-file-kpis">
        <div className="kpi"><div className="k">إجمالي الطلبات</div><div className="v">{detail.stats.orders_total.toLocaleString("en")}</div></div>
        <div className="kpi"><div className="k">طلبات اليوم</div><div className="v">{detail.stats.orders_today.toLocaleString("en")}</div></div>
        <div className="kpi"><div className="k">مكتملة</div><div className="v">{detail.stats.orders_completed.toLocaleString("en")}</div></div>
        <div className="kpi"><div className="k">ملغاة / فائتة</div><div className="v">{detail.stats.orders_missed.toLocaleString("en")}</div></div>
        <div className="kpi"><div className="k">مبيعات مكتملة (ر.س)</div><div className="v">{sar(detail.stats.sales_halalas)}</div></div>
        <div className="kpi"><div className="k">آخر طلب</div><div className="v" style={{ fontSize: 15 }}>{detail.stats.last_order_at ? shortDateTime(detail.stats.last_order_at) : "—"}</div></div>
      </div>

      {/* بيانات المنشأة + البنوك */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12, marginTop: 14 }}>
        <div className="pcardx" data-testid="merchant-file-org">
          <h3>بيانات المنشأة</h3>
          <InfoRow label="الباقة" value={PLAN_AR[detail.plan_key] ?? detail.plan_key} />
          <InfoRow label="دورة التسوية" value={detail.settlement_cycle === "weekly" ? "أسبوعية" : detail.settlement_cycle} />
          <InfoRow label="نهاية التجربة" value={detail.trial_ends_at ? shortDate(detail.trial_ends_at) : "—"} mono />
          <InfoRow label="الانضمام" value={shortDate(detail.created_at)} mono />
          <InfoRow label="الاسم القانوني" value={detail.legal?.legal_name} />
          <InfoRow label="السجل التجاري" value={detail.legal?.cr_number} mono />
          <InfoRow label="الرقم الضريبي" value={detail.legal?.vat_number} mono />
          <InfoRow label="العنوان" value={detail.legal?.address} />
        </div>
        <div className="pcardx" data-testid="merchant-file-banks">
          <h3>الحسابات البنكية</h3>
          {detail.bank_accounts.length === 0 && <p className="muted">لا حسابات بنكية مسجلة.</p>}
          {detail.bank_accounts.map((b) => (
            <div key={b.id} className="kv">
              <b>{b.bank_name}</b>
              <span className="mono">**** {b.iban_short}</span>
              {b.is_primary ? <span className="badge b-lime" style={{ fontSize: "10.5px" }}>أساسي</span> : <span className="muted" style={{ fontSize: 11 }}>إضافي</span>}
            </div>
          ))}
          <p className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>
            يظهر آخر 4 أرقام فقط — الـIBAN الكامل يبقى مشفراً (docs/16§4).
          </p>
        </div>
      </div>

      {/* العلامات التجارية */}
      <div className="pcardx" style={{ marginTop: 12 }} data-testid="merchant-file-brands">
        <h3>العلامات التجارية <span className="sp mono">{detail.brands.length}</span></h3>
        {detail.brands.length === 0 && <p className="muted">لا علامات بعد.</p>}
        {detail.brands.length > 0 && (
          <div className="tblwrap">
            <table className="tbl">
              <thead><tr><th>العلامة</th><th>التصنيف</th><th>الفروع</th><th>الحالة</th></tr></thead>
              <tbody>
                {detail.brands.map((b) => (
                  <tr key={b.id}>
                    <td><b>{b.name_ar}</b></td>
                    <td>{b.cuisine_ar ?? "—"}</td>
                    <td className="mono">{b.branches}</td>
                    <td><span className={`badge ${b.is_active ? "b-lime" : "b-soft"}`} style={{ fontSize: "10.5px" }}>{b.is_active ? "فعالة" : "موقوفة"}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* الفروع */}
      <div className="pcardx" style={{ marginTop: 12 }} data-testid="merchant-file-branches">
        <h3>الفروع <span className="sp mono">{detail.branches.length}</span></h3>
        {detail.branches.length === 0 && <p className="muted">لا فروع بعد.</p>}
        {detail.branches.length > 0 && (
          <div className="tblwrap">
            <table className="tbl">
              <thead><tr><th>الفرع</th><th>العلامة</th><th>كود الدخول</th><th>المدينة</th><th>العنوان</th><th>الهاتف</th><th>الطلبات</th><th>الحالة</th></tr></thead>
              <tbody>
                {detail.branches.map((b) => {
                  const st = BRANCH_STATUS_AR[b.status] ?? { label: b.status, cls: "b-soft" };
                  return (
                    <tr key={b.id}>
                      <td><b>{b.name_ar}</b></td>
                      <td>{b.brand}</td>
                      <td className="mono">{b.branch_code}</td>
                      <td>{b.city}</td>
                      <td>{b.address_short}</td>
                      <td className="mono">{b.phone ?? "—"}</td>
                      <td className="mono">{b.orders.toLocaleString("en")}</td>
                      <td>
                        <span className={`badge ${b.is_active ? st.cls : "b-err"}`} style={{ fontSize: "10.5px" }}>
                          {b.is_active ? st.label : "معطل"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* الفريق */}
      <div className="pcardx" style={{ marginTop: 12 }} data-testid="merchant-file-staff">
        <h3>الفريق <span className="sp mono">{detail.staff.length}</span></h3>
        {detail.staff.length === 0 && <p className="muted">لا موظفين بعد.</p>}
        {detail.staff.length > 0 && (
          <div className="tblwrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>الاسم</th>
                  <th>اسم الدخول</th>
                  <th>كلمة المرور</th>
                  <th>الدور</th>
                  <th>الفروع</th>
                  <th>الحالة</th>
                </tr>
              </thead>
              <tbody>
                {detail.staff.map((m) => {
                  const st = STAFF_STATUS_AR[m.status] ?? { label: m.status, cls: "b-soft" };
                  return (
                    <tr key={m.id}>
                      <td><b>{m.full_name}</b></td>
                      <td className="mono">{m.username}</td>
                      <td>
                        {m.pin === undefined ? (
                          <span className="muted" title="تظهر لدور السوبر أدمن فقط">مخفية</span>
                        ) : (
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                            <b className="mono" data-testid="staff-pin">{m.pin ?? "—"}</b>
                            <button
                              type="button"
                              className="btn sm"
                              data-testid="staff-pin-change"
                              onClick={() => setPinTarget({ id: m.id, full_name: m.full_name, username: m.username })}
                            >
                              تغيير
                            </button>
                          </span>
                        )}
                      </td>
                      <td>{ROLE_AR[m.role_key.replace(/^merchant:/, "")] ?? m.role_key}</td>
                      <td>{m.branches.length > 0 ? m.branches.join("، ") : "كل الفروع"}</td>
                      <td><span className={`badge ${st.cls}`} style={{ fontSize: "10.5px" }}>{st.label}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {detail.staff.some((m) => m.pin === null) && (
          <p className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>
            «—» = كلمة مرور سبقت التخزين المشفر ولا يمكن عرضها — عيّن جديدة بزر «تغيير».
          </p>
        )}
      </div>

      {/* آخر الطلبات */}
      <div className="pcardx" style={{ marginTop: 12 }} data-testid="merchant-file-orders">
        <h3>آخر الطلبات <span className="sp mono">{detail.recent_orders.length}</span></h3>
        {detail.recent_orders.length === 0 && <p className="muted">لا طلبات بعد.</p>}
        {detail.recent_orders.length > 0 && (
          <div className="tblwrap">
            <table className="tbl">
              <thead><tr><th>الطلب</th><th>الفرع</th><th>القيمة (ر.س)</th><th>الحالة الداخلية</th><th>الوقت</th></tr></thead>
              <tbody>
                {detail.recent_orders.map((o) => (
                  <tr key={o.id}>
                    <td className="mono"><b>{o.display_code}</b></td>
                    <td>{o.branch}</td>
                    <td className="mono">{sar(o.total_halalas)}</td>
                    <td>
                      <span className={`badge ${orderStatusCls(o.order_status)}`} style={{ fontSize: "10px" }}>
                        <span className="mono">{o.order_status}</span>
                      </span>
                    </td>
                    <td className="mono">{shortDateTime(o.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>
          السجل الكامل والخط الزمني لكل طلب في وحدة «الطلبات».
        </p>
      </div>

      {/* التسويات والحوالات */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12, marginTop: 12 }}>
        <div className="pcardx" data-testid="merchant-file-settlements">
          <h3>التسويات</h3>
          {detail.settlements.length === 0 && <p className="muted">لا تسويات بعد.</p>}
          {detail.settlements.length > 0 && (
            <div className="tblwrap">
              <table className="tbl">
                <thead><tr><th>الفترة</th><th>الإجمالي (ر.س)</th><th>الصافي (ر.س)</th><th>الحالة</th></tr></thead>
                <tbody>
                  {detail.settlements.map((st) => {
                    const b = SETTLEMENT_STATUS_AR[st.status] ?? { label: st.status, cls: "b-soft" };
                    return (
                      <tr key={st.id}>
                        <td className="mono">{shortDate(st.period_start)} – {shortDate(st.period_end)}</td>
                        <td className="mono">{sar(st.gross_halalas)}</td>
                        <td className="mono"><b>{sar(st.net_halalas)}</b></td>
                        <td><span className={`badge ${b.cls}`} style={{ fontSize: "10.5px" }}>{b.label}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div className="pcardx" data-testid="merchant-file-payouts">
          <h3>الحوالات</h3>
          {detail.payouts.length === 0 && <p className="muted">لا حوالات بعد.</p>}
          {detail.payouts.length > 0 && (
            <div className="tblwrap">
              <table className="tbl">
                <thead><tr><th>المبلغ (ر.س)</th><th>مرجع البنك</th><th>الحالة</th><th>التاريخ</th></tr></thead>
                <tbody>
                  {detail.payouts.map((p) => {
                    const b = PAYOUT_STATUS_AR[p.status] ?? { label: p.status, cls: "b-soft" };
                    return (
                      <tr key={p.id}>
                        <td className="mono"><b>{sar(p.amount_halalas)}</b></td>
                        <td className="mono">{p.bank_ref ?? "—"}</td>
                        <td><span className={`badge ${b.cls}`} style={{ fontSize: "10.5px" }}>{b.label}</span></td>
                        <td className="mono">{shortDate(p.created_at)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* سجل قرارات المنصة */}
      <div className="pcardx" style={{ marginTop: 12 }} data-testid="merchant-file-audit">
        <h3>سجل قرارات المنصة على هذا التاجر</h3>
        {detail.audit_trail.length === 0 && <p className="muted">لا قرارات مسجلة بعد.</p>}
        {detail.audit_trail.map((a) => (
          <div key={a.id} className="note soft" style={{ marginTop: 8 }} data-testid="merchant-file-audit-row">
            <b>{AUDIT_ACTION_AR[a.action] ?? a.action}</b>
            {a.reason ? ` — ${a.reason}` : ""}
            <span className="muted" style={{ marginInlineStart: 8, fontSize: 11 }}>{shortDateTime(a.created_at)}</span>
          </div>
        ))}
      </div>

      {action && (
        <ReasonModal
          title={
            action === "approve"
              ? `اعتماد التاجر «${detail.name_ar}»`
              : `تعليق التاجر «${detail.name_ar}» — يوقف الاستقبال`
          }
          confirmLabel={action === "approve" ? "اعتماد" : "تعليق"}
          danger={action === "suspend"}
          busy={busy}
          onConfirm={confirm}
          onClose={() => setAction(null)}
        />
      )}

      {pinTarget && (
        <PinModal
          staffName={pinTarget.full_name}
          username={pinTarget.username}
          busy={busy}
          onConfirm={changePin}
          onClose={() => setPinTarget(null)}
        />
      )}
    </div>
  );
}
