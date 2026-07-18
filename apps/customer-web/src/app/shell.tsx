"use client";

/**
 * أجزاء مشتركة بين الرئيسية (الاستكشاف C-09) وقائمة المطاعم (/restaurants):
 * الأيقونات الخطية + رأس التطبيق (موقع + جرس C-62 + بحث C-11/C-12) + التبويب السفلي
 * + hook الفروع القريبة. المرجع: design/customer/P3.html — الألوان من tokens.css حصراً.
 */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { api, fmtSar, getToken } from "@/lib/api";
import { cacheRead, cacheWrite } from "@/lib/cache";
import { useApi, useIsoLayout } from "@/lib/use-api";
import { Qirtas, QirtasBadge } from "./qirtas";
import { QirtasLive } from "./qirtas-motion";
import styles from "./page.module.css";

export interface BranchCard {
  id: string;
  brand_id: string;
  brand_name_ar: string;
  cuisine_ar: string | null;
  logo_url: string | null;
  cover_url: string | null;
  status: string;
  distance_meters: number | null;
  eta_minutes: number | null;
  min_order_halalas: number | null;
  address_short: string;
  busy_message: string | null;
}

export interface SearchResults {
  branches: BranchCard[];
  products: Array<{
    id: string;
    branch_id: string;
    brand_name_ar: string;
    name_ar: string;
    price_halalas: number;
  }>;
}

interface NotifList {
  notifications: Array<{
    id: string;
    order_id: string | null;
    title_ar: string;
    body_ar: string;
    read: boolean;
    created_at: string;
  }>;
  unread_count: number;
}

export const RIYADH = { lat: 24.7, lng: 46.68 };

