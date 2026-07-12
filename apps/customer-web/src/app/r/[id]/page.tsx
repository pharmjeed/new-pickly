"use client";

/**
 * P4: المطعم الشامل — المنيو داخل الصفحة (C-19 → C-25)
 * غلاف المطعم + بطاقة الفرع + شرائح التصنيفات + بطاقات المنتجات (C-23)
 * + ورقة التخصيص السفلية (C-25): مجموعات المُعدِّلات ضمن min/max + الكمية + ملاحظة المطبخ.
 * منتج بلا مُعدِّلات يُضاف مباشرة؛ منتج بمجموعات يفتح الورقة بخيار أول محدد مسبقاً.
 */
import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api, fmtSar, getToken } from "@/lib/api";
import styles from "./restaurant.module.css";

interface Modifier {
  id: string;
  name_ar: string;
  price_halalas: number;
}
interface ModifierGroup {
  id: string;
  name_ar: string;
  min_select: number;
  max_select: number;
  modifiers: Modifier[];
}
interface Product {
  id: string;
  name_ar: string;
  description_ar: string | null;
  price_halalas: number;
  image_url?: string | null;
  is_available: boolean;
  calories?: number | null;
  modifier_groups: ModifierGroup[];
}
interface Menu {
  branch_id: string;
  categories: Array<{ id: string; name_ar: string; products: Product[] }>;
}
interface BranchCard {
  id: string;
  brand_name_ar: string;
  status: string;
  busy_message: string | null;
  distance_meters: number | null;
  eta_minutes: number | null;
  min_order_halalas: number | null;
  address_short: string;
}

/** حالة ورقة التخصيص المفتوحة */
interface SheetState {
  product: Product;
  qty: number;
  /** group_id → المُعدِّلات المختارة */
  sel: Record<string, string[]>;
  note: string;
}

const RIYADH = { lat: 24.7, lng: 46.68 };

/** الاختيار الافتراضي: أول min_select خيار من كل مجموعة إلزامية */
function defaultSelection(p: Product): Record<string, string[]> {
  const sel: Record<string, string[]> = {};
  for (const g of p.modifier_groups) {
    sel[g.id] = g.min_select >= 1 ? g.modifiers.slice(0, g.min_select).map((m) => m.id) : [];
  }
  return sel;
}

