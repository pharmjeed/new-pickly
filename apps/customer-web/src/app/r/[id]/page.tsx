"use client";

/** P4 (مصغرة): المطعم الشامل — المنيو داخل الصفحة، الإضافة مباشرة للشريحة */
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api, fmtSar, getToken } from "@/lib/api";

interface Product {
  id: string;
  name_ar: string;
  description_ar: string | null;
  price_halalas: number;
  is_available: boolean;
  modifier_groups: Array<{
    id: string;
    name_ar: string;
    min_select: number;
    max_select: number;
    modifiers: Array<{ id: string; name_ar: string; price_halalas: number }>;
  }>;
}
interface Menu {
  branch_id: string;
  categories: Array<{ id: string; name_ar: string; products: Product[] }>;
}

export default function RestaurantPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [menu, setMenu] = useState<Menu | null>(null);
  const [cartId, setCartId] = useState<string | null>(null);
  const [count, setCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Menu>("GET", `/v1/branches/${id}/menu`).then(setMenu).catch((e: Error) => setError(e.message));
  }, [id]);

  const ensureCart = async (): Promise<string> => {
    if (cartId) return cartId;
    if (!getToken()) {
      router.push(`/auth?next=/r/${id}`);
      throw new Error("سجّل دخولك أولاً");
    }
    const cart = await api<{ id: string }>("POST", "/v1/carts", { branch_id: id });
    setCartId(cart.id);
    sessionStorage.setItem("pk_cart", cart.id);
    return cart.id;
  };

  const add = async (p: Product) => {
    setError(null);
    try {
      const cid = await ensureCart();
      // الشريحة: أول مُعدِّل من كل مجموعة إلزامية (min_select ≥ 1)
      const modifier_ids = p.modifier_groups
        .filter((g) => g.min_select >= 1)
        .map((g) => g.modifiers[0]?.id)
        .filter((v): v is string => Boolean(v));
      await api("POST", `/v1/carts/${cid}/items`, { product_id: p.id, quantity: 1, modifier_ids });
      setCount((c) => c + 1);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <main className="pk-wrap" style={{ paddingBottom: 90 }}>
      {error && <div className="pk-card" style={{ color: "var(--pk-error)" }}>{error}</div>}
      {!menu && <div className="pk-loader"><span /><span /><span /></div>}

      {menu?.categories.map((c) => (
        <section key={c.id}>
          <h2 className="pk-display" style={{ fontSize: "var(--pk-fs-20)", margin: "16px 0 8px" }}>{c.name_ar}</h2>
          {c.products.map((p) => (
            <div key={p.id} className="pk-card" data-testid="product-card" style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
              <div>
                <strong style={{ fontSize: "var(--pk-fs-16)", fontWeight: 500 }}>{p.name_ar}</strong>
                {p.description_ar && <p className="pk-muted">{p.description_ar}</p>}
                <p className="pk-mono" style={{ fontSize: "var(--pk-fs-14)" }}>{fmtSar(p.price_halalas)}</p>
              </div>
              <button
                className="pk-btn"
                data-testid="add-product"
                style={{ width: 44, minHeight: 44, flexShrink: 0, fontSize: 22 }}
                disabled={!p.is_available}
                onClick={() => add(p)}
                aria-label={`أضف ${p.name_ar}`}
              >
                +
              </button>
            </div>
          ))}
        </section>
      ))}

      {count > 0 && (
        <div style={{ position: "fixed", bottom: 16, right: 16, left: 16, maxWidth: 448, margin: "0 auto" }}>
          <button className="pk-btn" data-testid="go-cart" onClick={() => router.push("/cart")}>
            السلة ({count}) — راجع واطلب
          </button>
        </div>
      )}
    </main>
  );
}