/* ===== أيقونات خطية من رموز P3.html ===== */
export function Icon({
  size = 13,
  sw = 7,
  children
}: {
  size?: number;
  sw?: number;
  children: React.ReactNode;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      stroke="currentColor"
      strokeWidth={sw}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      {children}
    </svg>
  );
}
export const IPin = ({ size = 13 }: { size?: number }) => (
  <Icon size={size}>
    <path d="M50,14 C36,14 26,24 26,38 C26,54 50,84 50,84 C50,84 74,54 74,38 C74,24 64,14 50,14 Z" />
    <circle cx="50" cy="37" r="6" fill="currentColor" stroke="none" />
  </Icon>
);
export const ICar = ({ size = 13 }: { size?: number }) => (
  <Icon size={size}>
    <path d="M30,56 Q35,40 50,40 Q65,40 70,56" />
    <rect x="18" y="54" width="64" height="18" rx="9" />
    <circle cx="34" cy="78" r="6" strokeWidth="6" />
    <circle cx="66" cy="78" r="6" strokeWidth="6" />
  </Icon>
);
export const ISearch = ({ size = 15 }: { size?: number }) => (
  <Icon size={size}>
    <circle cx="44" cy="44" r="24" />
    <path d="M62,62 L82,82" />
  </Icon>
);
export const IBell = ({ size = 18 }: { size?: number }) => (
  <Icon size={size}>
    <path d="M50,18 C36,18 30,28 30,40 C30,58 24,64 22,68 H78 C76,64 70,58 70,40 C70,28 64,18 50,18 Z" />
    <path d="M42,78 C44,84 56,84 58,78" />
  </Icon>
);
export const IStore = ({ size = 32 }: { size?: number }) => (
  <Icon size={size}>
    <path d="M22,42 V80 H78 V42" />
    <path d="M16,42 L24,20 H76 L84,42 C84,48 78,52 73,52 C68,52 64,48 64,44 C64,48 60,52 55,52 C50,52 46,48 46,44 C46,48 42,52 37,52 C32,52 28,48 28,44 C28,48 24,52 19,52 C16,52 16,46 16,42 Z" />
    <path d="M40,80 V62 H60 V80" />
  </Icon>
);
export const IAlert = ({ size = 18 }: { size?: number }) => (
  <Icon size={size}>
    <path d="M50,16 L88,80 H12 Z" />
    <path d="M50,42 V60" />
    <circle cx="50" cy="70" r="1.5" fill="currentColor" strokeWidth="5" />
  </Icon>
);
export const IHome = () => (
  <Icon size={21}>
    <path d="M20,50 L50,22 L80,50" />
    <path d="M30,46 V78 H70 V46" />
  </Icon>
);
export const ITag = () => (
  <Icon size={21}>
    <path d="M18,50 L50,18 L82,18 L82,50 L50,82 Z" />
    <circle cx="66" cy="34" r="6" fill="currentColor" stroke="none" />
  </Icon>
);
export const IReceipt = () => (
  <Icon size={21}>
    <path d="M30,16 H70 V84 L62,78 L54,84 L46,78 L38,84 L30,78 Z" />
    <path d="M40,36 H60 M40,50 H60" />
  </Icon>
);
export const IHeart = () => (
  <Icon size={21}>
    <path d="M50,80 C20,60 14,40 26,28 C36,18 50,26 50,36 C50,26 64,18 74,28 C86,40 80,60 50,80 Z" />
  </Icon>
);
export const IUser = () => (
  <Icon size={21}>
    <circle cx="50" cy="36" r="16" />
    <path d="M22,82 C26,64 38,58 50,58 C62,58 74,64 78,82" />
  </Icon>
);
/* أيقونات تصنيفات المطاعم (C-09) — خطية بنفس أسلوب P3 */
export const IBurger = ({ size = 26 }: { size?: number }) => (
  <Icon size={size} sw={6}>
    <path d="M22,42 C22,26 36,18 50,18 C64,18 78,26 78,42 Z" />
    <path d="M20,52 H80" />
    <path d="M22,62 C22,74 32,80 50,80 C68,80 78,74 78,62 Z" />
  </Icon>
);
export const IWrap = ({ size = 26 }: { size?: number }) => (
  <Icon size={size} sw={6}>
    <path d="M30,22 C48,14 66,20 70,34 L46,84 C36,86 26,80 24,70 Z" />
    <path d="M42,30 Q52,36 48,48" />
    <path d="M70,34 L78,26" />
  </Icon>
);
export const ICup = ({ size = 26 }: { size?: number }) => (
  <Icon size={size} sw={6}>
    <path d="M28,30 H68 L62,82 H34 Z" />
    <path d="M68,36 C80,36 82,52 66,54" />
    <path d="M30,44 H66" />
  </Icon>
);
export const IPizza = ({ size = 26 }: { size?: number }) => (
  <Icon size={size} sw={6}>
    <path d="M18,30 C40,18 60,18 82,30 L50,84 Z" />
    <circle cx="44" cy="42" r="4" fill="currentColor" stroke="none" />
    <circle cx="58" cy="52" r="4" fill="currentColor" stroke="none" />
    <circle cx="46" cy="62" r="4" fill="currentColor" stroke="none" />
  </Icon>
);

/** أيقونة التصنيف حسب اسمه — سقوط لأيقونة المتجر */
export function cuisineIcon(name: string, size = 26): React.ReactNode {
  if (name.includes("برجر")) return <IBurger size={size} />;
  if (name.includes("شاورما")) return <IWrap size={size} />;
  if (name.includes("مقهى") || name.includes("قهوة")) return <ICup size={size} />;
  if (name.includes("بيتزا")) return <IPizza size={size} />;
  return <IStore size={size} />;
}

/** أيقونات التصنيفات ثلاثية الأبعاد المعتمدة من المالك (public/cats) — بأسمائها في قائمة السوبر أدمن حرفياً */
const CUISINE_PHOTOS: Record<string, string> = {
  "برجر": "/cats/burger.jpg",
  "دجاج": "/cats/chicken.jpg",
  "مندي ومظبي": "/cats/mandi.jpg",
  "بيتزا": "/cats/pizza.jpg",
  "ساندوتشات": "/cats/sandwich.jpg",
  "سوشي": "/cats/sushi.jpg",
  "باستا": "/cats/pasta.jpg",
  "سلطات": "/cats/salad.jpg",
  "مقبلات": "/cats/appetizers.jpg",
  "بطاطس": "/cats/fries.jpg",
  "راب": "/cats/wrap.jpg",
  "بحري": "/cats/seafood.jpg",
  "حلويات": "/cats/dessert.jpg",
  "مشروبات": "/cats/drinks.jpg",
  "عصائر طازجة": "/cats/juice.jpg",
  "مشروبات ساخنة": "/cats/hotdrinks.jpg",
  "فطور": "/cats/breakfast.jpg",
  "وجبات أطفال": "/cats/kids.jpg",
};

