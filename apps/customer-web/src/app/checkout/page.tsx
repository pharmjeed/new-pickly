"use client";

/**
 * P5+P6: السلة والإتمام — صفحة تمرير واحدة: سلة + وقت + سيارة + دفع + فاتورة (C-26→C-37)
 * - السلة C-26 مدموجة هنا (قرار المالك 2026-07-12): حذف عنصر → إبطال التسعيرة وإعادة التسعير فوراً،
 *   والتسعير خادمي حصراً (BR-6) — /cart تحوّل إلى هنا.
 * - وقت الاستلام FR-C06: أقرب وقت / مجدول بفترات وسعة (BR-5)
 * - السيارة كشرائح + إضافة سيارة مصغرة عبر Sheet (S3: لون + آخر 4 أرقام)
 * - الدفع C-33: بطاقة أو محفظة (Apple Pay/STC Pay) — بوابة sandbox بنفس مسار الإنتاج
 * - كوبون BR-7: التحقق والخصم خادميان
 * - النجاح حالة ختامية (C-37) ثم الانتقال للتتبع /track/{id}
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError, fmtSar } from "@/lib/api";
import styles from "./checkout.module.css";

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

interface Vehicle {
  id: string;
  make_ar: string | null;
  model_ar: string | null;
  color_ar: string;
  plate_short: string;
  is_default: boolean;
}

interface Cart {
  id: string;
  branch_id: string;
  coupon_code: string | null;
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

interface Slot {
  id: string;
  slot_start: string;
  slot_end: string;
  remaining: number;
}

interface OrderCreated {
  id: string;
  display_code: string;
  total_halalas: number;
}

type PickupTime = "asap" | "scheduled";

/* ===== جدولة BR-5: تسميات اليوم والفترة (كما في تصميم «حدد موعد طلبك») ===== */
const pad2 = (n: number): string => String(n).padStart(2, "0");
const clock12 = (d: Date): string => `${pad2(d.getHours() % 12 || 12)}:${pad2(d.getMinutes())}`;
/** «06:30 - 07:00 م» — المدى ثم ص/م بنهاية الفترة */
const slotRangeLabel = (s: Slot): string => {
  const a = new Date(s.slot_start);
  const b = new Date(s.slot_end);
  return `${clock12(a)} - ${clock12(b)} ${b.getHours() >= 12 ? "م" : "ص"}`;
};
const dayKeyOf = (iso: string): string => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};
const dayLabelOf = (iso: string): string => {
  const d = new Date(iso);
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startThat = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((startThat - startToday) / 86400000);
  if (diff === 0) return "اليوم";
  if (diff === 1) return "غدًا";
  return d.toLocaleDateString("ar-SA", { weekday: "long" });
};

interface DayGroup {
  key: string;
  label: string;
  slots: Slot[];
}

