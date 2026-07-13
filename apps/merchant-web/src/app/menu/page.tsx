"use client";

/**
 * M-08: المنيو والتوفر — اختيار فرع، جدول المنتجات، وإضافة/تعديل صنف بكل تفاصيله
 * (صورة + تصنيف + سعر + سعرات + وصف + مجموعات مُعدِّلات) — docs/11§6 CRUD.
 * الصورة تُصغَّر في المتصفح (≤800px JPEG) وتُرسل data URL.
 * الشكل: design/merchant/M-08.html
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Shell from "@/components/Shell";
import { clearToken, ApiError, apiGet, apiPost, apiPatch, apiDelete, sar } from "@/lib/api";
import { resizeImage } from "@/lib/image";
import s from "./menu.module.css";

type Branch = { id: string; name_ar: string; branch_code: string; status: string };
type ModGroup = {
  name_ar: string;
  min_select: number;
  max_select: number;
  modifiers: { name_ar: string; price_halalas: number }[];
};
type Product = {
  id: string;
  name_ar: string;
  description_ar: string | null;
  price_halalas: number;
  sale_price_halalas: number | null;
  sale_ends_at: string | null;
  on_sale: boolean;
  calories: number | null;
  image_url: string | null;
  is_active: boolean;
  is_available: boolean;
  modifier_groups: ModGroup[];
};
type Category = { id: string; name_ar: string; products: Product[] };
type Menu = { categories: Category[] };

interface GroupDraft {
  name_ar: string;
  min_select: number;
  max_select: number;
  modifiers: { name_ar: string; price: string }[];
}
const emptyGroup = (): GroupDraft => ({ name_ar: "", min_select: 0, max_select: 1, modifiers: [{ name_ar: "", price: "" }] });

export default function MenuPage() {
  const router = useRouter();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState<string>("");
  const [menu, setMenu] = useState<Menu | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  // نموذج إضافة/تعديل
  const [formOpen, setFormOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null); // null = إضافة
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState<string>("");
  const [newCategory, setNewCategory] = useState("");
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [price, setPrice] = useState("");
  const [salePrice, setSalePrice] = useState(""); // سعر العرض (فارغ = لا عرض)
  const [saleEnds, setSaleEnds] = useState(""); // تاريخ نهاية العرض YYYY-MM-DD (اختياري)
  const [calories, setCalories] = useState("");
  const [groups, setGroups] = useState<GroupDraft[]>([]);
  const [image, setImage] = useState<string | null>(null); // data URL أو رابط موجود
  const [imageChanged, setImageChanged] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const onApiError = useCallback(
    (e: unknown) => {
      if (e instanceof ApiError && e.status === 401) {
        clearToken();
        router.replace("/");
        return;
      }
      setError((e as Error).message);
    },
    [router]
  );

  const loadMenu = useCallback(
    (bid: string) => {
      apiGet<Menu>(`/api/v1/merchant/menu?branch_id=${encodeURIComponent(bid)}`)
        .then((m) => {
          setMenu(m);
          setCategoryId((cur) => cur || m.categories[0]?.id || "");
        })
        .catch(onApiError);
    },
    [onApiError]
  );

  useEffect(() => {
    apiGet<Branch[]>("/api/v1/merchant/branches")
      .then((list) => {
        setBranches(list);
        if (list.length > 0) setBranchId((cur) => cur || list[0]!.id);
      })
      .catch(onApiError);
  }, [onApiError]);

  useEffect(() => {
    if (!branchId) return;
    setMenu(null);
    setError(null);
    loadMenu(branchId);
  }, [branchId, loadMenu]);

  const toggle = async (product: Product) => {
    if (!branchId || pending) return;
    const next = !product.is_available;
    setPending(product.id);
    try {
      await apiPost("/api/v1/merchant/availability", { branch_id: branchId, product_id: product.id, is_available: next });
      setMenu((m) =>
        m
          ? {
              categories: m.categories.map((c) => ({
                ...c,
                products: c.products.map((p) => (p.id === product.id ? { ...p, is_available: next } : p))
              }))
            }
          : m
      );
    } catch (e) {
      onApiError(e);
    } finally {
      setPending(null);
    }
  };

  const resetForm = () => {
    setEditId(null);
    setName("");
    setDesc("");
    setPrice("");
    setSalePrice("");
    setSaleEnds("");
    setCalories("");
    setGroups([]);
    setNewCategory("");
    setImage(null);
    setImageChanged(false);
    setFormError(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  const openAdd = () => {
    resetForm();
    setCategoryId(menu?.categories[0]?.id ?? "");
    setFormOpen(true);
  };

  const openEdit = (cat: Category, p: Product) => {
    resetForm();
    setEditId(p.id);
    setCategoryId(cat.id);
    setName(p.name_ar);
    setDesc(p.description_ar ?? "");
    setPrice((p.price_halalas / 100).toString());
    setSalePrice(p.sale_price_halalas != null ? (p.sale_price_halalas / 100).toString() : "");
    setSaleEnds(p.sale_ends_at ? p.sale_ends_at.slice(0, 10) : "");
    setCalories(p.calories != null ? String(p.calories) : "");
    setImage(p.image_url);
    setGroups(
      p.modifier_groups.map((g) => ({
        name_ar: g.name_ar,
        min_select: g.min_select,
        max_select: g.max_select,
        modifiers: g.modifiers.map((m) => ({ name_ar: m.name_ar, price: m.price_halalas ? (m.price_halalas / 100).toString() : "" }))
      }))
    );
    setFormOpen(true);
  };

  const pickImage = async (file: File | undefined) => {
    if (!file) return;
    setFormError(null);
    try {
      if (file.size > 12 * 1024 * 1024) throw new Error("الصورة أكبر من 12MB");
      const dataUrl = await resizeImage(file);
      setImage(dataUrl);
      setImageChanged(true);
    } catch (e) {
      setFormError((e as Error).message);
    }
  };

  const clearImage = () => {
    setImage(null);
    setImageChanged(true);
    if (fileRef.current) fileRef.current.value = "";
  };

  const buildGroupsPayload = () =>
    groups.map((g) => ({
      name_ar: g.name_ar.trim(),
      min_select: g.min_select,
      max_select: g.max_select,
      modifiers: g.modifiers
        .filter((m) => m.name_ar.trim())
        .map((m) => ({ name_ar: m.name_ar.trim(), price_halalas: m.price.trim() ? Math.round(Number(m.price) * 100) : 0 }))
    }));

  const validate = (): string | null => {
    const priceNum = Number(price);
    if (name.trim().length < 2) return "اسم الصنف مطلوب";
    if (!Number.isFinite(priceNum) || priceNum <= 0) return "أدخل سعراً صحيحاً بالريال";
    if (salePrice.trim()) {
      const saleNum = Number(salePrice);
      if (!Number.isFinite(saleNum) || saleNum <= 0) return "أدخل سعر عرض صحيحاً بالريال";
      if (saleNum >= priceNum) return "سعر العرض يجب أن يكون أقل من سعر الصنف";
    }
    if (!editId && !categoryId && newCategory.trim().length < 2) return "اختر تصنيفاً أو أنشئ واحداً";
    for (const g of groups) {
      if (g.name_ar.trim().length < 1) return "اسم كل مجموعة تخصيص مطلوب";
      if (g.modifiers.filter((m) => m.name_ar.trim()).length === 0) return `أضف خياراً لمجموعة «${g.name_ar}»`;
      if (g.max_select < g.min_select) return `في «${g.name_ar}» الأقصى أصغر من الأدنى`;
    }
    return null;
  };

  const submit = async () => {
    const v = validate();
    if (v) return setFormError(v);
    setSaving(true);
    setFormError(null);
    const priceHalalas = Math.round(Number(price) * 100);
    // سعر العرض: قيمة إن أُدخل، null لإلغائه (في التعديل)
    const saleHalalas = salePrice.trim() ? Math.round(Number(salePrice) * 100) : null;
    // تاريخ النهاية → نهاية اليوم بتوقيت UTC-ISO (يسري حتى آخر اليوم المختار)
    const saleEndsIso = saleHalalas != null && saleEnds.trim()
      ? new Date(`${saleEnds}T23:59:59`).toISOString()
      : null;
    try {
      if (editId) {
        // تعديل — نرسل الحقول + الصورة إن تغيّرت + المجموعات دائماً (استبدال)
        await apiPatch(`/api/v1/merchant/products/${editId}`, {
          name_ar: name.trim(),
          description_ar: desc.trim() || null,
          price_halalas: priceHalalas,
          sale_price_halalas: saleHalalas,
          sale_ends_at: saleEndsIso,
          calories: calories.trim() ? Number(calories) : null,
          ...(imageChanged ? { image_data_url: image ?? "" } : {}),
          modifier_groups: buildGroupsPayload()
        });
      } else {
        let catId = categoryId;
        if (!catId && newCategory.trim()) {
          const created = await apiPost<{ id: string }>("/api/v1/merchant/categories", {
            branch_id: branchId,
            name_ar: newCategory.trim()
          });
          catId = created.id;
        }
        await apiPost("/api/v1/merchant/products", {
          branch_id: branchId,
          category_id: catId,
          name_ar: name.trim(),
          ...(desc.trim() ? { description_ar: desc.trim() } : {}),
          price_halalas: priceHalalas,
          ...(saleHalalas != null ? { sale_price_halalas: saleHalalas, sale_ends_at: saleEndsIso } : {}),
          ...(calories.trim() ? { calories: Number(calories) } : {}),
          ...(image ? { image_data_url: image } : {}),
          modifier_groups: buildGroupsPayload()
        });
      }
      resetForm();
      setFormOpen(false);
      loadMenu(branchId);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return onApiError(e);
      setFormError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const removeProduct = async (p: Product) => {
    if (!confirm(`حذف «${p.name_ar}» من المنيو؟`)) return;
    setPending(p.id);
    try {
      await apiDelete(`/api/v1/merchant/products/${p.id}`);
      loadMenu(branchId);
    } catch (e) {
      onApiError(e);
    } finally {
      setPending(null);
    }
  };

  // رفع/تغيير صورة صنف مباشرةً من الجدول (بلا فتح نموذج التعديل)
  const rowFileRef = useRef<HTMLInputElement>(null);
  const [imgUploadFor, setImgUploadFor] = useState<string | null>(null);
  const triggerRowImage = (productId: string) => {
    setImgUploadFor(productId);
    setError(null);
    rowFileRef.current?.click();
  };
  const onRowFileChosen = async (file: File | undefined) => {
    const productId = imgUploadFor;
    if (rowFileRef.current) rowFileRef.current.value = "";
    if (!file || !productId) return;
    setPending(productId);
    try {
      if (file.size > 12 * 1024 * 1024) throw new Error("الصورة أكبر من 12MB");
      const dataUrl = await resizeImage(file);
      await apiPatch(`/api/v1/merchant/products/${productId}`, { image_data_url: dataUrl });
      loadMenu(branchId);
    } catch (e) {
      onApiError(e);
    } finally {
      setPending(null);
      setImgUploadFor(null);
    }
  };

  const totalProducts = menu?.categories.reduce((n, c) => n + c.products.length, 0) ?? 0;

  return (
    <Shell
      title="المنيو والتوفر"
      crumb={menu ? `${menu.categories.length} تصنيف · ${totalProducts} منتجاً` : "القائمة الموحدة لكل فرع"}
    >
      <div className={s.filters}>
        <select
          value={branchId}
          onChange={(e) => setBranchId(e.target.value)}
          data-testid="menu-branch-select"
          aria-label="اختيار الفرع"
        >
          {branches.length === 0 && <option value="">— لا فروع —</option>}
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name_ar}
            </option>
          ))}
        </select>
        <button type="button" className={s.addBtn} data-testid="menu-add-toggle" disabled={!branchId} onClick={openAdd}>
          + إضافة صنف
        </button>
      </div>

      {/* ===== نموذج إضافة/تعديل صنف ===== */}
      {formOpen && (
        <div className={s.addForm} data-testid="menu-add-form">
          <h2 className={s.formTitle}>{editId ? "تعديل صنف" : "صنف جديد"}</h2>

          {/* الصورة */}
          <div className={s.imageRow}>
            <div className={s.imagePreview}>
              {image ? (
                // صورة data URL أو رابط — عرض مباشر
                // eslint-disable-next-line @next/next/no-img-element
                <img src={image} alt="معاينة الصنف" />
              ) : (
                <span className={s.imagePlaceholder}>لا صورة</span>
              )}
            </div>
            <div className={s.imageActions}>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                data-testid="product-image-input"
                onChange={(e) => pickImage(e.target.files?.[0])}
                style={{ display: "none" }}
              />
              <button type="button" className={s.smallBtn} onClick={() => fileRef.current?.click()}>
                {image ? "تغيير الصورة" : "رفع صورة"}
              </button>
              {image && (
                <button type="button" className={s.removeImgBtn} onClick={clearImage}>
                  حذف الصورة
                </button>
              )}
              <span className={s.imageHint}>تُصغَّر تلقائياً — JPG/PNG</span>
            </div>
          </div>

          <div className={s.formGrid}>
            {!editId && (
              <>
                <label className={s.field}>
                  <span>التصنيف</span>
                  <select value={categoryId} data-testid="add-category-select" onChange={(e) => setCategoryId(e.target.value)}>
                    <option value="">— تصنيف جديد —</option>
                    {menu?.categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name_ar}
                      </option>
                    ))}
                  </select>
                </label>
                {!categoryId && (
                  <label className={s.field}>
                    <span>اسم التصنيف الجديد</span>
                    <input value={newCategory} data-testid="add-new-category" placeholder="مثال: مشروبات" onChange={(e) => setNewCategory(e.target.value)} />
                  </label>
                )}
              </>
            )}

            <label className={s.field}>
              <span>اسم الصنف *</span>
              <input value={name} data-testid="add-product-name" placeholder="مثال: بيست برجر كلاسيك" onChange={(e) => setName(e.target.value)} />
            </label>
            <label className={s.field}>
              <span>السعر (ريال) *</span>
              <input value={price} data-testid="add-product-price" inputMode="decimal" placeholder="32.00" onChange={(e) => setPrice(e.target.value)} />
            </label>
            <label className={s.field}>
              <span>سعر العرض (اختياري)</span>
              <input
                value={salePrice}
                data-testid="add-product-sale-price"
                inputMode="decimal"
                placeholder="أقل من السعر — لتفعيل عرض"
                onChange={(e) => setSalePrice(e.target.value)}
              />
            </label>
            {salePrice.trim() && (
              <label className={s.field}>
                <span>نهاية العرض (اختياري)</span>
                <input
                  type="date"
                  value={saleEnds}
                  data-testid="add-product-sale-ends"
                  onChange={(e) => setSaleEnds(e.target.value)}
                />
              </label>
            )}
            <label className={s.field}>
              <span>السعرات (اختياري)</span>
              <input value={calories} data-testid="add-product-calories" inputMode="numeric" placeholder="620" onChange={(e) => setCalories(e.target.value)} />
            </label>
            <label className={`${s.field} ${s.fieldWide}`}>
              <span>الوصف (اختياري)</span>
              <input value={desc} data-testid="add-product-desc" placeholder="لحم واجيو مشوي على الفحم" onChange={(e) => setDesc(e.target.value)} />
            </label>
          </div>

          {/* مجموعات التخصيص */}
          <div className={s.groups}>
            <div className={s.groupsHead}>
              <span>مجموعات التخصيص (اختياري)</span>
              <button type="button" className={s.smallBtn} data-testid="add-group" onClick={() => setGroups((g) => [...g, emptyGroup()])}>
                + مجموعة
              </button>
            </div>
            {groups.map((g, gi) => (
              <div key={gi} className={s.group} data-testid="modifier-group">
                <div className={s.groupTop}>
                  <input
                    className={s.groupName}
                    value={g.name_ar}
                    placeholder="اسم المجموعة (مثال: الحجم)"
                    data-testid="group-name"
                    onChange={(e) => setGroups((arr) => arr.map((x, i) => (i === gi ? { ...x, name_ar: e.target.value } : x)))}
                  />
                  <label className={s.miniField}>
                    أدنى
                    <input type="number" min={0} value={g.min_select} onChange={(e) => setGroups((arr) => arr.map((x, i) => (i === gi ? { ...x, min_select: Number(e.target.value) } : x)))} />
                  </label>
                  <label className={s.miniField}>
                    أقصى
                    <input type="number" min={1} value={g.max_select} onChange={(e) => setGroups((arr) => arr.map((x, i) => (i === gi ? { ...x, max_select: Number(e.target.value) } : x)))} />
                  </label>
                  <button type="button" className={s.removeBtn} aria-label="حذف المجموعة" onClick={() => setGroups((arr) => arr.filter((_, i) => i !== gi))}>
                    ✕
                  </button>
                </div>
                {g.modifiers.map((m, mi) => (
                  <div key={mi} className={s.modRow}>
                    <input
                      className={s.modName}
                      value={m.name_ar}
                      placeholder="اسم الخيار (مثال: دبل)"
                      data-testid="modifier-name"
                      onChange={(e) =>
                        setGroups((arr) =>
                          arr.map((x, i) => (i === gi ? { ...x, modifiers: x.modifiers.map((y, j) => (j === mi ? { ...y, name_ar: e.target.value } : y)) } : x))
                        )
                      }
                    />
                    <input
                      className={s.modPrice}
                      value={m.price}
                      inputMode="decimal"
                      placeholder="+ريال"
                      onChange={(e) =>
                        setGroups((arr) =>
                          arr.map((x, i) => (i === gi ? { ...x, modifiers: x.modifiers.map((y, j) => (j === mi ? { ...y, price: e.target.value } : y)) } : x))
                        )
                      }
                    />
                    <button
                      type="button"
                      className={s.removeBtn}
                      aria-label="حذف الخيار"
                      onClick={() => setGroups((arr) => arr.map((x, i) => (i === gi ? { ...x, modifiers: x.modifiers.filter((_, j) => j !== mi) } : x)))}
                    >
                      ✕
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className={s.smallBtn}
                  data-testid="add-modifier"
                  onClick={() => setGroups((arr) => arr.map((x, i) => (i === gi ? { ...x, modifiers: [...x.modifiers, { name_ar: "", price: "" }] } : x)))}
                >
                  + خيار
                </button>
              </div>
            ))}
          </div>

          {formError && (
            <div className="note err" data-testid="add-form-error">
              {formError}
            </div>
          )}

          <div className={s.formActions}>
            <button type="button" className={s.saveBtn} data-testid="add-product-submit" disabled={saving} onClick={submit}>
              {saving ? "…جارٍ الحفظ" : editId ? "حفظ التعديلات" : "حفظ الصنف"}
            </button>
            <button type="button" className={s.cancelBtn} onClick={() => { resetForm(); setFormOpen(false); }}>
              إلغاء
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="note err" data-testid="menu-error">
          {error}
        </div>
      )}

      {!menu && !error && branchId && (
        <>
          <div className="skl" style={{ height: 42 }} />
          <div className="skl" style={{ height: 220 }} />
        </>
      )}

      {menu && menu.categories.length === 0 && !formOpen && (
        <div className="empty">
          <div className="ic">🍔</div>
          <b>لا قائمة منشورة لهذا الفرع</b>
          <p>ابدأ بإضافة صنف عبر زر «إضافة صنف» بالأعلى</p>
        </div>
      )}

      {menu &&
        menu.categories.map((cat) => (
          <div key={cat.id} data-testid="menu-category">
            <h2 className={s.catTitle}>{cat.name_ar}</h2>
            <div className="tblwrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>الصورة</th>
                    <th>المنتج</th>
                    <th>السعر (SAR)</th>
                    <th>الحالة</th>
                    <th>التوفر</th>
                    <th>إجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {cat.products.map((p) => (
                    <tr key={p.id} className={p.is_available ? undefined : s.offRow} data-testid="menu-product-row">
                      <td>
                        {/* خانة الصورة نفسها زر رفع — اضغط لإضافة/تغيير صورة الصنف مباشرة */}
                        <button
                          type="button"
                          className={s.thumb}
                          data-testid="row-image-upload"
                          disabled={pending === p.id}
                          title={p.image_url ? "تغيير الصورة" : "إضافة صورة"}
                          aria-label={`صورة ${p.name_ar}`}
                          onClick={() => triggerRowImage(p.id)}
                        >
                          {pending === p.id ? (
                            <span className={s.thumbEmpty}>…</span>
                          ) : p.image_url ? (
                            <>
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={p.image_url} alt={p.name_ar} />
                              <span className={s.thumbEdit}>تغيير</span>
                            </>
                          ) : (
                            <span className={s.thumbAdd}>+ صورة</span>
                          )}
                        </button>
                      </td>
                      <td>
                        <span className={s.prodName}>{p.name_ar}</span>
                        {p.description_ar && <span className={s.prodDesc}>{p.description_ar}</span>}
                      </td>
                      <td className="mono">
                        {p.sale_price_halalas != null ? (
                          <span className={s.priceCell}>
                            <span className={s.salePrice}>{sar(p.sale_price_halalas)}</span>
                            <span className={s.origPrice}>{sar(p.price_halalas)}</span>
                            <span className={`badge ${p.on_sale ? "b-lime" : "b-soft"} ${s.saleBadge}`}>
                              {p.on_sale ? "عرض" : "عرض منتهٍ"}
                            </span>
                          </span>
                        ) : (
                          sar(p.price_halalas)
                        )}
                      </td>
                      <td>
                        {p.is_active ? (
                          <span className="badge b-lime" style={{ fontSize: "10.5px" }}>منشور</span>
                        ) : (
                          <span className="badge b-soft" style={{ fontSize: "10.5px" }}>موقوف</span>
                        )}
                      </td>
                      <td>
                        <span className={s.availCell}>
                          <button
                            type="button"
                            className={`switch ${p.is_available ? "on" : ""}`}
                            data-testid="menu-toggle"
                            aria-pressed={p.is_available}
                            aria-label={`توفر ${p.name_ar}`}
                            disabled={pending === p.id}
                            onClick={() => toggle(p)}
                          />
                          <span className={s.availLabel}>{p.is_available ? "متوفر" : "نفد"}</span>
                        </span>
                      </td>
                      <td>
                        <div className={s.rowActions}>
                          <button type="button" className={s.editBtn} data-testid="edit-product" onClick={() => openEdit(cat, p)}>
                            تعديل
                          </button>
                          <button type="button" className={s.delBtn} data-testid="delete-product" disabled={pending === p.id} onClick={() => removeProduct(p)}>
                            حذف
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}

      {/* عنصر ملف مشترك لرفع صور الصفوف مباشرة */}
      <input
        ref={rowFileRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        data-testid="row-image-file"
        onChange={(e) => onRowFileChosen(e.target.files?.[0])}
      />
    </Shell>
  );
}
