"use client";

/**
 * A-03/A-04: التجار — GET /api/v1/admin/merchants جدول،
 * قبول POST /merchants/{id}/approve وتعليق POST /merchants/{id}/suspend —
 * كلاهما عبر نافذة سبب إلزامي ≥3 أحرف (BR-15).
 * النقر على التاجر يفتح ملفه الكامل (A-04ب — MerchantFile).
 */
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, apiGet, apiPost, shortDate } from "@/lib/api";
import ReasonModal from "@/components/ReasonModal";
import MerchantFile, { MERCHANT_STATUS_AR, PLAN_AR } from "@/components/modules/MerchantFile";
import { Qirtas, QirtasLoader } from "@/components/qirtas";

type Merchant = {
  id: string;
  name_ar: string;
  status: string;
  plan_key: string;
  branches: number;
  orders: number;
  created_at: string;
};

type PendingAction = { merchant: Merchant; kind: "approve" | "suspend" };

type Draft = {
  name_ar: string;
  brand_name_ar: string;
  cuisine_ar: string;
  owner_name: string;
  owner_phone: string;
};

const EMPTY_DRAFT: Draft = { name_ar: "", brand_name_ar: "", cuisine_ar: "", owner_name: "", owner_phone: "" };

export default function Merchants() {
  const router = useRouter();
  const [merchants, setMerchants] = useState<Merchant[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<PendingAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pendingCreate, setPendingCreate] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

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

  const validDraft =
    draft &&
    draft.name_ar.trim().length >= 2 &&
    draft.owner_name.trim().length >= 2 &&
    /^(05\d{8}|\+9665\d{8})$/.test(draft.owner_phone.trim());

  const confirmCreate = async (reason: string) => {
    if (!draft || !validDraft) return;
    setBusy(true);
    setError(null);
    try {
      await apiPost("/api/v1/admin/merchants", {
        name_ar: draft.name_ar.trim(),
        brand_name_ar: draft.brand_name_ar.trim() || null,
        cuisine_ar: draft.cuisine_ar.trim() || null,
        owner_name: draft.owner_name.trim(),
        owner_phone: draft.owner_phone.trim(),
        reason
      });
      setNotice(
        `أُنشئ التاجر «${draft.name_ar.trim()}» — يدخل المالك بوابة التاجر بجواله (رمز تحقق) وينشئ فروعه ومنيوه من هناك`
      );
      setDraft(null);
      setPendingCreate(false);
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

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

  // ملف تاجر مفتوح — يحل محل القائمة حتى «عودة للتجار»
  if (openId) {
    return <MerchantFile merchantId={openId} onBack={() => setOpenId(null)} onChanged={load} />;
  }

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

      {!merchants && !error && <div className="loadwrap" style={{ minHeight: 260 }}><QirtasLoader /></div>}

      {merchants && !draft && (
        <div style={{ display: "flex", marginBottom: 12 }}>
          <button type="button" className="btn sm" data-testid="merchant-new" onClick={() => setDraft({ ...EMPTY_DRAFT })}>
            + تاجر جديد
          </button>
        </div>
      )}

      {draft && (
        <div className="pcardx" style={{ marginBottom: 14 }} data-testid="merchant-form">
          <h3>تاجر جديد</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
            <div className="fld">
              <label>اسم التاجر (الشركة)</label>
              <input
                className="inp"
                value={draft.name_ar}
                onChange={(e) => setDraft({ ...draft, name_ar: e.target.value })}
                placeholder="شركة المذاق للتجارة"
                data-testid="merchant-name"
                autoFocus
              />
            </div>
            <div className="fld">
              <label>اسم العلامة التجارية</label>
              <input
                className="inp"
                value={draft.brand_name_ar}
                onChange={(e) => setDraft({ ...draft, brand_name_ar: e.target.value })}
                placeholder="اختياري — الافتراضي اسم التاجر"
                data-testid="merchant-brand"
              />
            </div>
            <div className="fld">
              <label>التصنيف</label>
              <input
                className="inp"
                value={draft.cuisine_ar}
                onChange={(e) => setDraft({ ...draft, cuisine_ar: e.target.value })}
                placeholder="اختياري — مثل: برجر"
                data-testid="merchant-cuisine"
              />
            </div>
            <div className="fld">
              <label>اسم المالك</label>
              <input
                className="inp"
                value={draft.owner_name}
                onChange={(e) => setDraft({ ...draft, owner_name: e.target.value })}
                placeholder="عبدالله العتيبي"
                data-testid="merchant-owner-name"
              />
            </div>
            <div className="fld">
              <label>جوال المالك</label>
              <input
                className="inp mono"
                inputMode="tel"
                dir="ltr"
                value={draft.owner_phone}
                onChange={(e) => setDraft({ ...draft, owner_phone: e.target.value })}
                placeholder="05XXXXXXXX"
                data-testid="merchant-owner-phone"
              />
              <span className="hint">به يدخل المالك بوابة التاجر (رمز تحقق)</span>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button
              type="button"
              className="btn sm"
              disabled={!validDraft || busy}
              onClick={() => setPendingCreate(true)}
              data-testid="merchant-save"
            >
              إنشاء التاجر
            </button>
            <button type="button" className="btn sm dgh" onClick={() => setDraft(null)}>
              إلغاء
            </button>
          </div>
        </div>
      )}

      {merchants && merchants.length === 0 && !draft && (
        <div className="empty">
          <div className="qr"><Qirtas mood="sleepy" size={72} /></div>
          <b>لا تجار بعد</b>
          <p>أنشئ أول تاجر بزر «+ تاجر جديد» أو انتظر طلبات الانضمام</p>
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
                const badge = MERCHANT_STATUS_AR[m.status] ?? { label: m.status, cls: "b-soft" };
                return (
                  <tr key={m.id} data-testid="merchant-row">
                    <td>
                      <button
                        type="button"
                        data-testid="merchant-open"
                        onClick={() => setOpenId(m.id)}
                        title="فتح ملف التاجر الكامل"
                        style={{
                          background: "none",
                          border: "none",
                          padding: 0,
                          cursor: "pointer",
                          font: "inherit",
                          color: "var(--pk-blue-500)",
                          fontWeight: 800,
                          textDecoration: "underline",
                          textUnderlineOffset: 3
                        }}
                      >
                        {m.name_ar}
                      </button>
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
                        <button
                          type="button"
                          className="btn sm"
                          data-testid="merchant-file-open"
                          onClick={() => setOpenId(m.id)}
                        >
                          الملف الكامل
                        </button>
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

      {pendingCreate && draft && (
        <ReasonModal
          title={`إنشاء التاجر «${draft.name_ar.trim()}»`}
          hint="مثل: تعاقد موقع — يدخل سجل التدقيق"
          confirmLabel="إنشاء"
          busy={busy}
          onConfirm={confirmCreate}
          onClose={() => setPendingCreate(false)}
        />
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