/* عجلة اختيار (يوم/وقت): المحدد كبير أعلى القائمة والبقية تتلاشى تحته */
const WHEEL_ITEM_H = 46;
function Wheel({
  items,
  index,
  onChange,
  itemTestId
}: {
  items: string[];
  index: number;
  onChange: (i: number) => void;
  itemTestId?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const settleTimer = useRef<number | null>(null);
  // عند الفتح: العجلة تقف على العنصر المحدد مسبقاً
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = index * WHEEL_ITEM_H;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const onScroll = () => {
    const el = ref.current;
    if (!el) return;
    if (settleTimer.current) window.clearTimeout(settleTimer.current);
    settleTimer.current = window.setTimeout(() => {
      const i = Math.min(items.length - 1, Math.max(0, Math.round(el.scrollTop / WHEEL_ITEM_H)));
      if (i !== index) onChange(i);
    }, 90);
  };
  const pick = (i: number) => {
    onChange(i);
    ref.current?.scrollTo({ top: i * WHEEL_ITEM_H, behavior: "smooth" });
  };
  return (
    <div className={styles.wheel} ref={ref} onScroll={onScroll}>
      {items.map((t, i) => {
        const d = Math.min(Math.abs(i - index), 3);
        return (
          <button
            key={i}
            type="button"
            className={`${styles.wItem} ${styles[`w${d}` as "w0" | "w1" | "w2" | "w3"]}`}
            data-testid={itemTestId}
            aria-selected={i === index}
            onClick={() => pick(i)}
          >
            {t}
          </button>
        );
      })}
    </div>
  );
}

/* ===== أيقونات الهوية (من رموز P6.html) ===== */
function CarIcon({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="7" strokeLinecap="round">
        <path d="M30,56 Q35,40 50,40 Q65,40 70,56" />
        <rect x="18" y="54" width="64" height="18" rx="9" />
        <circle cx="34" cy="78" r="6" strokeWidth="6" />
        <circle cx="66" cy="78" r="6" strokeWidth="6" />
      </g>
    </svg>
  );
}
function CardIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="7">
        <rect x="14" y="26" width="72" height="48" rx="10" />
        <path d="M14,42 H86" strokeWidth="8" />
        <path d="M26,60 H46" strokeLinecap="round" />
      </g>
    </svg>
  );
}
function WalletIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="7" strokeLinejoin="round">
        <path d="M18,32 C18,26 22,22 28,22 H74 V32" />
        <rect x="18" y="32" width="66" height="46" rx="8" />
        <circle cx="66" cy="55" r="5" fill="currentColor" stroke="none" />
      </g>
    </svg>
  );
}
function ShieldIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="7" strokeLinejoin="round">
        <path d="M50,14 L80,26 C80,54 70,74 50,86 C30,74 20,54 20,26 Z" />
        <path d="M38,50 L47,59 L64,40" strokeLinecap="round" />
      </g>
    </svg>
  );
}
function DocIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M30,14 H62 L78,30 V86 H30 Z" />
        <path d="M62,14 V30 H78" />
        <path d="M42,50 H66 M42,64 H66" />
      </g>
    </svg>
  );
}
function CheckIcon({ size = 46 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <path d="M22,52 L42,72 L80,30" fill="none" stroke="currentColor" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function ChevIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <path d="M60,26 L36,50 L60,74" fill="none" stroke="currentColor" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function XIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <path d="M28,28 L72,72 M72,28 L28,72" fill="none" stroke="currentColor" strokeWidth="8" strokeLinecap="round" />
    </svg>
  );
}

