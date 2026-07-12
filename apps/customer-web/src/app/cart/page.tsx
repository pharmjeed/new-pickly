"use client";

/**
 * P5 (C-26): السلة + التسعير الخادمي — السعر النهائي من الخادم حصراً (BR-6)
 * حذف عنصر → إبطال التسعيرة وإعادة التسعير فوراً.
 * الكوبون مؤجل في الطيار (docs/21§3) — لا مدخل كوبون هنا.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError, fmtSar } from "@/lib/api";
import styles from "./cart.module.css";

/** عدّاد السعر المتحرك — يصعد بسلاسة عند كل إعادة تسعير، ويحترم تفضيل تقليل الحركة */
function AnimatedSar({ halalas, className }: { halalas: number; className?: string }) {
  const [shown, setShown] = useState(0);
  const fromRef = useRef(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      fromRef.current = halalas;
      setShown(halalas);
      return;
    }
    const from = fromRef.current;
    const t0 = performance.now();
    let raf = requestAnimationFrame(function step(t) {
      const k = Math.min((t - t0) / 600, 1);
      const eased = 1 - (1 - k) ** 3;
      const v = Math.round(from + (halalas - from) * eased);
      fromRef.current = v;
      setShown(v);
      if (k < 1) raf = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(raf);
  }, [halalas]);
  return <span className={className}>{fmtSar(shown)}</span>;
}

interface Cart {
  id: string;
  branch_id: string;
  items: Array<{
    id: string;
    name_ar: string;
    quantity: number;
    line_total_halalas: number;
    modifiers: Array<{ name_ar: string }>;
  }>;
  quote: {
    quote_id: string;
    subtotal_halalas: number;
    discount_halalas: number;
    vat_halalas: number;
    service_fee_halalas: number;
    total_halalas: number;
  } | null;
}

