"use client";

/**
 * M-08: المنيو والتوفر — اختيار فرع ثم جدول المنتجات بمفاتيح التوفر.
 * GET /api/v1/merchant/branches → GET /api/v1/merchant/menu?branch_id=
 * تبديل: POST /api/v1/merchant/availability {branch_id, product_id, is_available}
 * الشكل: design/merchant/M-08.html
 */
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Shell from "@/components/Shell";
import { ApiError, apiGet, apiPost, sar } from "@/lib/api";
import s from "./menu.module.css";

type Branch = { id: string; name_ar: string; branch_code: string; status: string };
type Product = { id: string; name_ar: string; price_halalas: number; is_active: boolean; is_available: boolean };
type Category = { id: string; name_ar: string; products: Product[] };
type Menu = { categories: Category[] };

export default function MenuPage() {
  const router = useRouter();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState<string>("");
  const [menu, setMenu] = useState<Menu | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  const onApiError = useCallback(
    (e: unknown) => {
      if (e instanceof ApiError && e.status === 401) {
        router.replace("/");
        return;
      }
      setError((e as Error).message);
    },
    [router]
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
    apiGet<Menu>(`/api/v1/merchant/menu?branch_id=${encodeURIComponent(branchId)}`)
      .then(setMenu)
      .catch(onApiError);
  }, [branchId, onApiError]);

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
      </div>

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

      {menu && menu.categories.length === 0 && (
        <div className="empty">
          <div className="ic">🍔</div>
          <b>لا قائمة منشورة لهذا الفرع</b>
          <p>تُدار القائمة عبر فريق نجاح التجار في نطاق الطيار</p>
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
