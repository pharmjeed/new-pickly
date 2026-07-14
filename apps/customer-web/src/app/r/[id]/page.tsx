"use client";

/**
 * P4: المطعم الشامل — المنيو داخل الصفحة (C-19 → C-25)
 * غلاف المطعم + بطاقة الفرع + شرائح التصنيفات + بطاقات المنتجات (C-23)
 * + ورقة التخصيص السفلية (C-25): مجموعات المُعدِّلات ضمن min/max + الكمية + إضافات العميل.
 * الضغط على البطاقة يفتح الورقة دائماً؛ بلا مُعدِّلات تظهر الإضافات والكمية فقط.
 */
import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api, fmtSar, getToken } from "@/lib/api";
import { QirtasLoader } from "../../qirtas";
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
  sale_price_halalas?: number | null;
  sale_ends_at?: string | null;
  image_url?: string | null;
  is_available: boolean;
  calories?: number | null;
  modifier_groups: ModifierGroup[];
}

/** السعر المعروض: سعر العرض إن وُجد (M-11) وإلا الأصلي */
const shownPrice = (p: Product): number =>
  p.sale_price_halalas != null ? p.sale_price_halalas : p.price_halalas;
interface Menu {
  branch_id: string;
  categories: Array<{ id: string; name_ar: string; products: Product[] }>;
}
interface BranchCard {
  id: string;
  brand_id: string;
  brand_name_ar: string;
  logo_url: string | null;
  cover_url: string | null;
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
  const [isFav, setIsFav] = useState(false);

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

  // حالة القلب (C-18) — للمسجلين فقط؛ فشلها لا يعطل الصفحة
  useEffect(() => {
    if (!branch || !getToken()) return;
    api<Array<{ brand_id: string }>>("GET", "/v1/customers/me/favorites")
      .then((favs) => setIsFav(favs.some((f) => f.brand_id === branch.brand_id)))
      .catch(() => undefined);
  }, [branch]);

  const toggleFav = () => {
    if (!branch) return;
    if (!getToken()) {
      router.push(`/auth?next=/r/${id}`);
      return;
    }
    const next = !isFav;
    setIsFav(next); // تفاؤلي — الفشل يرجع الحالة
    api(next ? "PUT" : "DELETE", `/v1/customers/me/favorites/${branch.brand_id}`).catch(() => setIsFav(!next));
  };

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
      setTotalHalalas((t) => t + (shownPrice(p) + modTotal) * quantity);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setAdding(false);
    }
  };

  /** الضغط على البطاقة أو + يفتح الورقة دائماً — خيارات إن وُجدت، وإلا إضافات العميل + الكمية */
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
    return shownPrice(sheet.product) + mods;
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
        {branch?.cover_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={branch.cover_url} alt="" className={styles.coverImg} />
        ) : (
          <span>{branch?.brand_name_ar ?? ""}</span>
        )}
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
          <div className={styles.logo}>
            {branch?.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={branch.logo_url} alt="" className={styles.logoImg} />
            ) : (
              <span className={styles.logoLetter}>{branch?.brand_name_ar?.charAt(0) ?? "م"}</span>
            )}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h1 className={styles.brandName}>{branch?.brand_name_ar ?? "قائمة المطعم"}</h1>
            {branch && <div className={styles.brandSub}>{branch.address_short}</div>}
          </div>
          {branch && (
            <button
              type="button"
              className={isFav ? `${styles.heartBtn} ${styles.heartOn}` : styles.heartBtn}
              onClick={toggleFav}
              aria-pressed={isFav}
              aria-label={isFav ? "إزالة من المفضلة" : "إضافة للمفضلة"}
              data-testid="fav-toggle"
            >
              <svg width="19" height="19" viewBox="0 0 100 100" fill={isFav ? "currentColor" : "none"} stroke="currentColor" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M50,80 C20,60 14,40 26,28 C36,18 50,26 50,36 C50,26 64,18 74,28 C86,40 80,60 50,80 Z" />
              </svg>
            </button>
          )}
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
          <QirtasLoader />
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
                    role={p.is_available ? "button" : undefined}
                    tabIndex={p.is_available ? 0 : undefined}
                    onClick={() => p.is_available && openSheet(p)}
                    onKeyDown={(e) => {
                      if (p.is_available && (e.key === "Enter" || e.key === " ")) {
                        e.preventDefault();
                        openSheet(p);
                      }
                    }}
                  >
                    <div className={styles.pbody}>
                      <div className={styles.ptitle}>
                        {p.name_ar}
                        {customizable && (
                          <span className={`${styles.badgeLime} ${styles.badgeSm}`}>قابل للتخصيص</span>
                        )}
                      </div>
                      {p.description_ar && <p className={styles.pdesc}>{p.description_ar}</p>}
                      {p.sale_price_halalas != null ? (
                        <span className={styles.price}>
                          {customizable && <span className={styles.priceFrom}>يبدأ من </span>}
                          <span className={styles.salePrice}>{fmtSar(p.sale_price_halalas)}</span>
                          <span className={styles.origPrice}>{fmtSar(p.price_halalas)}</span>
                          <span className={`${styles.badgeLime} ${styles.badgeSm}`}>عرض</span>
                        </span>
                      ) : (
                        <span className={styles.price}>
                          {customizable && <span className={styles.priceFrom}>يبدأ من </span>}
                          {fmtSar(p.price_halalas)}
                        </span>
                      )}
                    </div>
                    <div className={styles.pmedia}>
                      <div className={styles.pimg}>
                        {p.image_url ? <img src={p.image_url} alt={p.name_ar} /> : "product"}
                      </div>
                      {p.is_available ? (
                        <button
                          className={styles.addBtn}
                          data-testid="customize-product"
                          onClick={(e) => {
                            e.stopPropagation();
                            openSheet(p);
                          }}
                          aria-label={customizable ? `خصّص ${p.name_ar}` : `أضف ${p.name_ar}`}
                        >
                          +
                        </button>
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
          <button className={styles.cartBtn} data-testid="go-cart" onClick={() => router.push("/checkout")}>
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
            {sheet.product.image_url && (
              <div className={styles.sheetImg}>
                <img src={sheet.product.image_url} alt={sheet.product.name_ar} />
              </div>
            )}
            <div className={styles.sheetHead}>
              <h2 className={styles.sheetTitle}>{sheet.product.name_ar}</h2>
              <button className={styles.sheetClose} onClick={() => setSheet(null)} aria-label="إغلاق">
                ✕
              </button>
            </div>
            {sheet.product.sale_price_halalas != null ? (
              <span className={styles.sheetPrice}>
                <span className={styles.salePrice}>{fmtSar(sheet.product.sale_price_halalas)}</span>
                <span className={styles.origPrice}>{fmtSar(sheet.product.price_halalas)}</span>
                <span className={`${styles.badgeLime} ${styles.badgeSm}`}>عرض</span>
              </span>
            ) : (
              <span className={styles.sheetPrice}>{fmtSar(sheet.product.price_halalas)}</span>
            )}
            {sheet.product.description_ar && (
              <p className={styles.pdesc}>{sheet.product.description_ar}</p>
            )}

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
              <label htmlFor="kitchen-note">إضافاتك على الصنف (اختياري)</label>
              <input
                id="kitchen-note"
                data-testid="item-note"
                placeholder="مثال: بدون بصل، الصوص على جنب"
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