export default function RestaurantPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [menu, setMenu] = useState<Menu | null>(null);
  const [branch, setBranch] = useState<BranchCard | null>(null);
  const [cartId, setCartId] = useState<string | null>(null);
  const [count, setCount] = useState(0);
  const [totalHalalas, setTotalHalalas] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [activeCat, setActiveCat] = useState<string | null>(null);
  const [sheet, setSheet] = useState<SheetState | null>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    api<Menu>("GET", `/v1/branches/${id}/menu`).then(setMenu).catch((e: Error) => setError(e.message));
  }, [id]);

  // بيانات الفرع للرأس (الاسم/الحالة/المسافة) — تحسين عرض؛ فشلها لا يعطل الصفحة
  useEffect(() => {
    const find = (lat: number, lng: number) =>
      api<BranchCard[]>("GET", `/v1/branches/nearby?lat=${lat}&lng=${lng}&radius=30000`)
        .then((list) => setBranch(list.find((b) => b.id === id) ?? null))
        .catch(() => undefined);
    if (typeof navigator !== "undefined" && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => void find(pos.coords.latitude, pos.coords.longitude),
        () => void find(RIYADH.lat, RIYADH.lng),
        { timeout: 3000 }
      );
    } else {
      void find(RIYADH.lat, RIYADH.lng);
    }
  }, [id]);

  // قفل تمرير الخلفية عند فتح الورقة
  useEffect(() => {
    if (!sheet) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [sheet]);

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

  const postItem = async (p: Product, quantity: number, modifier_ids: string[], note?: string) => {
    setError(null);
    setAdding(true);
    try {
      const cid = await ensureCart();
      await api("POST", `/v1/carts/${cid}/items`, {
        product_id: p.id,
        quantity,
        modifier_ids,
        ...(note?.trim() ? { notes: note.trim() } : {})
      });
      const modTotal = p.modifier_groups
        .flatMap((g) => g.modifiers)
        .filter((m) => modifier_ids.includes(m.id))
        .reduce((s, m) => s + m.price_halalas, 0);
      setCount((c) => c + quantity);
      setTotalHalalas((t) => t + (p.price_halalas + modTotal) * quantity);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setAdding(false);
    }
  };

  /** منتج بلا مُعدِّلات — إضافة مباشرة */
  const addDirect = (p: Product) => void postItem(p, 1, []);

  /** منتج بمجموعات — افتح ورقة التخصيص بخيار أول محدد مسبقاً */
  const openSheet = (p: Product) =>
    setSheet({ product: p, qty: 1, sel: defaultSelection(p), note: "" });

  const toggleModifier = (g: ModifierGroup, modId: string) => {
    setSheet((s) => {
      if (!s) return s;
      const cur = s.sel[g.id] ?? [];
      let next: string[];
      if (g.max_select === 1) {
        // سلوك radio — المجموعة الإلزامية لا تُفرَّغ، والاختيارية تقبل الإلغاء
        next = cur.includes(modId) ? (g.min_select >= 1 ? cur : []) : [modId];
      } else if (cur.includes(modId)) {
        next = cur.filter((x) => x !== modId);
      } else if (cur.length < g.max_select) {
        next = [...cur, modId];
      } else {
        return s; // بلغ الحد الأقصى
      }
      return { ...s, sel: { ...s.sel, [g.id]: next } };
    });
  };

  const sheetModifierIds = useMemo(
    () => (sheet ? Object.values(sheet.sel).flat() : []),
    [sheet]
  );
  const sheetUnitPrice = useMemo(() => {
    if (!sheet) return 0;
    const mods = sheet.product.modifier_groups
      .flatMap((g) => g.modifiers)
      .filter((m) => sheetModifierIds.includes(m.id))
      .reduce((s, m) => s + m.price_halalas, 0);
    return sheet.product.price_halalas + mods;
  }, [sheet, sheetModifierIds]);
  const incompleteGroups = useMemo(
    () =>
      sheet
        ? sheet.product.modifier_groups.filter(
            (g) => (sheet.sel[g.id] ?? []).length < g.min_select
          )
        : [],
    [sheet]
  );

  const confirmSheet = async () => {
    if (!sheet || incompleteGroups.length > 0) return;
    const ok = await postItem(sheet.product, sheet.qty, sheetModifierIds, sheet.note);
    if (ok) setSheet(null);
  };

  const scrollToCat = (catId: string) => {
    setActiveCat(catId);
    document.getElementById(`cat-${catId}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const statusBadge =
    branch &&
    (branch.status === "open" ? (
      <span className={styles.badgeLime}>مفتوح</span>
    ) : branch.status === "busy" ? (
      <span className={styles.badgeWarn}>ازدحام</span>
    ) : (
      <span className={styles.badgeSoft}>مغلق</span>
    ));

  return (
    <main className={styles.page}>
      {/* ===== الغلاف (C-19) ===== */}
      <div className={styles.cover}>
        <span>cover 390×180</span>
        <button className={styles.backBtn} onClick={() => router.push("/")} aria-label="رجوع">
          ‹
        </button>
        {branch?.status === "busy" && branch.busy_message && (
          <span className={`${styles.badgeWarn} ${styles.busyBadge}`}>{branch.busy_message}</span>
        )}
        {branch?.status === "closed" && (
          <span className={styles.closedOverlay}>
            <span className={styles.badgeSoft} style={{ fontSize: "var(--pk-fs-14)", padding: "8px 18px" }}>
              مغلق الآن
            </span>
          </span>
        )}
      </div>

      {/* ===== رأس المطعم ===== */}
      <div className={styles.head}>
        <div className={styles.brandRow}>
          <div className={styles.logo}>logo</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h1 className={styles.brandName}>{branch?.brand_name_ar ?? "قائمة المطعم"}</h1>
            {branch && <div className={styles.brandSub}>{branch.address_short}</div>}
          </div>
        </div>

        {branch && (
          <div className={styles.branchCard}>
            <div className={styles.branchTop}>
              <div>
                <span className={styles.branchName}>{branch.brand_name_ar}</span> {statusBadge}
                <div className={styles.branchMeta}>
                  {branch.distance_meters !== null && <>{(branch.distance_meters / 1000).toFixed(1)} كم · </>}
                  {branch.eta_minutes !== null && <>قيادة {branch.eta_minutes} د</>}
                </div>
              </div>
            </div>
            <hr className={styles.branchHr} />
            <div className={styles.branchFacts}>
              {branch.min_order_halalas !== null && branch.min_order_halalas > 0 && (
                <>
                  <span>حد أدنى {fmtSar(branch.min_order_halalas)}</span>
                  <span>·</span>
                </>
              )}
              <span>{branch.address_short}</span>
            </div>
          </div>
        )}

        <div className={styles.carLine}>يصل طلبك إلى سيارتك — خلّك في سيارتك، الباقي علينا</div>
      </div>

      {error && <div className={styles.errorCard}>{error}</div>}

      {!menu && !error && (
        <div className={styles.loaderWrap}>
          <div className="pk-loader" aria-label="جارٍ التحميل">
            <span />
            <span />
            <span />
          </div>
        </div>
      )}

      {/* ===== شرائح التصنيفات اللاصقة ===== */}
      {menu && (
        <div className={styles.chipsBar}>
          <div className={styles.chips}>
            {menu.categories.map((c) => (
              <button
                key={c.id}
                className={`${styles.chip} ${(activeCat ?? menu.categories[0]?.id) === c.id ? styles.chipOn : ""}`}
                onClick={() => scrollToCat(c.id)}
              >
                {c.name_ar}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ===== المنيو داخل الصفحة (C-22/C-23) ===== */}
      {menu && (
        <div className={styles.menuList}>
          {menu.categories.map((c) => (
            <section key={c.id} id={`cat-${c.id}`} className={styles.catSection}>
              <h2 className={styles.catTitle}>{c.name_ar}</h2>
              {c.products.map((p) => {
                const customizable = p.modifier_groups.length > 0;
                return (
                  <div
                    key={p.id}
                    className={`${styles.pcard} ${!p.is_available ? styles.pcardNa : ""}`}
                    data-testid="product-card"
                  >
                    <div className={styles.pbody}>
                      <div className={styles.ptitle}>
                        {p.name_ar}
                        {customizable && (
                          <span className={`${styles.badgeLime} ${styles.badgeSm}`}>قابل للتخصيص</span>
                        )}
                      </div>
                      {p.description_ar && <p className={styles.pdesc}>{p.description_ar}</p>}
                      <span className={styles.price}>
                        {customizable && <span className={styles.priceFrom}>يبدأ من </span>}
                        {fmtSar(p.price_halalas)}
                      </span>
                    </div>
                    <div className={styles.pmedia}>
                      <div className={styles.pimg}>
                        {p.image_url ? <img src={p.image_url} alt={p.name_ar} /> : "product"}
                      </div>
                      {p.is_available ? (
                        customizable ? (
                          <button
                            className={styles.addBtn}
                            data-testid="customize-product"
                            onClick={() => openSheet(p)}
                            aria-label={`خصّص ${p.name_ar}`}
                          >
                            +
                          </button>
                        ) : (
                          <button
                            className={styles.addBtn}
                            data-testid="add-product"
                            disabled={adding}
                            onClick={() => addDirect(p)}
                            aria-label={`أضف ${p.name_ar}`}
                          >
                            +
                          </button>
                        )
                      ) : (
                        <span className={`${styles.badgeSoft} ${styles.naBadge}`}>غير متوفر</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </section>
          ))}
        </div>
      )}

      {/* ===== شريط السلة العائم ===== */}
      {count > 0 && (
        <div className={styles.cartBar}>
          <button className={styles.cartBtn} data-testid="go-cart" onClick={() => router.push("/cart")}>
            <span>عرض السلة · {count}</span>
            <span className={styles.cartTotal}>{fmtSar(totalHalalas)}</span>
          </button>
        </div>
      )}

      {/* ===== ورقة التخصيص (C-25) ===== */}
      {sheet && (
        <div
          className={styles.dim}
          onClick={(e) => {
            if (e.target === e.currentTarget) setSheet(null);
          }}
        >
          <div className={styles.sheet} role="dialog" aria-modal="true" aria-label={`تخصيص ${sheet.product.name_ar}`}>
            <div className={styles.grab} />
            <div className={styles.sheetHead}>
              <h2 className={styles.sheetTitle}>{sheet.product.name_ar}</h2>
              <button className={styles.sheetClose} onClick={() => setSheet(null)} aria-label="إغلاق">
                ✕
              </button>
            </div>
            <span className={styles.sheetPrice}>{fmtSar(sheet.product.price_halalas)}</span>

            {sheet.product.modifier_groups.map((g) => {
              const selected = sheet.sel[g.id] ?? [];
              const mandatory = g.min_select >= 1;
              const complete = selected.length >= g.min_select;
              return (
                <div key={g.id}>
                  <div className={styles.groupHead}>
                    <span className={styles.groupName}>{g.name_ar}</span>
                    {mandatory ? (
                      complete ? (
                        <span className={styles.badgeOk}>تم ✓</span>
                      ) : (
                        <span className={styles.badgeErr}>
                          إجباري — اختر {g.min_select === 1 ? "واحداً" : g.min_select}
                        </span>
                      )
                    ) : (
                      <span className={styles.groupHint}>اختياري · حتى {g.max_select}</span>
                    )}
                  </div>
                  <div className={styles.optCard}>
                    {g.modifiers.map((m) => {
                      const on = selected.includes(m.id);
                      const radio = g.max_select === 1;
                      return (
                        <button
                          key={m.id}
                          type="button"
                          className={styles.optRow}
                          onClick={() => toggleModifier(g, m.id)}
                          aria-pressed={on}
                        >
                          <span
                            className={
                              radio
                                ? `${styles.radio} ${on ? styles.radioOn : ""}`
                                : `${styles.chk} ${on ? styles.chkOn : ""}`
                            }
                          />
                          <span className={styles.optT}>{m.name_ar}</span>
                          <span className={styles.optP}>+{(m.price_halalas / 100).toFixed(2)}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            <div className={styles.noteFld}>
              <label htmlFor="kitchen-note">ملاحظة للمطبخ (اختياري)</label>
              <input
                id="kitchen-note"
                placeholder="مثال: الصوص على جنب"
                maxLength={280}
                value={sheet.note}
                onChange={(e) => setSheet((s) => (s ? { ...s, note: e.target.value } : s))}
              />
            </div>

            <div className={styles.sheetFoot}>
              <span className={styles.qty}>
                <button
                  onClick={() => setSheet((s) => (s ? { ...s, qty: Math.min(50, s.qty + 1) } : s))}
                  aria-label="زيادة الكمية"
                >
                  +
                </button>
                <span>{sheet.qty}</span>
                <button
                  onClick={() => setSheet((s) => (s ? { ...s, qty: Math.max(1, s.qty - 1) } : s))}
                  aria-label="إنقاص الكمية"
                >
                  −
                </button>
              </span>
              <button
                className={styles.confirmBtn}
                data-testid="add-product"
                disabled={adding || incompleteGroups.length > 0}
                onClick={() => void confirmSheet()}
              >
                <span>أضف للسلة · {sheet.qty}</span>
                <span className={styles.confirmTotal}>{fmtSar(sheetUnitPrice * sheet.qty)}</span>
              </button>
            </div>
            {incompleteGroups.length > 0 && (
              <p className={styles.mandatoryHint}>
                أكمل الخيارات الإجبارية أولاً — {incompleteGroups.map((g) => g.name_ar).join("، ")}
              </p>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