export default function CartPage() {
  const router = useRouter();
  const [cart, setCart] = useState<Cart | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyItem, setBusyItem] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cartId = typeof window !== "undefined" ? sessionStorage.getItem("pk_cart") : null;

  const applyQuoted = useCallback((c: Cart) => {
    setCart(c);
    if (c.quote) sessionStorage.setItem("pk_quote", c.quote.quote_id);
  }, []);

  useEffect(() => {
    if (!cartId) {
      setLoading(false);
      return;
    }
    // تسعير خادمي فور فتح السلة — BR-6
    api<Cart>("POST", `/v1/carts/${cartId}/quote`)
      .then(applyQuoted)
      .catch(async (e: Error) => {
        // سلة بلا عناصر: التسعير يرفض — نعرض الحالة الفارغة بدل الخطأ
        if (e instanceof ApiError) {
          try {
            const c = await api<Cart>("GET", `/v1/carts/${cartId}`);
            if (c.items.length === 0) {
              setCart(c);
              return;
            }
          } catch {
            /* نُبقي رسالة الخطأ الأصلية */
          }
        }
        setError(e.message);
      })
      .finally(() => setLoading(false));
  }, [cartId, applyQuoted]);

  const removeItem = async (itemId: string) => {
    if (!cartId) return;
    setError(null);
    setBusyItem(itemId);
    try {
      // DELETE يُبطل التسعيرة السارية — ثم إعادة التسعير فوراً
      const afterDelete = await api<Cart>("DELETE", `/v1/carts/${cartId}/items/${itemId}`);
      if (afterDelete.items.length === 0) {
        sessionStorage.removeItem("pk_quote");
        setCart(afterDelete);
        return;
      }
      applyQuoted(await api<Cart>("POST", `/v1/carts/${cartId}/quote`));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyItem(null);
    }
  };

  const isEmpty = !cartId || (cart !== null && cart.items.length === 0);

  return (
    <main className="pk-wrap" style={{ paddingBottom: 90 }}>
      <header className={styles.head}>
        <button className={styles.back} onClick={() => router.back()} aria-label="رجوع">
          ‹
        </button>
        <h1 className={styles.title}>السلة</h1>
      </header>

      {error && <div className={styles.error}>{error}</div>}
      {loading && <div className="pk-loader"><span /><span /><span /></div>}

      {!loading && isEmpty && !error && (
        <div className={styles.empty}>
          <div className={styles.emptyIcon}>
            <svg width="32" height="32" viewBox="0 0 100 100" aria-hidden="true">
              <g fill="none" stroke="currentColor" strokeWidth="7" strokeLinejoin="round">
                <path d="M32,32 L68,32 L64,80 L36,80 Z" />
                <path d="M41,32 Q50,20 59,32" strokeLinecap="round" />
              </g>
            </svg>
          </div>
          <b className={styles.emptyTitle}>سلتك فاضية</b>
          <p className={styles.emptyText}>لا طلبات حالية — اطلب من متجرك المفضل وخلّنا على السيارة</p>
          <button className={styles.browse} onClick={() => router.push("/")}>
            تصفح المطاعم
          </button>
        </div>
      )}

      {!isEmpty && cart && (
        <div className={styles.list}>
          {cart.items.map((i) => (
            <div key={i.id} className={styles.item} data-testid="cart-item">
              <div className={styles.thumb}>img</div>
              <div className={styles.grow}>
                <div className={styles.name}>{i.name_ar}</div>
                {i.modifiers.length > 0 && (
                  <div className={styles.mods}>{i.modifiers.map((m) => m.name_ar).join(" · ")}</div>
                )}
                <div className={styles.itemRow}>
                  <span className={styles.qty}>× {i.quantity}</span>
                  <span className={styles.price}>{fmtSar(i.line_total_halalas)}</span>
                </div>
                <div className={styles.itemActions}>
                  <button
                    className={styles.del}
                    onClick={() => removeItem(i.id)}
                    disabled={busyItem !== null}
                  >
                    حذف
                  </button>
                </div>
              </div>
            </div>
          ))}

          <button className={styles.more} onClick={() => router.push(`/r/${cart.branch_id}`)}>
            + إضافة منتجات أخرى
          </button>

          {cart.quote && (
            <div className={styles.summary} data-testid="quote-box">
              <b className={styles.summaryTitle}>ملخص الفاتورة</b>
              <div className={styles.rows}>
                <div className={styles.srow}>
                  <span>المجموع الفرعي</span>
                  <span className={styles.val}>{fmtSar(cart.quote.subtotal_halalas)}</span>
                </div>
                {cart.quote.discount_halalas > 0 && (
                  <div className={`${styles.srow} ${styles.discount}`}>
                    <span>الخصم</span>
                    <span className={styles.val}>−{fmtSar(cart.quote.discount_halalas)}</span>
                  </div>
                )}
                {/* رسم الخدمة مفصول وواضح دائماً — BR-6 */}
                <div className={styles.srow}>
                  <span>رسم خدمة بيكلي</span>
                  <span className={styles.val}>{fmtSar(cart.quote.service_fee_halalas)}</span>
                </div>
                <div className={styles.srow}>
                  <span>الضريبة (15٪)</span>
                  <span className={styles.val}>{fmtSar(cart.quote.vat_halalas)}</span>
                </div>
                <div className={`${styles.srow} ${styles.tot}`}>
                  <span>الإجمالي</span>
                  <span className={styles.val}>{fmtSar(cart.quote.total_halalas)}</span>
                </div>
              </div>
              <p className={styles.brNote}>رسوم الخدمة تظهر مفصولة دائماً · التسعير خادمي (BR-6)</p>
            </div>
          )}
        </div>
      )}

      {!isEmpty && cart?.quote && (
        <div className={styles.footbar}>
          <button
            className={styles.checkout}
            data-testid="go-checkout"
            onClick={() => router.push("/checkout")}
          >
            <span>متابعة الإتمام</span>
            <AnimatedSar halalas={cart.quote.total_halalas} className={styles.checkoutTotal} />
          </button>
        </div>
      )}
    </main>
  );
}