/** صورة التصنيف حسب اسمه — مطابقة حرفية ثم احتواء (أسماء قديمة/مشتقة) وسقوط لصورة المتجر العام */
export function cuisinePhoto(name: string): string {
  const exact = CUISINE_PHOTOS[name.trim()];
  if (exact) return exact;
  if (name.includes("برجر")) return "/cats/burger.jpg";
  if (name.includes("شاورما") || name.includes("راب")) return "/cats/wrap.jpg";
  if (name.includes("مقهى") || name.includes("قهوة")) return "/cats/hotdrinks.jpg";
  if (name.includes("بيتزا")) return "/cats/pizza.jpg";
  if (name.includes("عصائر") || name.includes("عصير")) return "/cats/juice.jpg";
  if (name.includes("صيدلي")) return "/cats/pharmacy.jpg";
  return "/cats/store.jpg";
}

/* حالة الفرع → شارة على صورة البطاقة (كما في rcard بالتصميم) */
export function statusBadge(status: string): { label: string; cls: string } {
  if (status === "open") return { label: "مفتوح", cls: styles.stOpen };
  if (status === "busy") return { label: "ازدحام", cls: styles.stBusy };
  return { label: "مغلق", cls: styles.stClosed };
}

/** آخر نتيجة «قريب منك» كاملة — تُعرض فوراً عند كل انتقال ثم تُجدَّد بالخلفية */
interface NearbySnapshot {
  list: BranchCard[];
  label: string;
  coords: { lat: number; lng: number };
}
const NEARBY_KEY = "nearby:last";

/** مسافة تقريبية بالمتر (مستوية) — تكفي لقرار «هل ابتعد المستخدم عن موقع الجلب؟» */
function distMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = (a.lat - b.lat) * 111_000;
  const dLng = (a.lng - b.lng) * 111_000 * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot(dLat, dLng);
}

/**
 * الفروع القريبة + الموقع — الموقع ميزة تحسين لا شرط (docs/14§8).
 * تحديد الموقع خارج المسار الحرج: نجلب فوراً بآخر موقع معروف (أو الرياض)
 * ونعيد الجلب فقط إن تبيّن أن المستخدم ابتعد عنه — لا انتظار يحجب القائمة.
 */
export function useNearby(): {
  branches: BranchCard[] | null;
  error: string | null;
  locLabel: string;
  coords: { lat: number; lng: number };
} {
  const [state, setState] = useState<{
    branches: BranchCard[] | null;
    error: string | null;
    locLabel: string;
    coords: { lat: number; lng: number };
  }>({ branches: null, error: null, locLabel: "الرياض", coords: RIYADH });

  // آخر نتيجة معروفة قبل أول رسم — الانتقال بين الصفحات لا يمر بالهيكل العظمي
  useIsoLayout(() => {
    const snap = cacheRead<NearbySnapshot>(NEARBY_KEY);
    if (snap) setState({ branches: snap.list, error: null, locLabel: snap.label, coords: snap.coords });
  }, []);

  useEffect(() => {
    let alive = true;
    const fetchAt = (lat: number, lng: number) =>
      api<BranchCard[]>("GET", `/v1/branches/nearby?lat=${lat}&lng=${lng}&radius=30000`);

    // عرض تجريبي: مطاعم البيانات في الرياض/جدة/الدمام فقط. إن كان موقعك الحقيقي
    // بعيداً عنها (لا مطاعم ضمن النطاق) نسقط تلقائياً على الرياض كي لا تفرغ القائمة —
    // ويبقى موقعك الحقيقي فعّالاً لخريطة التتبع وبوابة الوصول.
    const load = async (at: { lat: number; lng: number }, label: string, real: boolean) => {
      try {
        let list = await fetchAt(at.lat, at.lng);
        let lbl = label;
        if (real && list.length === 0) {
          list = await fetchAt(RIYADH.lat, RIYADH.lng);
          lbl = "الرياض (عرض)";
        }
        if (!alive) return;
        cacheWrite<NearbySnapshot>(NEARBY_KEY, { list, label: lbl, coords: at });
        setState({ branches: list, error: null, locLabel: lbl, coords: at });
      } catch (e) {
        if (alive && cacheRead(NEARBY_KEY) === undefined) {
          setState((s) => ({ ...s, error: (e as Error).message }));
        }
      }
    };

    const snap = cacheRead<NearbySnapshot>(NEARBY_KEY);
    const start = snap?.coords ?? RIYADH;
    void load(start, snap?.label ?? "الرياض", snap !== undefined && snap.label !== "الرياض");

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          if (!alive) return;
          const here = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          if (distMeters(here, start) > 2000) {
            void load(here, "موقعك الحالي", true);
          } else {
            // لم يبتعد — القائمة صالحة؛ سقوط العرض «الرياض (عرض)» يحتفظ بتسميته الصادقة
            setState((s) => ({
              ...s,
              coords: here,
              locLabel: s.locLabel === "الرياض (عرض)" ? s.locLabel : "موقعك الحالي"
            }));
          }
        },
        () => undefined,
        { timeout: 5000, maximumAge: 300_000 }
      );
    }
    return () => {
      alive = false;
    };
  }, []);

  return state;
}