export default function CheckoutPage() {
  const router = useRouter();
  const [vehicles, setVehicles] = useState<Vehicle[] | null>(null);
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [color, setColor] = useState("");
  const [plate, setPlate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cart, setCart] = useState<Cart | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyItem, setBusyItem] = useState<string | null>(null);
  const [done, setDone] = useState<OrderCreated | null>(null);
  const [donePickup, setDonePickup] = useState<PickupTime>("asap");
  const [flags, setFlags] = useState<Record<string, boolean>>({});
  const [pickupTime, setPickupTime] = useState<PickupTime>("asap");
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [slotId, setSlotId] = useState<string | null>(null);
  const [slotsError, setSlotsError] = useState<string | null>(null);
  const [showSched, setShowSched] = useState(false);
  const [dayIdx, setDayIdx] = useState(0);
  const [timeIdx, setTimeIdx] = useState(0);
  const [payMethod, setPayMethod] = useState<"card" | "wallet">("card");
  const [couponCode, setCouponCode] = useState("");
  const [couponBusy, setCouponBusy] = useState(false);
  const [couponError, setCouponError] = useState<string | null>(null);

  const cartId = typeof window !== "undefined" ? sessionStorage.getItem("pk_cart") : null;
  const quoteId = cart?.quote?.quote_id ?? (typeof window !== "undefined" ? sessionStorage.getItem("pk_quote") : null);
  const total = cart?.quote?.total_halalas ?? null;

  useEffect(() => {
    api<Record<string, boolean>>("GET", "/v1/feature-flags")
      .then(setFlags)
      .catch(() => undefined); // الأعلام ميزة تكيف — الافتراضي إخفاء المؤجل
  }, []);

  // BR-5: فترات الفرع تُجلب عند اختيار الجدولة
  useEffect(() => {
    if (pickupTime !== "scheduled" || !cart) return;
    setSlots(null);
    setSlotsError(null);
    api<Slot[]>("GET", `/v1/branches/${cart.branch_id}/slots`)
      .then((s) => {
        setSlots(s);
        setDayIdx(0);
        setTimeIdx(0);
        if (s.length === 0) setSlotsError("لا فترات متاحة حالياً — جرّب لاحقاً أو اختر أقرب وقت");
      })
      .catch((e: Error) => setSlotsError(e.message));
  }, [pickupTime, cart]);

  // فترات الأيام مجمعة لعجلتي «اليوم/الوقت»
  const dayGroups = useMemo<DayGroup[]>(() => {
    const map = new Map<string, DayGroup>();
    for (const s of slots ?? []) {
      if (s.remaining <= 0) continue;
      const key = dayKeyOf(s.slot_start);
      const g = map.get(key) ?? { key, label: dayLabelOf(s.slot_start), slots: [] };
      g.slots.push(s);
      map.set(key, g);
    }
    return [...map.values()];
  }, [slots]);

  const chosenSlot = useMemo(
    () => (slotId ? (slots ?? []).find((s) => s.id === slotId) ?? null : null),
    [slots, slotId]
  );

  /** فتح ورقة «حدد موعد طلبك» — لو سبق الاختيار نُعيد العجلتين لموضعه */
  const openSched = () => {
    setPickupTime("scheduled");
    if (chosenSlot) {
      const di = dayGroups.findIndex((g) => g.key === dayKeyOf(chosenSlot.slot_start));
      if (di >= 0) {
        setDayIdx(di);
        const ti = dayGroups[di].slots.findIndex((s) => s.id === chosenSlot.id);
        setTimeIdx(ti >= 0 ? ti : 0);
      }
    }
    setShowSched(true);
  };

  /** إغلاق بلا حفظ: بلا فترة مختارة نرجع لأقرب وقت حتى لا يعلق الإرسال */
  const closeSched = () => {
    setShowSched(false);
    if (!slotId) setPickupTime("asap");
  };

  const saveSched = () => {
    const s = dayGroups[dayIdx]?.slots[timeIdx];
    if (!s) return;
    setSlotId(s.id);
    setShowSched(false);
  };

  const applyQuoted = useCallback((c: Cart) => {
    setCart(c);
    if (c.quote) sessionStorage.setItem("pk_quote", c.quote.quote_id);
  }, []);

  useEffect(() => {
    api<Vehicle[]>("GET", "/v1/customers/me/vehicles")
      .then((vs) => {
        setVehicles(vs);
        const def = vs.find((v) => v.is_default) ?? vs[0];
        if (def) setVehicleId(def.id);
        else setShowAdd(true); // بلا سيارات؟ الإضافة تظهر مباشرة
      })
      .catch((e: Error) => setError(e.message));
    if (!cartId) {
      setLoading(false);
      return;
    }
    // تسعير خادمي فور فتح الصفحة — BR-6
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

  // النجاح حالة ختامية — ثم ننتقل للتتبع تلقائياً
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => router.push(`/track/${done.id}`), 1400);
    return () => clearTimeout(t);
  }, [done, router]);

  const addVehicle = async () => {
    setBusy(true);
    setError(null);
    try {
      // إضافة سيارة مصغرة — S3: حقلان فقط
      const v = await api<Vehicle>("POST", "/v1/customers/me/vehicles", {
        color_ar: color,
        plate_short: plate
      });
      setVehicles((vs) => [...(vs ?? []), v]);
      setVehicleId(v.id);
      setShowAdd(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const applyCoupon = async () => {
    if (!cartId || couponCode.trim().length < 2) return;
    setCouponBusy(true);
    setCouponError(null);
    try {
      const updated = await api<Cart>("POST", `/v1/carts/${cartId}/coupon`, { code: couponCode.trim() });
      setCart(updated);
      // الكوبون يعيد التسعير — التسعيرة الجديدة هي المرجع
      if (updated.quote) sessionStorage.setItem("pk_quote", updated.quote.quote_id);
      setCouponCode("");
    } catch (e) {
      setCouponError((e as Error).message);
    } finally {
      setCouponBusy(false);
    }
  };

  const removeCoupon = async () => {
    if (!cartId) return;
    setCouponBusy(true);
    try {
      const updated = await api<Cart>("DELETE", `/v1/carts/${cartId}/coupon`);
      // إزالة الكوبون تبطل التسعيرة — نعيد التسعير فوراً
      const requoted = await api<Cart>("POST", `/v1/carts/${cartId}/quote`, {});
      setCart(requoted);
      if (requoted.quote) sessionStorage.setItem("pk_quote", requoted.quote.quote_id);
      void updated;
    } catch (e) {
      setCouponError((e as Error).message);
    } finally {
      setCouponBusy(false);
    }
  };

  const payAndOrder = async () => {
    if (!cartId || !quoteId || !vehicleId) return;
    if (pickupTime === "scheduled" && !slotId) return;
    setBusy(true);
    setError(null);
    try {
      const order = await api<OrderCreated>(
        "POST",
        "/v1/orders",
        {
          cart_id: cartId,
          quote_id: quoteId,
          vehicle_id: vehicleId,
          pickup_time: pickupTime,
          ...(pickupTime === "scheduled" && slotId ? { slot_id: slotId } : {})
        },
        { idempotent: true }
      );
      await api("POST", `/v1/orders/${order.id}/payment-intent`, { method: payMethod }, { idempotent: true });
      // بوابة sandbox — نفس مسار الإنتاج: النتيجة عبر webhook موقع
      const pay = await api<{ gateway_result: string }>(
        "POST",
        `/v1/dev/mock-gateway/by-order/${order.id}/pay`
      );
      if (pay.gateway_result !== "authorized") {
        setError("ما تمّ الدفع. جرّب بطاقة ثانية — طلبك محفوظ");
        return;
      }
      sessionStorage.removeItem("pk_cart");
      sessionStorage.removeItem("pk_quote");
      setDonePickup(pickupTime);
      setDone(order); // C-37: نجاح الطلب
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const errorNote = error && (
    <div className={`${styles.note} ${styles.noteErr}`} data-testid="checkout-error">{error}</div>
  );

  /* ===== C-37: نجاح الطلب — حالة ختامية ===== */
  if (done) {
    return (
      <main className={styles.page}>
        <div className={styles.success}>
          <div className={styles.bigic}><CheckIcon /></div>
          <h1 className={styles.bigTitle}>تم إنشاء طلبك</h1>
          <div className={`${styles.card} ${styles.successCard}`}>
            <div className={styles.kv}>
              <span className={styles.k}>رقم الطلب</span>
              <span className={styles.kvv} style={{ fontWeight: 700 }}>{done.display_code}</span>
            </div>
            <div className={styles.kv}>
              <span className={styles.k}>الحالة</span>
              <span className="pk-badge warn">
                {donePickup === "scheduled"
                  ? "محجوز لفترتك — ندخله للمطعم وقت الفترة"
                  : "أُرسل للمطعم — بانتظار القبول"}
              </span>
            </div>
            <div className={styles.kv}>
              <span className={styles.k}>القيمة المدفوعة</span>
              <span className={styles.kvv}>{fmtSar(done.total_halalas)}</span>
            </div>
          </div>
          <button className={`${styles.payBtn} ${styles.payBtnCenter}`} onClick={() => router.push(`/track/${done.id}`)}>
            متابعة الطلب مباشرة
          </button>
          <p className={styles.sandNote}>ننقلك لمتابعة الطلب الآن…</p>
        </div>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      {/* رأس رجوع */}
      <header className={styles.bhead}>
        <button className={styles.bk} onClick={() => router.back()} aria-label="رجوع"><ChevIcon /></button>
        <h1 className={styles.title}>السلة والإتمام</h1>
        <span className={`${styles.badge} ${styles.badgeLime}`}>صفحة واحدة</span>
      </header>

      {!showAdd && errorNote}
      {loading && <div className="pk-loader"><span /><span /><span /></div>}

      {/* ===== الحالة الفارغة — السلة بلا عناصر (C-26) ===== */}
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
        <>
      {/* ===== السلة (C-26): العناصر أول ما ينزل عليه العميل ===== */}
      <div className={styles.sech}><h2>سلتك</h2></div>
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

      {/* ===== وقت الاستلام — FR-C06: أقرب وقت / مجدول (C-28) ===== */}
      <div className={styles.sech}><h2>وقت الاستلام</h2></div>
      <button
        type="button"
        className={pickupTime === "asap" ? `${styles.optCard} ${styles.optCardSel}` : styles.optCard}
        data-testid="pickup-asap"
        onClick={() => setPickupTime("asap")}
      >
        <span className={pickupTime === "asap" ? `${styles.rdot} ${styles.rdotOn}` : styles.rdot} />
        <div className={styles.optBody}>
          <b className={styles.optTitle}>أقرب وقت</b>
          <div className={styles.optDesc}>المطعم يجهّز طلبك على وقت وصولك</div>
        </div>
        <span className={`${styles.badge} ${styles.badgeLime}`}>موصى به</span>
      </button>
      {flags["scheduled_orders"] ? (
        <button
          type="button"
          className={pickupTime === "scheduled" ? `${styles.optCard} ${styles.optCardSel}` : styles.optCard}
          data-testid="pickup-scheduled"
          onClick={openSched}
        >
          <span className={pickupTime === "scheduled" ? `${styles.rdot} ${styles.rdotOn}` : styles.rdot} />
          <div className={styles.optBody}>
            <b className={styles.optTitle}>جدولة لوقت لاحق</b>
            <div className={styles.optDesc}>
              {pickupTime === "scheduled" && chosenSlot
                ? `${dayLabelOf(chosenSlot.slot_start)} ${slotRangeLabel(chosenSlot)} — اضغط للتغيير`
                : "فترات بسعة يحددها الفرع (BR-5) — الدفع يؤكد الحجز"}
            </div>
          </div>
        </button>
      ) : (
        <div className={`${styles.optCard} ${styles.optCardDis}`} aria-disabled="true">
          <span className={styles.rdot} />
          <div className={styles.optBody}>
            <b className={styles.optTitleR}>جدولة لوقت لاحق</b>
            <div className={styles.optDesc}>فترات بسعة يحددها الفرع (BR-5)</div>
          </div>
          <span className={`${styles.badge} ${styles.badgeSoft}`}>قريباً</span>
        </div>
      )}

      {/* خطأ الفترات (BR-5) — يظهر تحت الخيار لو تعذر الجلب أو لا فترات */}
      {pickupTime === "scheduled" && slotsError && (
        <div className={`${styles.note} ${styles.noteErr}`}>{slotsError}</div>
      )}

      {/* ===== السيارة — شرائح + إضافة عبر Sheet (C-30 · S3) ===== */}
      <div className={styles.sech}>
        <h2>السيارة</h2>
        <button className={styles.sechLink} onClick={() => setShowAdd(true)}>+ إضافة — حقلان (S3)</button>
      </div>
      {!vehicles && !error && <div className="pk-loader"><span /><span /><span /></div>}
      {vehicles?.map((v) => {
        const name = [v.model_ar ?? v.make_ar, v.color_ar].filter(Boolean).join(" · ");
        return (
          <label key={v.id} className={vehicleId === v.id ? `${styles.vcard} ${styles.vcardSel}` : styles.vcard}>
            <input
              type="radio"
              name="vehicle"
              className={styles.radio}
              checked={vehicleId === v.id}
              onChange={() => setVehicleId(v.id)}
              data-testid="vehicle-radio"
            />
            <span className={styles.vic}><CarIcon /></span>
            <span className={styles.vbody}>
              <span className={styles.vt}>{name || v.color_ar}</span>
              {v.is_default && <span className={styles.vsub}>الافتراضية</span>}
            </span>
            <span className={styles.plate}><span className={styles.plateNo}>•••• {v.plate_short}</span></span>
          </label>
        );
      })}
      <p className={styles.privacy}>اللوحات مشفرة ولا تظهر كاملة إلا لموظف التسليم أثناء طلبك النشط فقط.</p>

      {/* ===== الدفع — C-33: بطاقة أو محفظة (بوابة sandbox بنفس مسار الإنتاج) ===== */}
      <div className={styles.sech}><h2>الدفع</h2></div>
      <button
        type="button"
        className={payMethod === "card" ? `${styles.optCard} ${styles.optCardSel}` : styles.optCard}
        data-testid="pay-card"
        onClick={() => setPayMethod("card")}
      >
        <span className={payMethod === "card" ? `${styles.rdot} ${styles.rdotOn}` : styles.rdot} />
        <span className={styles.vic}><CardIcon /></span>
        <div className={styles.optBody}>
          <b className={styles.optTitle}>بطاقة — مدى وفيزا وماستركارد</b>
          <div className={styles.optDesc}>نفس مسار الإنتاج — النتيجة عبر Webhook موقّع</div>
        </div>
        <span className={`${styles.badge} ${styles.badgeLime}`}>بيئة التطوير</span>
      </button>
      {flags["wallet_payments"] ? (
        <button
          type="button"
          className={payMethod === "wallet" ? `${styles.optCard} ${styles.optCardSel}` : styles.optCard}
          data-testid="pay-wallet"
          onClick={() => setPayMethod("wallet")}
        >
          <span className={payMethod === "wallet" ? `${styles.rdot} ${styles.rdotOn}` : styles.rdot} />
          <span className={styles.vic}><WalletIcon /></span>
          <div className={styles.optBody}>
            <b className={styles.optTitle}>Apple Pay / STC Pay</b>
            <div className={styles.optDesc}>محافظ عبر بوابة الدفع — Tokenization فقط</div>
          </div>
        </button>
      ) : (
        <div className={`${styles.optCard} ${styles.optCardDis}`} aria-disabled="true">
          <span className={styles.rdot} />
          <span className={styles.vic}><WalletIcon /></span>
          <div className={styles.optBody}>
            <b className={styles.optTitleR}>Apple Pay / STC Pay</b>
            <div className={styles.optDesc}>محافظ عبر بوابة الدفع</div>
          </div>
          <span className={`${styles.badge} ${styles.badgeSoft}`}>قريباً</span>
        </div>
      )}
      <div className={`${styles.note} ${styles.noteSoft}`}>
        <ShieldIcon />
        <span>لا دفع نقدياً في الإصدار الحالي · Tokenization فقط — لا نخزن رقم بطاقتك أبداً.</span>
      </div>

      {/* ===== ملخص الفاتورة (C-35) — العناصر نفسها معروضة أعلى الصفحة ===== */}
      {cart.items.length > 0 && (
        <>
          <div className={styles.sech}><h2>ملخص الفاتورة</h2></div>
          {/* كوبون BR-7 — التحقق والخصم خادميان حصراً */}
          {flags["coupons_full"] && (
            <div className={styles.card} data-testid="coupon-box">
              {cart.coupon_code ? (
                <div className={styles.kv}>
                  <span className={styles.k}>
                    الكوبون <b className={styles.kvv}>{cart.coupon_code}</b> مفعّل
                  </span>
                  <button type="button" className={styles.sechLink} onClick={removeCoupon} disabled={couponBusy} data-testid="coupon-remove">
                    إزالة
                  </button>
                </div>
              ) : (
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    className={styles.inp}
                    style={{ flex: 1 }}
                    placeholder="عندك كوبون؟ أدخله هنا"
                    value={couponCode}
                    onChange={(e) => setCouponCode(e.target.value)}
                    data-testid="coupon-input"
                  />
                  <button
                    type="button"
                    className={styles.sechLink}
                    onClick={applyCoupon}
                    disabled={couponBusy || couponCode.trim().length < 2}
                    data-testid="coupon-apply"
                  >
                    {couponBusy ? "جارٍ التحقق…" : "تطبيق"}
                  </button>
                </div>
              )}
              {couponError && <div className={`${styles.note} ${styles.noteErr}`} style={{ marginTop: 8 }}>{couponError}</div>}
            </div>
          )}
          {cart.quote && (
            <div className={styles.card} data-testid="quote-box">
              <div className={styles.srow}><span>المجموع الفرعي</span><span className={styles.sv}>{fmtSar(cart.quote.subtotal_halalas)}</span></div>
              {cart.quote.discount_halalas > 0 && (
                <div className={`${styles.srow} ${styles.srowOk}`}><span>الخصم</span><span className={styles.sv}>−{fmtSar(cart.quote.discount_halalas)}</span></div>
              )}
              {/* رسم الخدمة مفصول وواضح دائماً — BR-6 */}
              <div className={styles.srow}><span>رسم خدمة بيكلي</span><span className={styles.sv}>{fmtSar(cart.quote.service_fee_halalas)}</span></div>
              <div className={`${styles.srow} ${styles.srowTot}`}><span>الإجمالي</span><span className={styles.sv}>{fmtSar(cart.quote.total_halalas)}</span></div>
              <p className={styles.srow} style={{ fontSize: 12, opacity: 0.7 }}>الأسعار شاملة ضريبة القيمة المضافة</p>
            </div>
          )}
          <div className={`${styles.note} ${styles.noteSoft}`}>
            <DocIcon />
            <span><b>سياسة الإلغاء:</b> مجاني قبل قبول الفرع · بعد بدء التحضير لا يُسترجع ثمن الطلب · رسوم الخدمة تُسترجع وفق المصفوفة.</span>
          </div>
        </>
      )}

      <p className={styles.sandNote}>دفع تجريبي آمن (sandbox) — لا بطاقة حقيقية في بيئة التطوير</p>

      {/* ===== CTA الدفع — الزر الحيوي المدموم من السلة: نبض + سعر متحرك + سيارة بيكلي ===== */}
      <div className={styles.footbar}>
        <button
          className={busy || total == null ? `${styles.payBtn} ${styles.payBtnCenter}` : `${styles.payBtn} ${styles.cta}`}
          data-testid="pay-button"
          disabled={busy || !vehicleId || !cartId || (pickupTime === "scheduled" && !slotId)}
          onClick={payAndOrder}
        >
          {busy ? (
            "جارٍ الدفع…"
          ) : total != null ? (
            <>
              <span className={styles.ctaLabel}>
                ادفع الآن
                <span className={styles.ctaArrow} aria-hidden="true">
                  <span>←</span>
                  <span>←</span>
                  <span>←</span>
                </span>
              </span>
              <AnimatedSar halalas={total} className={styles.payAmt} />
              <span className={styles.carLane} aria-hidden="true">
                <span className={styles.car}>
                  <span className={styles.carTrail}>
                    <i />
                    <i />
                    <i />
                  </span>
                  {/* المقدمة لليسار — اتجاه السير؛ الكبوت منخفض أماماً والمقصورة للخلف */}
                  <svg width="38" height="18" viewBox="0 0 38 18">
                    <path
                      d="M2.5 13 L3.5 10 Q4 8.5 6.5 8.2 L16 8 L19.5 4.2 Q20.5 3 22.5 3 L29.5 3 Q33.5 3 34.8 8.5 L35.5 12 Q35.6 13 34.5 13 Z"
                      fill="var(--pk-ink-900)"
                    />
                    <circle cx="9.5" cy="14" r="3" fill="var(--pk-ink-900)" stroke="var(--pk-lime-500)" strokeWidth="1.4" />
                    <circle cx="28.5" cy="14" r="3" fill="var(--pk-ink-900)" stroke="var(--pk-lime-500)" strokeWidth="1.4" />
                  </svg>
                </span>
              </span>
            </>
          ) : (
            "ادفع الآن"
          )}
        </button>
      </div>

      {/* ===== Sheet الجدولة — «حدد موعد طلبك»: عجلتا يوم/وقت (BR-5) ===== */}
      {showSched && (
        <div className={styles.dim}>
          <div className={styles.sheet} role="dialog" aria-label="حدد موعد طلبك" data-testid="slots">
            <div className={styles.grab} />
            <div className={styles.sheetHead}>
              <h2>حدد موعد طلبك</h2>
              <button className={styles.bk} onClick={closeSched} aria-label="إغلاق" data-testid="sched-close">
                <XIcon />
              </button>
            </div>
            {!slots && !slotsError && <div className="pk-loader"><span /><span /><span /></div>}
            {slotsError && <div className={`${styles.note} ${styles.noteErr}`}>{slotsError}</div>}
            {dayGroups.length > 0 && (
              <>
                <div className={styles.wheels}>
                  <span className={styles.selLine} aria-hidden="true" />
                  <div className={styles.wheelDay}>
                    <Wheel
                      items={dayGroups.map((g) => g.label)}
                      index={dayIdx}
                      onChange={(i) => {
                        setDayIdx(i);
                        setTimeIdx(0);
                      }}
                      itemTestId="day-item"
                    />
                  </div>
                  <div className={styles.wheelTime}>
                    <Wheel
                      key={dayGroups[dayIdx]?.key ?? "d0"}
                      items={(dayGroups[dayIdx] ?? dayGroups[0]).slots.map(slotRangeLabel)}
                      index={timeIdx}
                      onChange={setTimeIdx}
                      itemTestId="slot-chip"
                    />
                  </div>
                </div>
                <p className={styles.privacy}>آخر تعديل أو إلغاء مجاني: قبل ساعة من الفترة (BR-5).</p>
                <button
                  className={`${styles.payBtn} ${styles.payBtnCenter}`}
                  data-testid="sched-save"
                  onClick={saveSched}
                >
                  حفظ
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* ===== Sheet إضافة سيارة (C-30 · S3: حقلان) ===== */}
      {showAdd && (
        <div className={styles.dim}>
          <div className={styles.sheet} role="dialog" aria-label="إضافة سيارة">
            <div className={styles.grab} />
            <div className={styles.sheetHead}>
              <h2>إضافة سيارة</h2>
              {vehicles && vehicles.length > 0 && (
                <button className={styles.bk} onClick={() => setShowAdd(false)} aria-label="إغلاق"><XIcon /></button>
              )}
            </div>
            {errorNote}
            <div className={styles.fld}>
              <label>اللون *</label>
              <input
                className={styles.inp}
                data-testid="veh-color"
                placeholder="مثال: بيضاء"
                value={color}
                onChange={(e) => setColor(e.target.value)}
              />
            </div>
            <div className={styles.fld}>
              <label>آخر 4 أرقام اللوحة *</label>
              <input
                className={`${styles.inp} ${styles.inpPlate}`}
                data-testid="veh-plate"
                inputMode="numeric"
                maxLength={4}
                placeholder="0000"
                value={plate}
                onChange={(e) => setPlate(e.target.value)}
              />
            </div>
            <div className={`${styles.note} ${styles.noteInfo}`}>
              <ShieldIcon size={17} />
              <span><b>خصوصيتك:</b> اللوحة تُشفَّر ولا تُعرض كاملة أبداً خارج طلبك التشغيلي.</span>
            </div>
            <button
              className={`${styles.payBtn} ${styles.payBtnCenter}`}
              data-testid="veh-save"
              disabled={busy || color.length < 2 || plate.length < 1}
              onClick={addVehicle}
            >
              حفظ السيارة
            </button>
          </div>
        </div>
      )}
        </>
      )}
    </main>
  );
}
