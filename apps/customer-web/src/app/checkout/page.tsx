"use client";

/**
 * P6: الإتمام — صفحة تمرير واحدة: وقت + سيارة + دفع + مراجعة (C-28→C-37)
 * - وقت الاستلام FR-C06: أقرب وقت / «سأتحرك لاحقاً» / مجدول بفترات وسعة (BR-5)
 * - السيارة كشرائح + إضافة سيارة مصغرة عبر Sheet (S3: لون + آخر 4 أرقام)
 * - الدفع C-33: بطاقة أو محفظة (Apple Pay/STC Pay) — بوابة sandbox بنفس مسار الإنتاج
 * - كوبون BR-7: التحقق والخصم خادميان
 * - النجاح حالة ختامية (C-37) ثم الانتقال للتتبع /track/{id}
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, fmtSar } from "@/lib/api";
import styles from "./checkout.module.css";

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

type PickupTime = "asap" | "later" | "scheduled";

const slotLabel = (iso: string): string =>
  new Date(iso).toLocaleString("ar-SA", { weekday: "short", hour: "2-digit", minute: "2-digit" });

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
  const [done, setDone] = useState<OrderCreated | null>(null);
  const [donePickup, setDonePickup] = useState<PickupTime>("asap");
  const [flags, setFlags] = useState<Record<string, boolean>>({});
  const [pickupTime, setPickupTime] = useState<PickupTime>("asap");
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [slotId, setSlotId] = useState<string | null>(null);
  const [slotsError, setSlotsError] = useState<string | null>(null);
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
        if (s.length === 0) setSlotsError("لا فترات متاحة حالياً — جرّب لاحقاً أو اختر أقرب وقت");
      })
      .catch((e: Error) => setSlotsError(e.message));
  }, [pickupTime, cart]);

  useEffect(() => {
    api<Vehicle[]>("GET", "/v1/customers/me/vehicles")
      .then((vs) => {
        setVehicles(vs);
        const def = vs.find((v) => v.is_default) ?? vs[0];
        if (def) setVehicleId(def.id);
        else setShowAdd(true); // بلا سيارات؟ الإضافة تظهر مباشرة
      })
      .catch((e: Error) => setError(e.message));
    if (cartId) {
      api<Cart>("GET", `/v1/carts/${cartId}`)
        .then(setCart)
        .catch(() => undefined);
    }
  }, [cartId]);

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
        <h1 className={styles.title}>إتمام الطلب</h1>
        <span className={`${styles.badge} ${styles.badgeLime}`}>صفحة واحدة</span>
      </header>

      {!showAdd && errorNote}

      {/* ===== وقت الاستلام — FR-C06: أقرب وقت / سأتحرك لاحقاً / مجدول (C-28) ===== */}
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
      <button
        type="button"
        className={pickupTime === "later" ? `${styles.optCard} ${styles.optCardSel}` : styles.optCard}
        data-testid="pickup-later"
        onClick={() => setPickupTime("later")}
      >
        <span className={pickupTime === "later" ? `${styles.rdot} ${styles.rdotOn}` : styles.rdot} />
        <div className={styles.optBody}>
          <b className={styles.optTitle}>سأتحرك لاحقاً</b>
          <div className={styles.optDesc}>نجهّز طلبك ونرسل لك «وقت التحرك الأنسب» — انطلق وقت ما تبغى</div>
        </div>
      </button>
      {flags["scheduled_orders"] ? (
        <button
          type="button"
          className={pickupTime === "scheduled" ? `${styles.optCard} ${styles.optCardSel}` : styles.optCard}
          data-testid="pickup-scheduled"
          onClick={() => setPickupTime("scheduled")}
        >
          <span className={pickupTime === "scheduled" ? `${styles.rdot} ${styles.rdotOn}` : styles.rdot} />
          <div className={styles.optBody}>
            <b className={styles.optTitle}>جدولة لوقت لاحق</b>
            <div className={styles.optDesc}>فترات بسعة يحددها الفرع (BR-5) — الدفع يؤكد الحجز</div>
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

      {/* فترات BR-5 — تظهر عند اختيار الجدولة */}
      {pickupTime === "scheduled" && (
        <div className={styles.slotsWrap} data-testid="slots">
          {!slots && !slotsError && <div className="pk-loader"><span /><span /><span /></div>}
          {slotsError && <div className={`${styles.note} ${styles.noteErr}`}>{slotsError}</div>}
          {slots && slots.length > 0 && (
            <>
              <div className={styles.slotsGrid}>
                {slots.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className={slotId === s.id ? `${styles.slotChip} ${styles.slotChipSel}` : styles.slotChip}
                    data-testid="slot-chip"
                    onClick={() => setSlotId(s.id)}
                  >
                    {slotLabel(s.slot_start)}
                    <small>{s.remaining} متاح</small>
                  </button>
                ))}
              </div>
              <p className={styles.privacy}>آخر تعديل أو إلغاء مجاني: قبل ساعة من الفترة (BR-5).</p>
            </>
          )}
        </div>
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

      {/* ===== مراجعة الطلب (C-35) ===== */}
      {cart && cart.items.length > 0 && (
        <>
          <div className={styles.sech}><h2>مراجعة الطلب</h2></div>
          <div className={styles.card}>
            <b className={styles.itemsTitle}>المنتجات ({cart.items.length})</b>
            {cart.items.map((i) => (
              <div key={i.id} className={styles.kv}>
                <span className={styles.k}>
                  {i.quantity}× {i.name_ar}
                  {i.modifiers.length > 0 && ` — ${i.modifiers.map((m) => m.name_ar).join("، ")}`}
                </span>
                <span className={styles.kvv}>{fmtSar(i.line_total_halalas)}</span>
              </div>
            ))}
          </div>
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
            <div className={styles.card}>
              <div className={styles.srow}><span>المجموع الفرعي</span><span className={styles.sv}>{fmtSar(cart.quote.subtotal_halalas)}</span></div>
              {cart.quote.discount_halalas > 0 && (
                <div className={`${styles.srow} ${styles.srowOk}`}><span>الخصم</span><span className={styles.sv}>−{fmtSar(cart.quote.discount_halalas)}</span></div>
              )}
              {/* رسم الخدمة مفصول وواضح دائماً — BR-6 */}
              <div className={styles.srow}><span>رسوم خدمة بيكلي</span><span className={styles.sv}>{fmtSar(cart.quote.service_fee_halalas)}</span></div>
              <div className={styles.srow}><span>الضريبة (15٪)</span><span className={styles.sv}>{fmtSar(cart.quote.vat_halalas)}</span></div>
              <div className={`${styles.srow} ${styles.srowTot}`}><span>الإجمالي</span><span className={styles.sv}>{fmtSar(cart.quote.total_halalas)}</span></div>
            </div>
          )}
          <div className={`${styles.note} ${styles.noteSoft}`}>
            <DocIcon />
            <span><b>سياسة الإلغاء:</b> مجاني قبل قبول الفرع · بعد بدء التحضير لا يُسترجع ثمن الطلب · رسوم الخدمة تُسترجع وفق المصفوفة.</span>
          </div>
        </>
      )}

      <p className={styles.sandNote}>دفع تجريبي آمن (sandbox) — لا بطاقة حقيقية في بيئة التطوير</p>

      {/* ===== CTA الدفع ===== */}
      <div className={styles.footbar}>
        <button
          className={busy || total == null ? `${styles.payBtn} ${styles.payBtnCenter}` : styles.payBtn}
          data-testid="pay-button"
          disabled={busy || !vehicleId || !cartId || (pickupTime === "scheduled" && !slotId)}
          onClick={payAndOrder}
        >
          {busy ? (
            "جارٍ الدفع…"
          ) : total != null ? (
            <>
              <span>ادفع الآن</span>
              <span className={styles.payAmt}>{fmtSar(total)}</span>
            </>
          ) : (
            "ادفع الآن"
          )}
        </button>
      </div>

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
    </main>
  );
}
