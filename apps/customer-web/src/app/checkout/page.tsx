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
  plate_letters_ar: string | null;
  plate_digits: string;
  is_default: boolean;
}

/* كتالوج السيارات — GET /v1/vehicle-catalog (قاعدة بيانات الماركات والموديلات) */
interface CatalogModel {
  name_ar: string;
  name_en: string;
}
interface CatalogMake {
  key: string;
  name_ar: string;
  name_en: string;
  models: CatalogModel[];
}
interface VehicleCatalog {
  makes: CatalogMake[];
  colors: Array<{ name_ar: string; hex: string; aliases: string[] }>;
}

const OTHER = "أخرى";

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

/* طرق الدفع من GET /v1/content/payment-methods — الفعّالة فقط بترتيب السوبر أدمن */
type PayMethodKey = "apple_pay" | "card" | "stc_pay";
interface PayMethod {
  key: PayMethodKey;
  name_ar: string;
  desc_ar: string | null;
  badge_ar: string | null;
}
interface WalletInfo {
  balance_halalas: number;
}

/* بطاقاتي — Tokenization فقط: لا يُخزن رقم البطاقة، فقط brand/last4/expiry */
interface SavedCard {
  id: string;
  brand: "mada" | "visa" | "mastercard";
  last4: string;
  exp_month: number;
  exp_year: number;
  holder_name: string | null;
  is_default: boolean;
  expired: boolean;
}

const BRAND_AR: Record<SavedCard["brand"], string> = {
  mada: "مدى",
  visa: "VISA",
  mastercard: "Mastercard"
};

/** تنسيق رقم البطاقة أثناء الكتابة: مجموعات من 4 */
const formatPan = (s: string): string =>
  s.replace(/\D/g, "").slice(0, 19).replace(/(\d{4})(?=\d)/g, "$1 ");

type PickupTime = "asap" | "scheduled";

/* قصاصات كونفيتي الاحتفال (C-37) — ألوان الهوية بغلبة ليمونية، مواضع وتوقيتات متنوّعة */
const CONFETTI: Array<{ l: string; d: string; t: string; c: string }> = [
  { l: "10%", d: "0s", t: "2.6s", c: "var(--pk-lime-500)" },
  { l: "22%", d: ".5s", t: "3s", c: "#ffd54d" },
  { l: "34%", d: ".2s", t: "2.4s", c: "var(--pk-lime-300)" },
  { l: "46%", d: ".8s", t: "2.9s", c: "var(--pk-ink-900)" },
  { l: "58%", d: ".35s", t: "2.5s", c: "var(--pk-success)" },
  { l: "70%", d: ".65s", t: "3.1s", c: "var(--pk-lime-500)" },
  { l: "82%", d: ".15s", t: "2.7s", c: "#ffd54d" },
  { l: "90%", d: ".9s", t: "2.8s", c: "var(--pk-lime-300)" },
  { l: "16%", d: "1.1s", t: "3s", c: "var(--pk-success)" },
  { l: "64%", d: "1.3s", t: "2.6s", c: "var(--pk-ink-900)" }
];

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
/** شعار Apple — لعلامة Apple Pay (زر الدفع الأسود وصف الطريقة) */
function AppleLogo({ size = 15, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size * (512 / 384)} viewBox="0 0 384 512" aria-hidden="true">
      <path
        fill={color}
        d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z"
      />
    </svg>
  );
}

/** علامة «⌘ Pay» — شارة بيضاء بحدود كما في التصميم المرجعي */
function ApplePayMark() {
  return (
    <span className={styles.apMark} aria-label="Apple Pay">
      <AppleLogo size={12} />
      <span>Pay</span>
    </span>
  );
}

/** شارات شبكات البطاقات — مدى / فيزا / ماستركارد */
function CardNetworks() {
  return (
    <span className={styles.nets} aria-hidden="true">
      <span className={styles.net}>مدى</span>
      <span className={styles.net} style={{ color: "#1a1f71" }}>VISA</span>
      <span className={styles.netMc}>
        <i />
        <i />
      </span>
    </span>
  );
}

