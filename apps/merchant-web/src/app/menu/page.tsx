"use client";

/**
 * M-08: المنيو والتوفر — اختيار فرع، جدول المنتجات بمفاتيح التوفر،
 * وإضافة صنف جديد بكل تفاصيله (تصنيف + سعر + سعرات + مجموعات مُعدِّلات) — docs/11§6 CRUD.
 * GET /merchant/branches → GET /merchant/menu?branch_id=
 * POST /merchant/categories · POST /merchant/products · POST /merchant/availability
 * الشكل: design/merchant/M-08.html
 */
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Shell from "@/components/Shell";
import { clearToken, ApiError, apiGet, apiPost, sar } from "@/lib/api";
import s from "./menu.module.css";

type Branch = { id: string; name_ar: string; branch_code: string; status: string };
type Product = { id: string; name_ar: string; price_halalas: number; is_active: boolean; is_available: boolean };
type Category = { id: string; name_ar: string; products: Product[] };
type Menu = { categories: Category[] };

/** مجموعة مُعدِّلات في نموذج الإضافة */
interface GroupDraft {
  name_ar: string;
  min_select: number;
  max_select: number;
  modifiers: { name_ar: string; price: string }[];
}

const emptyGroup = (): GroupDraft => ({
  name_ar: "",
  min_select: 0,
  max_select: 1,
  modifiers: [{ name_ar: "", price: "" }]
});

