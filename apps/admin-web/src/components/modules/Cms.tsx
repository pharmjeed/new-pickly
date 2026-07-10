"use client";

/**
 * A-13: CMS (مرحلة 2) — FR-A10:
 * قوالب الإشعارات (notification_templates — docs/15§48) تحرير نص + تفعيل،
 * وبانرات التطبيق (system_settings: cms.banners — سجل تاريخي بالتاريخ الساري).
 */
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, apiGet, apiPost } from "@/lib/api";
import ReasonModal from "@/components/ReasonModal";

type Template = {
  key: string;
  channel: string;
  title_ar: string;
  body_ar: string;
  is_active: boolean;
};

type Banner = {
  title_ar: string;
  body_ar: string | null;
  image_url: string | null;
  link: string | null;
};

export default function Cms() {
  const router = useRouter();
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [banners, setBanners] = useState<Banner[] | null>(null);
  const [editing, setEditing] = useState<Template | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingSave, setPendingSave] = useState<"template" | "banners" | null>(null);
  const [bannersDirty, setBannersDirty] = useState(false);

  const load = useCallback(() => {
    Promise.all([
      apiGet<Template[]>("/api/v1/admin/cms/templates"),
      apiGet<{ banners: Banner[] }>("/api/v1/admin/cms/banners")
    ])
      .then(([tpls, b]) => {
        setTemplates(tpls);
        setBanners(b.banners);
        setBannersDirty(false);
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

  const confirmSave = async (reason: string) => {
    setBusy(true);
    setError(null);
    try {
      if (pendingSave === "template" && editing) {
        await apiPost(`/api/v1/admin/cms/templates/${editing.key}`, {
          title_ar: editing.title_ar,
          body_ar: editing.body_ar,
          is_active: editing.is_active,
          reason
        });
        setNotice(`حُفظ القالب ${editing.key}`);
        setEditing(null);
      } else if (pendingSave === "banners" && banners) {
        await apiPost("/api/v1/admin/cms/banners", { banners, reason });
        setNotice("حُفظت البانرات — تسري فوراً في التطبيق");
      }
      setPendingSave(null);
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const setBanner = (i: number, patch: Partial<Banner>) => {
    if (!banners) return;
    setBanners(banners.map((b, idx) => (idx === i ? { ...b, ...patch } : b)));
    setBannersDirty(true);
  };

  return (
    <>
      {error && <div className="note err" data-testid="cms-error">{error}</div>}
      {notice && <div className="note info" data-testid="cms-notice">{notice}</div>}
      {!templates && !error && <div className="skl" style={{ height: 260 }} />}

      {banners && (
        <div className="pcardx" data-testid="cms-banners">
          <h3>
            بانرات التطبيق (C-09)
            <span className="sp">
              <button
                type="button"
                className="btn sm"
                style={{ marginInlineEnd: 6 }}
                data-testid="banner-add"
                onClick={() => {
                  setBanners([...banners, { title_ar: "", body_ar: null, image_url: null, link: null }]);
                  setBannersDirty(true);
                }}
              >
                + بانر
              </button>
              <button type="button" className="btn sm" disabled={!bannersDirty || busy} data-testid="banners-save" onClick={() => setPendingSave("banners")}>
                حفظ البانرات
              </button>
            </span>
          </h3>
          {banners.length === 0 && <p className="muted" style={{ fontSize: 13 }}>لا بانرات — أضف أول بانر ليظهر في رئيسية العميل.</p>}
          <div style={{ display: "grid", gap: 10 }}>
            {banners.map((b, i) => (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr auto", gap: 8, alignItems: "end" }} data-testid="banner-row">
                <div className="fld">
                  <label>العنوان</label>
                  <input className="inp" value={b.title_ar} onChange={(e) => setBanner(i, { title_ar: e.target.value })} />
                </div>
                <div className="fld">
                  <label>نص فرعي</label>
                  <input className="inp" value={b.body_ar ?? ""} onChange={(e) => setBanner(i, { body_ar: e.target.value || null })} />
                </div>
                <div className="fld">
                  <label>رابط (اختياري)</label>
                  <input className="inp mono" value={b.link ?? ""} onChange={(e) => setBanner(i, { link: e.target.value || null })} />
                </div>
                <button
                  type="button"
                  className="btn sm dgh"
                  onClick={() => {
                    setBanners(banners.filter((_, idx) => idx !== i));
                    setBannersDirty(true);
                  }}
                >
                  حذف
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {templates && (
        <div className="tblwrap" style={{ marginTop: 14 }}>
          <table className="tbl" data-testid="cms-templates">
            <thead>
              <tr>
                <th>القالب</th>
                <th>العنوان</th>
                <th>النص</th>
                <th>الحالة</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {templates.map((t) => (
                <tr key={t.key} data-testid="template-row">
                  <td className="mono"><b>{t.key}</b></td>
                  <td>{t.title_ar}</td>
                  <td style={{ maxWidth: 320 }}>{t.body_ar}</td>
                  <td>
                    <span className={`badge ${t.is_active ? "b-ok" : "b-soft"}`}>{t.is_active ? "فعال" : "معطل"}</span>
                  </td>
                  <td>
                    <button type="button" className="btn sm" data-testid="template-edit" onClick={() => setEditing({ ...t })}>
                      تحرير
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <div className="pcardx" style={{ marginTop: 14 }} data-testid="template-editor">
          <h3>تحرير قالب <span className="mono">{editing.key}</span></h3>
          <div style={{ display: "grid", gap: 10 }}>
            <div className="fld">
              <label>العنوان</label>
              <input className="inp" value={editing.title_ar} onChange={(e) => setEditing({ ...editing, title_ar: e.target.value })} data-testid="template-title" />
            </div>
            <div className="fld">
              <label>النص — المتغيرات بين أقواس مزدوجة مثل {"{{display_code}}"}</label>
              <textarea value={editing.body_ar} onChange={(e) => setEditing({ ...editing, body_ar: e.target.value })} data-testid="template-body" />
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
              <input type="checkbox" checked={editing.is_active} onChange={(e) => setEditing({ ...editing, is_active: e.target.checked })} />
              القالب فعال
            </label>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" className="btn sm" disabled={busy} onClick={() => setPendingSave("template")} data-testid="template-save">
                حفظ القالب
              </button>
              <button type="button" className="btn sm dgh" onClick={() => setEditing(null)}>إلغاء</button>
            </div>
          </div>
        </div>
      )}

      <div className="note soft">
        القوالب تغذي إشعارات docs/15 (Push + صندوق التطبيق) — التعديل يسري على الإشعارات الجديدة فوراً ويدخل سجل التدقيق.
      </div>

      {pendingSave && (
        <ReasonModal
          title={pendingSave === "template" ? `حفظ القالب ${editing?.key ?? ""}` : "حفظ بانرات التطبيق"}
          confirmLabel="حفظ"
          busy={busy}
          onConfirm={confirmSave}
          onClose={() => setPendingSave(null)}
        />
      )}
    </>
  );
}