/** أيقونة الطريقة في صف الاختيار */
function MethodIcon({ k }: { k: PayMethodKey }) {
  if (k === "apple_pay") return <ApplePayMark />;
  if (k === "stc_pay") return <span className={styles.stcMark}>stc<b>pay</b></span>;
  return <CardIcon />;
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
  const [catalog, setCatalog] = useState<VehicleCatalog | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [makeSel, setMakeSel] = useState(""); // name_ar من الكتالوج أو «أخرى»
  const [makeCustom, setMakeCustom] = useState("");
  const [modelSel, setModelSel] = useState("");
  const [modelCustom, setModelCustom] = useState("");
  const [color, setColor] = useState("");
  const [letters, setLetters] = useState(""); // حروف اللوحة بلا مسافات (حتى 3)
  const [plate, setPlate] = useState(""); // أرقام اللوحة (حتى 4)
  const longPressTimer = useRef<number | null>(null);
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
  // طريقة الدفع — القائمة يديرها السوبر أدمن (قرار المالك 2026-07-12) + محفظة بيكلي
  const [methods, setMethods] = useState<PayMethod[]>([]);
  const [payMethod, setPayMethod] = useState<PayMethodKey>("card");
  const [showPay, setShowPay] = useState(false);
  const [wallet, setWallet] = useState<WalletInfo | null>(null);
  const [walletOn, setWalletOn] = useState(false);
  // بطاقاتي — Tokenization فقط (قرار المالك 2026-07-12)
  const [cards, setCards] = useState<SavedCard[]>([]);
  const [cardId, setCardId] = useState<string | null>(null);
  const [showAddCard, setShowAddCard] = useState(false);
  const [pan, setPan] = useState("");
  const [expiry, setExpiry] = useState(""); // MM/YY
  const [cvv, setCvv] = useState("");
  const [holder, setHolder] = useState("");
  const [saveDefault, setSaveDefault] = useState(true);
  const [cardBusy, setCardBusy] = useState(false);
  const [cardError, setCardError] = useState<string | null>(null);
  const [couponCode, setCouponCode] = useState("");
  const [couponBusy, setCouponBusy] = useState(false);
  const [couponError, setCouponError] = useState<string | null>(null);

  const cartId = typeof window !== "undefined" ? sessionStorage.getItem("pk_cart") : null;
  const quoteId = cart?.quote?.quote_id ?? (typeof window !== "undefined" ? sessionStorage.getItem("pk_quote") : null);
  const total = cart?.quote?.total_halalas ?? null;
  // ما تغطيه المحفظة (كلياً أو جزئياً) — الحسم الفعلي خادمي عند إنشاء الـintent
  const walletApplied = walletOn && wallet && total != null ? Math.min(wallet.balance_halalas, total) : 0;
  const dueTotal = total != null ? total - walletApplied : null;
  const selMethod = methods.find((m) => m.key === payMethod) ?? null;
  const selCard = payMethod === "card" && cardId ? cards.find((c) => c.id === cardId) ?? null : null;

  /** «إضافة بطاقة جديدة» — البيانات تذهب للبوابة (tokenize) ولا تُخزن لدينا */
  const submitCard = async () => {
    const [mm, yy] = expiry.split("/");
    setCardBusy(true);
    setCardError(null);
    try {
      const card = await api<SavedCard>("POST", "/v1/customers/me/cards", {
        card_number: pan.replace(/\s/g, ""),
        exp_month: Number(mm),
        exp_year: Number(yy),
        cvv,
        holder_name: holder.trim() || undefined,
        set_default: saveDefault
      });
      setCards((cs) => [card, ...cs.map((c) => (saveDefault ? { ...c, is_default: false } : c))]);
      setPayMethod("card");
      setCardId(card.id);
      setPan("");
      setExpiry("");
      setCvv("");
      setHolder("");
      setShowAddCard(false);
      setShowPay(false);
    } catch (e) {
      setCardError((e as Error).message);
    } finally {
      setCardBusy(false);
    }
  };

  const expiryValid = /^(0[1-9]|1[0-2])\/\d{2}$/.test(expiry);
  const cardFormValid = pan.replace(/\s/g, "").length >= 13 && expiryValid && /^\d{3,4}$/.test(cvv);

  useEffect(() => {
    api<Record<string, boolean>>("GET", "/v1/feature-flags")
      .then((f) => {
        setFlags(f);
        // محفظة بيكلي — الرصيد يظهر بمبدّل في تفاصيل الدفع (قرار المالك 2026-07-12)
        if (f["in_app_wallet"]) {
          api<WalletInfo>("GET", "/v1/customers/me/wallet")
            .then(setWallet)
            .catch(() => undefined);
        }
      })
      .catch(() => undefined); // الأعلام ميزة تكيف — الافتراضي إخفاء المؤجل
    // طرق الدفع الفعّالة بترتيب السوبر أدمن — الأولى هي الافتراضية
    api<PayMethod[]>("GET", "/v1/content/payment-methods")
      .then((ms) => {
        setMethods(ms);
        if (ms.length > 0) setPayMethod(ms[0].key);
      })
      .catch(() => undefined);
    // بطاقاتي المحفوظة — تظهر في «اختر طريقة الدفع»
    api<SavedCard[]>("GET", "/v1/customers/me/cards")
      .then(setCards)
      .catch(() => undefined);
    // كتالوج الماركات والموديلات — يغذي قوائم «أضف سيارة جديدة»
    api<VehicleCatalog>("GET", "/v1/vehicle-catalog")
      .then(setCatalog)
      .catch(() => undefined); // بلا كتالوج تبقى الإضافة بالكتابة الحرة
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

  /* ===== السيارة: بطاقة اللوحة السعودية + إضافة/تعديل من الكتالوج ===== */

  const makeEnOf = (make_ar: string | null): string | null =>
    make_ar ? catalog?.makes.find((mk) => mk.name_ar === make_ar)?.name_en ?? null : null;
  // المرادفات (بيضاء→أبيض…) لأن السيارات المسجّلة قبل قائمة الكتالوج لونها نص حر
  const colorHexOf = (name_ar: string): string => {
    const n = name_ar.trim();
    return catalog?.colors.find((c) => c.name_ar === n || c.aliases?.includes(n))?.hex ?? "var(--pk-gray)";
  };
  const modelsOfSel = catalog?.makes.find((mk) => mk.name_ar === makeSel)?.models ?? [];

  const effMake = makeSel === OTHER ? makeCustom.trim() : makeSel;
  const effModel = modelSel === OTHER ? modelCustom.trim() : modelSel;
  const formValid =
    color.length >= 2 &&
    plate.length >= 1 &&
    letters.length === 3 &&
    effMake.length >= 2 &&
    (modelSel !== OTHER || effModel.length >= 1);

  const resetForm = () => {
    setEditId(null);
    setMakeSel("");
    setMakeCustom("");
    setModelSel("");
    setModelCustom("");
    setColor("");
    setLetters("");
    setPlate("");
  };

  const openAdd = () => {
    resetForm();
    setShowAdd(true);
  };

  /** ضغط مطول على بطاقة اللوحة → تعديلها (البيانات معبأة مسبقاً) */
  const openEdit = (v: Vehicle) => {
    resetForm();
    setEditId(v.id);
    const known = catalog?.makes.some((mk) => mk.name_ar === v.make_ar);
    setMakeSel(v.make_ar ? (known ? v.make_ar : OTHER) : "");
    setMakeCustom(known ? "" : v.make_ar ?? "");
    const models = catalog?.makes.find((mk) => mk.name_ar === v.make_ar)?.models ?? [];
    const knownModel = models.some((md) => md.name_ar === v.model_ar);
    setModelSel(v.model_ar ? (knownModel ? v.model_ar : OTHER) : "");
    setModelCustom(knownModel ? "" : v.model_ar ?? "");
    setColor(v.color_ar);
    setLetters((v.plate_letters_ar ?? "").replace(/\s/g, ""));
    setPlate(v.plate_digits);
    setShowAdd(true);
  };

  /** ضغط مطول (لمس أو فأرة) — 450ms ثم فتح التعديل */
  const pressStart = (v: Vehicle) => {
    if (longPressTimer.current) window.clearTimeout(longPressTimer.current);
    longPressTimer.current = window.setTimeout(() => openEdit(v), 450);
  };
  const pressEnd = () => {
    if (longPressTimer.current) window.clearTimeout(longPressTimer.current);
    longPressTimer.current = null;
  };

  const saveVehicle = async () => {
    setBusy(true);
    setError(null);
    try {
      const payload = {
        make_ar: effMake || undefined,
        model_ar: effModel || undefined,
        color_ar: color,
        plate_digits: plate,
        plate_letters_ar: letters
      };
      if (editId) {
        const v = await api<Vehicle>("PATCH", `/v1/customers/me/vehicles/${editId}`, payload);
        setVehicles((vs) => (vs ?? []).map((x) => (x.id === v.id ? v : x)));
      } else {
        const v = await api<Vehicle>("POST", "/v1/customers/me/vehicles", payload);
        setVehicles((vs) => [...(vs ?? []), v]);
        setVehicleId(v.id);
      }
      setShowAdd(false);
      resetForm();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const deleteVehicle = async () => {
    if (!editId) return;
    setBusy(true);
    setError(null);
    try {
      await api("DELETE", `/v1/customers/me/vehicles/${editId}`);
      const rest = (vehicles ?? []).filter((v) => v.id !== editId);
      setVehicles(rest);
      if (vehicleId === editId) setVehicleId(rest[0]?.id ?? null);
      setShowAdd(false);
      resetForm();
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
      const intent = await api<{ amount_halalas: number; status: string }>(
        "POST",
        `/v1/orders/${order.id}/payment-intent`,
        {
          method: payMethod,
          use_wallet: walletOn,
          ...(payMethod === "card" && cardId ? { card_id: cardId } : {})
        },
        { idempotent: true }
      );
      // محفظة بيكلي غطت الطلب كاملاً → تفويض فوري بلا بوابة
      if (intent.status !== "authorized" && intent.amount_halalas > 0) {
        // بوابة sandbox — نفس مسار الإنتاج: النتيجة عبر webhook موقع
        const pay = await api<{ gateway_result: string }>(
          "POST",
          `/v1/dev/mock-gateway/by-order/${order.id}/pay`
        );
        if (pay.gateway_result !== "authorized") {
          setError("ما تمّ الدفع. جرّب بطاقة ثانية — طلبك محفوظ");
          return;
        }
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
          <div className={styles.confetti} aria-hidden="true">
            {CONFETTI.map((p, i) => (
              <i
                key={i}
                style={{ left: p.l, background: p.c, animationDelay: p.d, animationDuration: p.t }}
              />
            ))}
          </div>
          <div className={`${styles.bigic} ${styles.bigicPop}`}><CheckIcon /></div>
          <h1 className={styles.bigTitle}>يا هلا! طلبك انطلق 🎉</h1>
          <p className={styles.bigSub}>
            {donePickup === "scheduled" ? "محجوز لفترتك بنجاح" : "وصل للمطعم وينتظر القبول"}
          </p>
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

      {/* ===== طريقة الاستلام — السيارة (النطاق كله استلام من السيارة) ===== */}
      <div className={styles.sech}><h2>طريقة الاستلام</h2></div>
      <div className={styles.pmRow}>
        <span className={`${styles.pmChip} ${styles.pmChipOn}`}>
          <CarIcon size={20} />
          <span>السيارة</span>
        </span>
      </div>

      {/* بطاقات اللوحة السعودية: اختيار بالضغط · تعديل بالضغط المطول · ⊕ للإضافة */}
      {!vehicles && !error && <div className="pk-loader"><span /><span /><span /></div>}
      <div className={styles.vRow}>
        {vehicles?.map((v) => {
          const on = vehicleId === v.id;
          const makeEn = makeEnOf(v.make_ar);
          return (
            <label
              key={v.id}
              className={on ? `${styles.pWrap} ${styles.pWrapOn}` : styles.pWrap}
              onPointerDown={() => pressStart(v)}
              onPointerUp={pressEnd}
              onPointerLeave={pressEnd}
              title="اضغط مطولاً للتعديل"
            >
              <input
                type="radio"
                name="vehicle"
                className={styles.pRadio}
                checked={on}
                onChange={() => setVehicleId(v.id)}
                data-testid="vehicle-radio"
              />
              <span className={styles.pCard}>
                <span className={styles.pBand}>
                  <span className={styles.pBandPalm}>🌴</span>
                  <span className={styles.pBandAr}>السعودية</span>
                  <span className={styles.pBandEn}>K<br />S<br />A</span>
                  <span className={styles.pBandDot}>●</span>
                </span>
                <span className={styles.pMain}>
                  <span className={styles.pTop}>
                    {v.plate_letters_ar && <b className={styles.pLetters}>{v.plate_letters_ar}</b>}
                    <b className={styles.pDigits}>{v.plate_digits}</b>
                  </span>
                  <span className={styles.pBottom}>
                    {makeEn && <span className={styles.pBrand}>{makeEn}</span>}
                    {(v.model_ar ?? v.make_ar) && <span className={styles.pModel}>{v.model_ar ?? v.make_ar}</span>}
                    <span className={styles.pColorChip}>
                      <span className={styles.pColorDot} style={{ background: colorHexOf(v.color_ar) }} />
                      {v.color_ar}
                    </span>
                  </span>
                </span>
              </span>
            </label>
          );
        })}
        <button type="button" className={styles.vAdd} onClick={openAdd} aria-label="أضف سيارة جديدة" data-testid="veh-add">
          +
        </button>
      </div>
      {vehicles && vehicles.length > 0 && (
        <div className={styles.hintWrap}>
          <span className={styles.hintBar} />
          <span className={styles.hintTxt}>اضغط مطولاً للتعديل</span>
        </div>
      )}
      <p className={styles.privacy}>اللوحات مشفرة ولا تظهر كاملة إلا لموظف التسليم أثناء طلبك النشط فقط.</p>

      {/* ===== تفاصيل الدفع — الطريقة المختارة + «تغيير» يفتح الاختيار + مبدّل المحفظة ===== */}
      <div className={styles.sech}><h2>تفاصيل الدفع</h2></div>
      <div className={styles.card} style={{ padding: 0 }}>
        <button
          type="button"
          className={styles.paySel}
          data-testid="pay-method"
          onClick={() => setShowPay(true)}
        >
          <span className={styles.pmIcon}><MethodIcon k={payMethod} /></span>
          <span className={styles.paySelBody}>
            <b className={styles.optTitle}>
              {selCard
                ? `${BRAND_AR[selCard.brand]} •••• ${selCard.last4}`
                : selMethod?.name_ar ?? "طريقة الدفع"}
            </b>
            <span className={styles.optDesc}>{selCard?.holder_name ?? "طرق الدفع"}</span>
          </span>
          <span className={styles.changeLink}>تغيير</span>
        </button>
        {flags["in_app_wallet"] && wallet && (
          <div
            className={wallet.balance_halalas === 0 ? `${styles.walletRow} ${styles.walletOff}` : styles.walletRow}
            data-testid="wallet-row"
          >
            <span className={styles.walletIc}><WalletIcon /></span>
            <span className={styles.paySelBody}>
              <b className={styles.optTitle}>{fmtSar(wallet.balance_halalas)}</b>
              <span className={styles.optDesc}>استخدم رصيدك في محفظة بيكلي</span>
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={walletOn}
              aria-label="استخدام رصيد المحفظة"
              className={walletOn ? `${styles.sw} ${styles.swOn}` : styles.sw}
              disabled={wallet.balance_halalas === 0}
              onClick={() => setWalletOn((v) => !v)}
              data-testid="wallet-toggle"
            >
              <span className={styles.swKnob} />
            </button>
          </div>
        )}
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
              {walletApplied > 0 && (
                <>
                  <div className={`${styles.srow} ${styles.srowOk}`} data-testid="wallet-applied">
                    <span>من محفظة بيكلي</span>
                    <span className={styles.sv}>−{fmtSar(walletApplied)}</span>
                  </div>
                  <div className={`${styles.srow} ${styles.srowTot}`}>
                    <span>المتبقي للدفع</span>
                    <span className={styles.sv}>{fmtSar(dueTotal ?? 0)}</span>
                  </div>
                </>
              )}
              <p className={styles.srow} style={{ fontSize: 12, opacity: 0.7 }}>الأسعار شاملة ضريبة القيمة المضافة</p>
            </div>
          )}
          <div className={`${styles.note} ${styles.noteSoft}`}>
            <DocIcon />
            <span><b>سياسة الإلغاء:</b> مجاني قبل قبول الفرع · بعد بدء التحضير لا يُسترجع ثمن الطلب · رسوم الخدمة تُسترجع وفق المصفوفة.</span>
          </div>
        </>
      )}

      {/* ===== CTA الدفع — أسود بشعار Apple Pay عند اختياره، وإلا الزر الليموني الحيوي ===== */}
      <div className={styles.footbar}>
        {payMethod === "apple_pay" && (dueTotal ?? 1) > 0 ? (
          <button
            className={`${styles.payBtn} ${styles.appleBtn}`}
            data-testid="pay-button"
            disabled={busy || !vehicleId || !cartId || (pickupTime === "scheduled" && !slotId)}
            onClick={payAndOrder}
          >
            {busy ? (
              "جارٍ الدفع…"
            ) : (
              <>
                <span className={styles.apLogo} aria-label="ادفع عبر Apple Pay">
                  <AppleLogo size={17} color="currentColor" />
                  <span>Pay</span>
                </span>
                {dueTotal != null && <AnimatedSar halalas={dueTotal} className={styles.payAmt} />}
              </>
            )}
          </button>
        ) : (
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
                {walletOn && dueTotal === 0 ? "ادفع من المحفظة" : "ادفع الآن"}
                <span className={styles.ctaArrow} aria-hidden="true">
                  <span>←</span>
                  <span>←</span>
                  <span>←</span>
                </span>
              </span>
              <AnimatedSar halalas={dueTotal ?? total} className={styles.payAmt} />
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
        )}
      </div>

      {/* ===== Sheet «اختر طريقة الدفع» — القائمة من السوبر أدمن (payments.methods) ===== */}
      {showPay && (
        <div className={styles.dim}>
          <div className={styles.sheet} role="dialog" aria-label="اختر طريقة الدفع" data-testid="pay-sheet">
            <div className={styles.grab} />
            <div className={styles.sheetHead}>
              <h2>اختر طريقة الدفع</h2>
              <button className={styles.bk} onClick={() => setShowPay(false)} aria-label="إغلاق" data-testid="pay-sheet-close">
                <XIcon />
              </button>
            </div>
            <div className={`${styles.note} ${styles.noteSoft}`}>
              <ShieldIcon />
              <span>الدفع الإلكتروني مؤمن — Tokenization فقط، لا نخزن رقم بطاقتك أبداً.</span>
            </div>
            <div className={styles.paySechTitle}>خيارات الدفع</div>
            {methods.map((m) => {
              const on = payMethod === m.key && (m.key !== "card" || !cardId);
              return (
                <button
                  key={m.key}
                  type="button"
                  className={on ? `${styles.optCard} ${styles.optCardSel}` : styles.optCard}
                  data-testid={`pay-opt-${m.key}`}
                  onClick={() => {
                    setPayMethod(m.key);
                    setCardId(null);
                    setShowPay(false);
                  }}
                >
                  <span className={on ? `${styles.rdot} ${styles.rdotOn}` : styles.rdot} />
                  <div className={styles.optBody}>
                    <b className={styles.optTitle}>
                      {m.name_ar}
                      {m.badge_ar && <span className={`${styles.badge} ${styles.badgeLime}`} style={{ marginInlineStart: 6 }}>{m.badge_ar}</span>}
                    </b>
                    {m.desc_ar && <div className={styles.optDesc}>{m.desc_ar}</div>}
                    {m.key === "card" && <CardNetworks />}
                  </div>
                  <span className={styles.pmIcon}><MethodIcon k={m.key} /></span>
                </button>
              );
            })}
            {methods.length === 0 && (
              <div className={`${styles.note} ${styles.noteErr}`}>لا طرق دفع مفعلة حالياً — جرّب لاحقاً</div>
            )}

            {/* ===== بطاقاتي — Tokenization فقط: نعرض الشبكة وآخر 4 أرقام ===== */}
            {methods.some((m) => m.key === "card") && (
              <>
                <div className={styles.paySechTitle}>بطاقاتي</div>
                {cards.map((c) => {
                  const on = payMethod === "card" && cardId === c.id;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      className={`${on ? `${styles.optCard} ${styles.optCardSel}` : styles.optCard}${c.expired ? ` ${styles.optCardDis}` : ""}`}
                      data-testid="saved-card"
                      disabled={c.expired}
                      onClick={() => {
                        setPayMethod("card");
                        setCardId(c.id);
                        setShowPay(false);
                      }}
                    >
                      <span className={on ? `${styles.rdot} ${styles.rdotOn}` : styles.rdot} />
                      <div className={styles.optBody}>
                        <b className={styles.optTitle}>{c.holder_name ?? `${BRAND_AR[c.brand]} •••• ${c.last4}`}</b>
                        <div className={styles.optDesc}>
                          {BRAND_AR[c.brand]} •••• {c.last4} ·{" "}
                          {c.expired ? (
                            <span className={styles.expired}>منتهية الصلاحية</span>
                          ) : (
                            `تنتهي ${String(c.exp_month).padStart(2, "0")}/${String(c.exp_year).slice(-2)}`
                          )}
                          {c.is_default && !c.expired && " · الأساسية"}
                        </div>
                      </div>
                      <span className={styles.pmIcon}>
                        <span className={styles.net}>{BRAND_AR[c.brand]}</span>
                      </span>
                    </button>
                  );
                })}
                <button
                  type="button"
                  className={styles.optCard}
                  data-testid="add-card"
                  onClick={() => {
                    setCardError(null);
                    setShowAddCard(true);
                  }}
                >
                  <span className={styles.addPlus}>+</span>
                  <div className={styles.optBody}>
                    <b className={styles.optTitle}>إضافة بطاقة جديدة</b>
                    <div className={styles.optDesc}>احفظ وادفع عبر البطاقة</div>
                  </div>
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* ===== Sheet «إضافة بطاقة جديدة» — البيانات للبوابة فقط (Tokenization) ===== */}
      {showAddCard && (
        <div className={styles.dim}>
          <div className={styles.sheet} role="dialog" aria-label="إضافة بطاقة جديدة" data-testid="add-card-sheet">
            <div className={styles.grab} />
            <div className={styles.sheetHead}>
              <h2>إضافة بطاقة جديدة</h2>
              <button className={styles.bk} onClick={() => setShowAddCard(false)} aria-label="إغلاق">
                <XIcon />
              </button>
            </div>
            <div className={styles.netsCenter}><CardNetworks /></div>
            {cardError && <div className={`${styles.note} ${styles.noteErr}`} data-testid="card-error">{cardError}</div>}

            <input
              className={`${styles.inp} ${styles.panInp}`}
              data-testid="card-number"
              inputMode="numeric"
              dir="ltr"
              placeholder="يُرجى إدخال رقم البطاقة المصرفية"
              value={pan}
              onChange={(e) => setPan(formatPan(e.target.value))}
            />
            <div className={styles.plateRow}>
              <input
                className={styles.inp}
                data-testid="card-expiry"
                inputMode="numeric"
                dir="ltr"
                maxLength={5}
                placeholder="الشهر/السنة MM/YY"
                value={expiry}
                onChange={(e) => {
                  const d = e.target.value.replace(/\D/g, "").slice(0, 4);
                  setExpiry(d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d);
                }}
              />
              <input
                className={styles.inp}
                data-testid="card-cvv"
                inputMode="numeric"
                dir="ltr"
                maxLength={4}
                placeholder="CVV/CVC"
                value={cvv}
                onChange={(e) => setCvv(e.target.value.replace(/\D/g, "").slice(0, 4))}
              />
            </div>
            <input
              className={styles.inp}
              data-testid="card-holder"
              placeholder="يُرجى إدخال الاسم الموجود على البطاقة"
              value={holder}
              onChange={(e) => setHolder(e.target.value)}
            />
            <div className={styles.walletRow} style={{ borderTop: "none", padding: "4px 2px" }}>
              <span className={styles.paySelBody}>
                <b className={styles.optTitle}>حفظ كطريقة الدفع الأساسية</b>
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={saveDefault}
                className={saveDefault ? `${styles.sw} ${styles.swOn}` : styles.sw}
                onClick={() => setSaveDefault((v) => !v)}
              >
                <span className={styles.swKnob} />
              </button>
            </div>

            {/* ضمانات الأمان — Tokenization (docs/17) */}
            <div className={styles.assure}>
              <b className={styles.assureTitle}>✓ تحمي بيكلي معلومات بطاقتك</b>
              <span>✓ رقم البطاقة وCVV يمران لبوابة الدفع مباشرة — لا نخزنهما أبداً (Tokenization).</span>
              <span>✓ معلومات البطاقة آمنة، ولن تتم مشاركتها مع أي طرف.</span>
              <span>✓ جميع البيانات مشفّرة وفق معيار أمان بطاقات الدفع (PCI DSS) لدى البوابة.</span>
              <span>✓ في حال حدوث عملية تفويض مسبق، سيتم إعادة المبلغ على الفور.</span>
            </div>

            <button
              className={`${styles.payBtn} ${styles.payBtnCenter}`}
              data-testid="card-save"
              disabled={cardBusy || !cardFormValid}
              onClick={() => void submitCard()}
            >
              {cardBusy ? "جارٍ الحفظ…" : "تأكيد"}
            </button>
          </div>
        </div>
      )}

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

      {/* ===== Sheet «أضف سيارة جديدة» — قوائم من كتالوج السيارات + لوحة (حروف + أرقام) ===== */}
      {showAdd && (
        <div className={styles.dim}>
          <div className={styles.sheet} role="dialog" aria-label={editId ? "تعديل السيارة" : "أضف سيارة جديدة"}>
            <div className={styles.grab} />
            <div className={styles.sheetHead}>
              <h2>{editId ? "تعديل السيارة" : "أضف سيارة جديدة"}</h2>
              {(editId || (vehicles && vehicles.length > 0)) && (
                <button className={styles.bk} onClick={() => setShowAdd(false)} aria-label="إغلاق"><XIcon /></button>
              )}
            </div>
            {errorNote}

            {/* ماركة السيارة */}
            <div className={styles.fld}>
              <select
                className={styles.selInp}
                data-testid="veh-make"
                value={makeSel}
                onChange={(e) => {
                  setMakeSel(e.target.value);
                  setModelSel("");
                  setModelCustom("");
                }}
              >
                <option value="" disabled>ماركة السيارة</option>
                {(catalog?.makes ?? []).map((mk) => (
                  <option key={mk.key} value={mk.name_ar}>{mk.name_ar}</option>
                ))}
                <option value={OTHER}>{OTHER}</option>
              </select>
            </div>
            {makeSel === OTHER && (
              <input
                className={styles.inp}
                placeholder="اكتب الماركة"
                value={makeCustom}
                onChange={(e) => setMakeCustom(e.target.value)}
              />
            )}

            {/* رقم لوحة السيارة: أرقام + حروف */}
            <div className={styles.plateRow}>
              <input
                className={`${styles.inp} ${styles.inpPlate}`}
                data-testid="veh-plate"
                inputMode="numeric"
                maxLength={4}
                placeholder="أرقام اللوحة"
                value={plate}
                onChange={(e) => setPlate(e.target.value.replace(/\D/g, "").slice(0, 4))}
              />
              <input
                className={styles.inp}
                data-testid="veh-letters"
                maxLength={5}
                placeholder="حروف اللوحة (3 أحرف)"
                style={{ textAlign: "center" }}
                value={letters.split("").join(" ")}
                onChange={(e) => setLetters(e.target.value.replace(/[^ء-ي]/g, "").slice(0, 3))}
              />
            </div>

            {/* لون السيارة */}
            <div className={styles.fld}>
              <div className={styles.colorSelWrap}>
                {color && <span className={styles.pColorDot} style={{ background: colorHexOf(color) }} />}
                <select
                  className={styles.selInp}
                  data-testid="veh-color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                >
                  <option value="" disabled>لون السيارة</option>
                  {(catalog?.colors ?? []).map((c) => (
                    <option key={c.name_ar} value={c.name_ar}>{c.name_ar}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* نوع السيارة (الموديل) — يعتمد على الماركة */}
            <div className={styles.fld}>
              <select
                className={styles.selInp}
                data-testid="veh-model"
                value={modelSel}
                disabled={!makeSel}
                onChange={(e) => setModelSel(e.target.value)}
              >
                <option value="" disabled>نوع السيارة</option>
                {modelsOfSel.map((md) => (
                  <option key={md.name_ar} value={md.name_ar}>{md.name_ar}</option>
                ))}
                <option value={OTHER}>{OTHER}</option>
              </select>
            </div>
            {modelSel === OTHER && (
              <input
                className={styles.inp}
                placeholder="اكتب نوع السيارة"
                value={modelCustom}
                onChange={(e) => setModelCustom(e.target.value)}
              />
            )}

            {/* البلد — KSA ثابتة */}
            <div className={styles.fld}>
              <select className={styles.selInp} value="KSA" disabled>
                <option value="KSA">KSA — السعودية</option>
              </select>
            </div>

            <div className={`${styles.note} ${styles.noteInfo}`}>
              <ShieldIcon size={17} />
              <span><b>خصوصيتك:</b> اللوحة تُشفَّر ولا تُعرض كاملة أبداً خارج طلبك التشغيلي.</span>
            </div>
            <button
              className={`${styles.payBtn} ${styles.payBtnCenter}`}
              data-testid="veh-save"
              disabled={busy || !formValid}
              onClick={saveVehicle}
            >
              {busy ? "جارٍ الحفظ…" : "حفظ"}
            </button>
            {editId && (
              <button type="button" className={styles.delVeh} disabled={busy} onClick={deleteVehicle} data-testid="veh-delete">
                حذف السيارة
              </button>
            )}
          </div>
        </div>
      )}
        </>
      )}
    </main>
  );
}
