"use client";

/**
 * A-13: CMS (مرحلة 2) — FR-A10:
 * بانرات رئيسية العميل (system_settings: cms.banners — سجل تاريخي بالتاريخ الساري)،
 * تصنيفات المطاعم C-09 (cms.categories: إضافة/حذف/ترتيب/تفعيل)،
 * إسناد تصنيف كل مطعم (brand.cuisine_ar)،
 * وقوالب الإشعارات (notification_templates — docs/15§48).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, apiGet, apiPost } from "@/lib/api";
import { resizeImage } from "@/lib/image";
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

type Category = {
  name_ar: string;
  is_active: boolean;
};

type BrandRow = {
  id: string;
  name_ar: string;
  merchant_name_ar: string;
  cuisine_ar: string | null;
  is_active: boolean;
};

type PendingSave =
  | { kind: "template" }
  | { kind: "banners" }
  | { kind: "categories" }
  | { kind: "brand"; brand: BrandRow; cuisine: string | null };

/**
 * خلية صورة البانر — رفع من الجهاز فقط (لا لصق روابط).
 * تُصغَّر في المتصفح إلى ≤1200px وتُخزَّن data URL (نمط شعار/غلاف بوابة التاجر).
 */
function BannerImageCell({
  value,
  onChange,
  onError
}: {
  value: string | null;
  onChange: (dataUrl: string | null) => void;
  onError: (msg: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [working, setWorking] = useState(false);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setWorking(true);
    try {
      if (file.size > 12 * 1024 * 1024) throw new Error("الصورة أكبر من 12MB");
      onChange(await resizeImage(file, 1200));
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="fld">
      <label>صورة البانر (اختياري)</label>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={value}
            alt=""
            style={{ width: 56, height: 40, objectFit: "cover", borderRadius: 8, border: "1px solid var(--pk-line)", flexShrink: 0 }}
          />
        ) : (
          <div
            style={{
              width: 56,
              height: 40,
              borderRadius: 8,
              border: "1px dashed var(--pk-line)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 16,
              color: "var(--pk-text-2)",
              flexShrink: 0
            }}
          >
            🖼️
          </div>
        )}
        <button type="button" className="btn sm" disabled={working} data-testid="banner-image-pick" onClick={() => fileRef.current?.click()}>
          {working ? "جارٍ…" : value ? "تغيير" : "رفع صورة"}
        </button>
        {value && (
          <button type="button" className="btn sm dgh" onClick={() => onChange(null)}>
            إزالة
          </button>
        )}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        style={{ display: "none" }}
        onChange={(e) => {
          void pick(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </div>
  );
}

export default function Cms() {
  const router = useRouter();
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [banners, setBanners] = useState<Banner[] | null>(null);
  const [categories, setCategories] = useState<Category[] | null>(null);
  const [brands, setBrands] = useState<BrandRow[] | null>(null);
  const [editing, setEditing] = useState<Template | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingSave, setPendingSave] = useState<PendingSave | null>(null);
  const [bannersDirty, setBannersDirty] = useState(false);
  const [categoriesDirty, setCategoriesDirty] = useState(false);
  // اختيار التصنيف لكل مطعم قبل الحفظ (brand_id → cuisine)
  const [brandCuisine, setBrandCuisine] = useState<Record<string, string>>({});

  const load = useCallback(() => {
    Promise.all([
      apiGet<Template[]>("/api/v1/admin/cms/templates"),
      apiGet<{ banners: Banner[] }>("/api/v1/admin/cms/banners"),
      apiGet<{ categories: Category[] }>("/api/v1/admin/cms/categories"),
      apiGet<BrandRow[]>("/api/v1/admin/brands")
    ])
      .then(([tpls, b, cats, br]) => {
        setTemplates(tpls);
        setBanners(b.banners);
        setCategories(cats.categories);
        setBrands(br);
        setBrandCuisine(Object.fromEntries(br.map((x) => [x.id, x.cuisine_ar ?? ""])));
        setBannersDirty(false);
        setCategoriesDirty(false);
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
    if (!pendingSave) return;
    setBusy(true);
    setError(null);
    try {
      if (pendingSave.kind === "template" && editing) {
        await apiPost(`/api/v1/admin/cms/templates/${editing.key}`, {
          title_ar: editing.title_ar,
          body_ar: editing.body_ar,
          is_active: editing.is_active,
          reason
        });
        setNotice(`حُفظ القالب ${editing.key}`);
        setEditing(null);
      } else if (pendingSave.kind === "banners" && banners) {
        await apiPost("/api/v1/admin/cms/banners", { banners, reason });
        setNotice("حُفظت البانرات — تسري فوراً في التطبيق");
      } else if (pendingSave.kind === "categories" && categories) {
        await apiPost("/api/v1/admin/cms/categories", { categories, reason });
        setNotice("حُفظت التصنيفات — تسري فوراً في رئيسية العميل");
      } else if (pendingSave.kind === "brand") {
        await apiPost(`/api/v1/admin/brands/${pendingSave.brand.id}/cuisine`, {
          cuisine_ar: pendingSave.cuisine,
          reason
        });
        setNotice(`حُفظ تصنيف ${pendingSave.brand.name_ar}`);
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

  const setCategory = (i: number, patch: Partial<Category>) => {
    if (!categories) return;
    setCategories(categories.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
    setCategoriesDirty(true);
  };

  const moveCategory = (i: number, dir: -1 | 1) => {
    if (!categories) return;
    const j = i + dir;
    if (j < 0 || j >= categories.length) return;
    const next = [...categories];
    const a = next[i];
    const b = next[j];
    if (!a || !b) return;
    next[i] = b;
    next[j] = a;
    setCategories(next);
    setCategoriesDirty(true);
  };

  const modalTitle =
    pendingSave?.kind === "template"
      ? `حفظ القالب ${editing?.key ?? ""}`
      : pendingSave?.kind === "banners"
        ? "حفظ بانرات التطبيق"
        : pendingSave?.kind === "categories"
          ? "حفظ تصنيفات المطاعم"
          : pendingSave?.kind === "brand"
            ? `حفظ تصنيف ${pendingSave.brand.name_ar}`
            : "";

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
              <button type="button" className="btn sm" disabled={!bannersDirty || busy} data-testid="banners-save" onClick={() => setPendingSave({ kind: "banners" })}>
                حفظ البانرات
              </button>
            </span>
          </h3>
          {banners.length === 0 && <p className="muted" style={{ fontSize: 13 }}>لا بانرات — أضف أول بانر ليظهر في رئيسية العميل.</p>}
          <div style={{ display: "grid", gap: 10 }}>
            {banners.map((b, i) => (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr auto", gap: 8, alignItems: "end" }} data-testid="banner-row">
                <div className="fld">
                  <label>العنوان</label>
                  <input className="inp" value={b.title_ar} onChange={(e) => setBanner(i, { title_ar: e.target.value })} />
                </div>
                <div className="fld">
                  <label>نص فرعي</label>
                  <input className="inp" value={b.body_ar ?? ""} onChange={(e) => setBanner(i, { body_ar: e.target.value || null })} />
                </div>
                <BannerImageCell
                  value={b.image_url}
                  onChange={(dataUrl) => setBanner(i, { image_url: dataUrl })}
                  onError={setError}
                />
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
          <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            بلا صورة يظهر البانر بخلفية داكنة بالعنوان والنص · ارفع صورة من جهازك لتظهر خلفية كاملة (تُصغَّر تلقائياً) · تتحرك تلقائياً كل 4 ثوانٍ.
          </p>
        </div>
      )}

      {categories && (
        <div className="pcardx" style={{ marginTop: 14 }} data-testid="cms-categories">
          <h3>
            تصنيفات المطاعم (C-09)
            <span className="sp">
              <button
                type="button"
                className="btn sm"
                style={{ marginInlineEnd: 6 }}
                data-testid="category-add"
                onClick={() => {
                  setCategories([...categories, { name_ar: "", is_active: true }]);
                  setCategoriesDirty(true);
                }}
              >
                + تصنيف
              </button>
              <button
                type="button"
                className="btn sm"
                disabled={!categoriesDirty || busy}
                data-testid="categories-save"
                onClick={() => setPendingSave({ kind: "categories" })}
              >
                حفظ التصنيفات
              </button>
            </span>
          </h3>
          {categories.length === 0 && (
            <p className="muted" style={{ fontSize: 13 }}>
              لا تصنيفات — بلا قائمة هنا تُشتق التصنيفات تلقائياً من المطاعم القريبة للعميل.
            </p>
          )}
          <div style={{ display: "grid", gap: 8 }}>
            {categories.map((c, i) => (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "auto auto 1fr auto auto", gap: 8, alignItems: "center" }} data-testid="category-row">
                <button type="button" className="btn sm" disabled={i === 0} aria-label="أعلى" onClick={() => moveCategory(i, -1)}>
                  ↑
                </button>
                <button type="button" className="btn sm" disabled={i === categories.length - 1} aria-label="أسفل" onClick={() => moveCategory(i, 1)}>
                  ↓
                </button>
                <input
                  className="inp"
                  placeholder="اسم التصنيف — برجر، شاورما، مقهى…"
                  value={c.name_ar}
                  onChange={(e) => setCategory(i, { name_ar: e.target.value })}
                  data-testid="category-name"
                />
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, whiteSpace: "nowrap" }}>
                  <input type="checkbox" checked={c.is_active} onChange={(e) => setCategory(i, { is_active: e.target.checked })} />
                  فعال
                </label>
                <button
                  type="button"
                  className="btn sm dgh"
                  onClick={() => {
                    setCategories(categories.filter((_, idx) => idx !== i));
                    setCategoriesDirty(true);
                  }}
                >
                  حذف
                </button>
              </div>
            ))}
          </div>
          <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            الترتيب هنا هو ترتيب الظهور في رئيسية العميل · المعطل يختفي فوراً · اربط كل مطعم بتصنيفه من الجدول أدناه.
          </p>
        </div>
      )}

      {brands && (
        <div className="pcardx" style={{ marginTop: 14 }} data-testid="cms-brands">
          <h3>تصنيف كل مطعم</h3>
          <div className="tblwrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>المطعم</th>
                  <th>التاجر</th>
                  <th>التصنيف</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {brands.map((b) => (
                  <tr key={b.id} data-testid="brand-row">
                    <td><b>{b.name_ar}</b></td>
                    <td>{b.merchant_name_ar}</td>
                    <td>
                      <select
                        className="inp"
                        value={brandCuisine[b.id] ?? ""}
                        onChange={(e) => setBrandCuisine({ ...brandCuisine, [b.id]: e.target.value })}
                        data-testid="brand-cuisine"
                      >
                        <option value="">— بدون تصنيف —</option>
                        {(categories ?? []).map((c) => (
                          <option key={c.name_ar} value={c.name_ar}>
                            {c.name_ar}
                          </option>
                        ))}
                        {/* تصنيف حالي غير موجود في القائمة — يبقى قابلاً للعرض */}
                        {b.cuisine_ar && !(categories ?? []).some((c) => c.name_ar === b.cuisine_ar) && (
                          <option value={b.cuisine_ar}>{b.cuisine_ar}</option>
                        )}
                      </select>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn sm"
                        disabled={busy || (brandCuisine[b.id] ?? "") === (b.cuisine_ar ?? "")}
                        data-testid="brand-cuisine-save"
                        onClick={() =>
                          setPendingSave({ kind: "brand", brand: b, cuisine: (brandCuisine[b.id] ?? "").trim() || null })
                        }
                      >
                        حفظ
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
              <button type="button" className="btn sm" disabled={busy} onClick={() => setPendingSave({ kind: "template" })} data-testid="template-save">
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
          title={modalTitle}
          confirmLabel="حفظ"
          busy={busy}
          onConfirm={confirmSave}
          onClose={() => setPendingSave(null)}
        />
      )}
    </>
  );
}