/** أفضل إحداثيات معروفة فوراً (آخر جلب أو الرياض) مع تصحيح خلفي من تحديد الموقع */
export function useCoords(): { lat: number; lng: number } {
  const [coords, setCoords] = useState(RIYADH);

  useIsoLayout(() => {
    const snap = cacheRead<NearbySnapshot>(NEARBY_KEY);
    if (snap) setCoords(snap.coords);
  }, []);

  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const here = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setCoords((c) => (distMeters(here, c) > 2000 ? here : c));
      },
      () => undefined,
      { timeout: 5000, maximumAge: 300_000 }
    );
  }, []);

  return coords;
}

/**
 * تصنيفات C-09 مرتبةً: قائمة السوبر أدمن (cms.categories) إن وُجدت — بعدد المطاعم القريبة
 * لكل تصنيف (وقد يكون صفراً)؛ وإلا تُشتق من مطابخ الفروع القريبة.
 * image: صورة اللوحة إن رفعها الأدمن — null تسقط لأيقونة cuisinePhoto حسب الاسم.
 */
export function useCategories(
  branches: BranchCard[] | null
): Array<{ name: string; count: number; image: string | null }> | null {
  const { data, error } = useApi<Array<{ name_ar: string; image_url?: string | null }>>("/v1/content/categories");
  // ميزة تحسين — فشل القائمة يسقط للاشتقاق التلقائي من الفروع القريبة
  const adminCats = data
    ? data.map((c) => ({ name: c.name_ar, image: c.image_url ?? null }))
    : error !== null
      ? []
      : null;

  if (branches === null || adminCats === null) return null;

  const counts = new Map<string, number>();
  for (const b of branches) {
    if (b.cuisine_ar) counts.set(b.cuisine_ar, (counts.get(b.cuisine_ar) ?? 0) + 1);
  }
  if (adminCats.length > 0) {
    return adminCats.map(({ name, image }) => ({ name, image, count: counts.get(name) ?? 0 }));
  }
  return [...counts.entries()].map(([name, count]) => ({ name, count, image: null }));
}