export default function MenuPage() {
  const router = useRouter();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState<string>("");
  const [menu, setMenu] = useState<Menu | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  // نموذج إضافة صنف
  const [showAdd, setShowAdd] = useState(false);
  const [savingProduct, setSavingProduct] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState<string>("");
  const [newCategory, setNewCategory] = useState("");
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [price, setPrice] = useState("");
  const [calories, setCalories] = useState("");
  const [groups, setGroups] = useState<GroupDraft[]>([]);

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
      await apiPost("/api/v1/merchant/availability", {
        branch_id: branchId,
        product_id: product.id,
        is_available: next
      });
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
    setName("");
    setDesc("");
    setPrice("");
    setCalories("");
    setGroups([]);
    setNewCategory("");
    setFormError(null);
  };

  const submitProduct = async () => {
    setFormError(null);
    const priceNum = Number(price);
    if (name.trim().length < 2) return setFormError("اسم الصنف مطلوب");
    if (!Number.isFinite(priceNum) || priceNum <= 0) return setFormError("أدخل سعراً صحيحاً بالريال");
    if (!categoryId && newCategory.trim().length < 2) return setFormError("اختر تصنيفاً أو أنشئ واحداً");

    // تحقق مجموعات المُعدِّلات
    for (const g of groups) {
      if (g.name_ar.trim().length < 1) return setFormError("اسم كل مجموعة مُعدِّلات مطلوب");
      const mods = g.modifiers.filter((m) => m.name_ar.trim());
      if (mods.length === 0) return setFormError(`أضف خياراً واحداً على الأقل لمجموعة «${g.name_ar}»`);
      if (g.max_select < g.min_select) return setFormError(`في «${g.name_ar}» الحد الأقصى أصغر من الأدنى`);
    }

    setSavingProduct(true);
    try {
      // أنشئ التصنيف الجديد أولاً إن لزم
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
        price_halalas: Math.round(priceNum * 100),
        ...(calories.trim() ? { calories: Number(calories) } : {}),
        modifier_groups: groups.map((g) => ({
          name_ar: g.name_ar.trim(),
          min_select: g.min_select,
          max_select: g.max_select,
          modifiers: g.modifiers
            .filter((m) => m.name_ar.trim())
            .map((m) => ({
              name_ar: m.name_ar.trim(),
              price_halalas: m.price.trim() ? Math.round(Number(m.price) * 100) : 0
            }))
        }))
      });

      resetForm();
      setShowAdd(false);
      loadMenu(branchId); // أعد التحميل ليظهر الصنف الجديد
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return onApiError(e);
      setFormError((e as Error).message);
    } finally {
      setSavingProduct(false);
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
        <button
          type="button"
          className={s.addBtn}
          data-testid="menu-add-toggle"
          disabled={!branchId}
          onClick={() => {
            setShowAdd((v) => !v);
            setFormError(null);
          }}
        >
          {showAdd ? "إغلاق" : "+ إضافة صنف"}
        </button>
      </div>

      {/* ===== نموذج إضافة صنف بكل تفاصيله ===== */}
      {showAdd && (
        <div className={s.addForm} data-testid="menu-add-form">
          <h2 className={s.formTitle}>صنف جديد</h2>

          <div className={s.formGrid}>
            <label className={s.field}>
              <span>التصنيف</span>
              <select
                value={categoryId}
                data-testid="add-category-select"
                onChange={(e) => setCategoryId(e.target.value)}
              >
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
                <input
                  value={newCategory}
                  data-testid="add-new-category"
                  placeholder="مثال: مشروبات"
                  onChange={(e) => setNewCategory(e.target.value)}
                />
              </label>
            )}

            <label className={s.field}>
              <span>اسم الصنف *</span>
              <input
                value={name}
                data-testid="add-product-name"
                placeholder="مثال: بيست برجر كلاسيك"
                onChange={(e) => setName(e.target.value)}
              />
            </label>

            <label className={s.field}>
              <span>السعر (ريال) *</span>
              <input
                value={price}
                data-testid="add-product-price"
                inputMode="decimal"
                placeholder="32.00"
                onChange={(e) => setPrice(e.target.value)}
              />
            </label>

            <label className={s.field}>
              <span>السعرات (اختياري)</span>
              <input
                value={calories}
                data-testid="add-product-calories"
                inputMode="numeric"
                placeholder="620"
                onChange={(e) => setCalories(e.target.value)}
              />
            </label>

            <label className={`${s.field} ${s.fieldWide}`}>
              <span>الوصف (اختياري)</span>
              <input
                value={desc}
                data-testid="add-product-desc"
                placeholder="لحم واجيو مشوي على الفحم مع صوصنا الخاص"
                onChange={(e) => setDesc(e.target.value)}
              />
            </label>
          </div>

          {/* مجموعات المُعدِّلات */}
          <div className={s.groups}>
            <div className={s.groupsHead}>
              <span>مجموعات التخصيص (اختياري)</span>
              <button
                type="button"
                className={s.smallBtn}
                data-testid="add-group"
                onClick={() => setGroups((g) => [...g, emptyGroup()])}
              >
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
                    onChange={(e) =>
                      setGroups((arr) => arr.map((x, i) => (i === gi ? { ...x, name_ar: e.target.value } : x)))
                    }
                  />
                  <label className={s.miniField}>
                    أدنى
                    <input
                      type="number"
                      min={0}
                      value={g.min_select}
                      onChange={(e) =>
                        setGroups((arr) =>
                          arr.map((x, i) => (i === gi ? { ...x, min_select: Number(e.target.value) } : x))
                        )
                      }
                    />
                  </label>
                  <label className={s.miniField}>
                    أقصى
                    <input
                      type="number"
                      min={1}
                      value={g.max_select}
                      onChange={(e) =>
                        setGroups((arr) =>
                          arr.map((x, i) => (i === gi ? { ...x, max_select: Number(e.target.value) } : x))
                        )
                      }
                    />
                  </label>
                  <button
                    type="button"
                    className={s.removeBtn}
                    aria-label="حذف المجموعة"
                    onClick={() => setGroups((arr) => arr.filter((_, i) => i !== gi))}
                  >
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
                          arr.map((x, i) =>
                            i === gi
                              ? { ...x, modifiers: x.modifiers.map((y, j) => (j === mi ? { ...y, name_ar: e.target.value } : y)) }
                              : x
                          )
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
                          arr.map((x, i) =>
                            i === gi
                              ? { ...x, modifiers: x.modifiers.map((y, j) => (j === mi ? { ...y, price: e.target.value } : y)) }
                              : x
                          )
                        )
                      }
                    />
                    <button
                      type="button"
                      className={s.removeBtn}
                      aria-label="حذف الخيار"
                      onClick={() =>
                        setGroups((arr) =>
                          arr.map((x, i) =>
                            i === gi ? { ...x, modifiers: x.modifiers.filter((_, j) => j !== mi) } : x
                          )
                        )
                      }
                    >
                      ✕
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className={s.smallBtn}
                  data-testid="add-modifier"
                  onClick={() =>
                    setGroups((arr) =>
                      arr.map((x, i) => (i === gi ? { ...x, modifiers: [...x.modifiers, { name_ar: "", price: "" }] } : x))
                    )
                  }
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
            <button
              type="button"
              className={s.saveBtn}
              data-testid="add-product-submit"
              disabled={savingProduct}
              onClick={submitProduct}
            >
              {savingProduct ? "…جارٍ الحفظ" : "حفظ الصنف"}
            </button>
            <button type="button" className={s.cancelBtn} onClick={() => setShowAdd(false)}>
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

      {menu && menu.categories.length === 0 && !showAdd && (
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
                    <th>المنتج</th>
                    <th>السعر (SAR)</th>
                    <th>الحالة</th>
                    <th>التوفر في الفرع</th>
                  </tr>
                </thead>
                <tbody>
                  {cat.products.map((p) => (
                    <tr key={p.id} className={p.is_available ? undefined : s.offRow} data-testid="menu-product-row">
                      <td>
                        <span className={s.prodName}>{p.name_ar}</span>
                      </td>
                      <td className="mono">{sar(p.price_halalas)}</td>
                      <td>
                        {p.is_active ? (
                          <span className="badge b-lime" style={{ fontSize: "10.5px" }}>
                            منشور
                          </span>
                        ) : (
                          <span className="badge b-soft" style={{ fontSize: "10.5px" }}>
                            موقوف
                          </span>
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
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
    </Shell>
  );
}