/** رأس التطبيق: موقع الاستلام + جرس C-62 + بحث C-11/C-12 بنتائجه */
export function AppHead({ locLabel, coords }: { locLabel: string; coords: { lat: number; lng: number } }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResults | null>(null);
  const [showNotifs, setShowNotifs] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // تُقرأ بعد التركيب فقط — لا فرق ترطيب بين الخادم والعميل
  const [loggedIn, setLoggedIn] = useState(false);
  useEffect(() => setLoggedIn(Boolean(getToken())), []);

  // شارة غير المقروء — الجرس ميزة تحسين، وخطؤه مُهمل عبر useApi (لا نُفشل الصفحة)
  const { data: notifs, mutate: mutateNotifs } = useApi<NotifList>(
    loggedIn ? "/v1/customers/me/notifications" : null
  );

  // بحث C-11 بتهدئة 300ms — التسعير والنتائج من الخادم حصراً
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const term = q.trim();
    if (term.length < 2) {
      setResults(null);
      return;
    }
    searchTimer.current = setTimeout(() => {
      api<SearchResults>(
        "GET",
        `/v1/search?q=${encodeURIComponent(term)}&lat=${coords.lat}&lng=${coords.lng}`
      )
        .then(setResults)
        .catch(() => setResults(null));
    }, 300);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [q, coords]);

  const toggleNotifs = () => {
    const next = !showNotifs;
    setShowNotifs(next);
    if (next && notifs && notifs.unread_count > 0) {
      // فتح الصندوق يعلّم الكل مقروءاً (opened في notification_deliveries)
      void api("POST", "/v1/customers/me/notifications/read", {}).then(() =>
        mutateNotifs((n) =>
          n ? { unread_count: 0, notifications: n.notifications.map((x) => ({ ...x, read: true })) } : n
        )
      );
    }
  };

  return (
    <header className={styles.apphead} style={{ position: "relative" }}>
      <div className={styles.loc}>
        {/* شارة القرطاس المصغّرة — 30px كما في نموذج الرئيسية */}
        <QirtasBadge size={30} style={{ flexShrink: 0 }} />
        <span style={{ color: "var(--pk-ink-900)", display: "inline-flex" }}>
          <IPin size={17} />
        </span>
        <div>
          <div className={styles.locLb}>الاستلام قرب</div>
          <b>{locLabel}</b>
        </div>
        {loggedIn ? (
          <button
            type="button"
            className={
              notifs !== null && notifs.unread_count > 0
                ? `${styles.bell} ${styles.bellRing}`
                : styles.bell
            }
            style={{ cursor: "pointer" }}
            onClick={toggleNotifs}
            aria-label="الإشعارات"
            data-testid="notif-bell"
          >
            <IBell />
            {notifs !== null && notifs.unread_count > 0 && (
              <span className={styles.bellDot} data-testid="notif-unread">{notifs.unread_count}</span>
            )}
          </button>
        ) : (
          <Link href="/auth" className={styles.bell} aria-label="الإشعارات — سجّل دخولك" title="سجّل دخولك لرؤية إشعاراتك">
            <IBell />
          </Link>
        )}
      </div>
      {/* بحث C-11/C-12 — النتائج من GET /v1/search */}
      <div className={styles.search}>
        <ISearch />
        <input
          className={styles.searchInput}
          placeholder="ابحث عن مطعم، منتج، تصنيف…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          data-testid="home-search"
        />
      </div>

      {showNotifs && notifs && (
        <div className={styles.notifPanel} data-testid="notif-panel">
          {notifs.notifications.length === 0 && (
            <div className={styles.notifEmpty}>لا إشعارات بعد — نخبرك أولاً بأول عن طلباتك</div>
          )}
          {notifs.notifications.map((n) => (
            <div key={n.id} className={n.read ? styles.notifRow : `${styles.notifRow} ${styles.unread}`}>
              <b>{n.title_ar}</b>
              {n.body_ar}
              <div>
                <span className={styles.notifTime}>{new Date(n.created_at).toLocaleString("en-GB", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
                {n.order_id && (
                  <Link href={`/track/${n.order_id}`} style={{ marginInlineStart: 10, fontSize: 12 }}>
                    عرض الطلب ←
                  </Link>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {results && !showNotifs && (
        <div className={styles.searchResults} data-testid="search-results">
          {results.branches.length === 0 && results.products.length === 0 && (
            <div className={styles.notifEmpty}>
              <Qirtas mood="sad" size={64} />
              <div>لا نتائج لـ«{q.trim()}» — جرّب كلمة أخرى</div>
            </div>
          )}
          {results.branches.length > 0 && <div className={styles.searchHint}>مطاعم</div>}
          {results.branches.map((b) => (
            <Link key={b.id} href={`/r/${b.id}`} className={styles.searchRow} data-testid="search-branch">
              <IStore size={18} />
              <span>
                {b.brand_name_ar}
                {b.address_short ? ` — ${b.address_short}` : ""}
              </span>
              {b.distance_meters !== null && <span className={styles.price}>{(b.distance_meters / 1000).toFixed(1)} كم</span>}
            </Link>
          ))}
          {results.products.length > 0 && <div className={styles.searchHint}>منتجات</div>}
          {results.products.map((p) => (
            <Link key={p.id} href={`/r/${p.branch_id}`} className={styles.searchRow} data-testid="search-product">
              <ITag />
              <span>
                {p.name_ar} <span style={{ color: "var(--pk-text-2)" }}>· {p.brand_name_ar}</span>
              </span>
              <span className={styles.price}>{fmtSar(p.price_halalas)}</span>
            </Link>
          ))}
        </div>
      )}
    </header>
  );
}

/** التنقل السفلي — التبويبات الخمس فعّالة، وتبويب «طلباتي» شارة القرطاس المرتفعة (لوحة العرض) */
export function TabBar() {
  const path = usePathname();
  const cls = (on: boolean) => (on ? `${styles.tab} ${styles.tabOn}` : styles.tab);
  const ordersOn = path.startsWith("/orders") || path.startsWith("/track");
  return (
    <nav className={styles.tabbar}>
      <Link href="/" className={cls(path === "/" || path.startsWith("/restaurants") || path.startsWith("/r/"))}>
        <IHome />
        الرئيسية
      </Link>
      <Link href="/offers" className={cls(path.startsWith("/offers"))} data-testid="nav-offers">
        <ITag />
        العروض
      </Link>
      <Link href="/orders" className={cls(ordersOn)} data-testid="nav-orders">
        <span className={ordersOn ? `${styles.tabQirtas} ${styles.tabQirtasOn}` : styles.tabQirtas}>
          <QirtasBadge size={34} mood={ordersOn ? "excited" : "happy"} />
        </span>
        طلباتي
      </Link>
      <Link href="/favorites" className={cls(path.startsWith("/favorites"))} data-testid="nav-favorites">
        <IHeart />
        المفضلة
      </Link>
      <Link href="/account" className={cls(path.startsWith("/account"))} data-testid="nav-auth">
        <IUser />
        حسابي
      </Link>
    </nav>
  );
}

/** رأس صفحة داخلية موحّد + دعوة تسجيل الدخول للزائر — القرطاس يلوّح مرحّباً */
export function GuestGate({ next, message }: { next: string; message: string }) {
  return (
    <div className={`${styles.empty} pk-in`}>
      <QirtasLive pose="wave" size={104} style={{ marginBottom: 8 }} />
      <b>سجّل دخولك أولاً</b>
      <p>{message}</p>
      <Link href={`/auth?next=${encodeURIComponent(next)}`} className={styles.gateBtn} data-testid="gate-login">
        تسجيل الدخول
      </Link>
    </div>
  );
}

/** بطاقة مطعم (rcard) — الصورة مربع جانبي بجوار الاسم (وليست غلافاً فوقه) · i لتدرّج الظهور */
export function RestaurantCard({ b, i = 0 }: { b: BranchCard; i?: number }) {
  const st = statusBadge(b.status);
  return (
    <Link
      href={`/r/${b.id}`}
      className={`${styles.rcard} pk-in`}
      style={{ animationDelay: `${Math.min(i, 7) * 70}ms` }}
      data-testid="branch-card"
    >
      {/* RTL: النص أولاً (يمين) والصورة بجانبه (يسار) */}
      <div className={styles.bd}>
        <div className={styles.nm}>
          <b>
            {b.brand_name_ar}
            {b.address_short ? ` — ${b.address_short}` : ""}
          </b>
        </div>
        <div className={styles.metaR}>
          {b.cuisine_ar && <span>{b.cuisine_ar}</span>}
          {b.distance_meters !== null && (
            <span>
              <IPin /> {(b.distance_meters / 1000).toFixed(1)} كم
            </span>
          )}
          {b.eta_minutes !== null && (
            <span>
              <ICar /> قيادة {b.eta_minutes} د
            </span>
          )}
        </div>
        <div className={styles.carLine}>
          <ICar size={15} /> يصل طلبك إلى سيارتك
        </div>
        {b.busy_message && (
          <div className={styles.busyLine}>
            <IAlert size={15} /> {b.busy_message}
          </div>
        )}
      </div>
      <div className={styles.img}>
        {b.cover_url || b.logo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={b.cover_url ?? b.logo_url ?? ""} alt="" className={styles.imgCover} />
        ) : (
          <IStore size={40} />
        )}
        <span className={`${styles.stBadge} ${st.cls}`}>{st.label}</span>
      </div>
    </Link>
  );
}
