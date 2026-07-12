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
import styles from "./page.module.css";

export interface BranchCard {
  id: string;
  brand_name_ar: string;
  cuisine_ar: string | null;
  logo_url: string | null;
  cover_url: string | null;
  status: string;
  distance_meters: number | null;
  eta_minutes: number | null;
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

/* حالة الفرع → شارة على صورة البطاقة (كما في rcard بالتصميم) */
export function statusBadge(status: string): { label: string; cls: string } {
  if (status === "open") return { label: "مفتوح", cls: styles.stOpen };
  if (status === "busy") return { label: "ازدحام", cls: styles.stBusy };
  return { label: "مغلق", cls: styles.stClosed };
}

/** الفروع القريبة + الموقع — الموقع ميزة تحسين لا شرط (docs/14§8) */
export function useNearby(): {
  branches: BranchCard[] | null;
  error: string | null;
  locLabel: string;
  coords: { lat: number; lng: number };
} {
  const [branches, setBranches] = useState<BranchCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [locLabel, setLocLabel] = useState("الرياض");
  const [coords, setCoords] = useState(RIYADH);

  useEffect(() => {
    const load = (lat: number, lng: number) =>
      api<BranchCard[]>("GET", `/v1/branches/nearby?lat=${lat}&lng=${lng}&radius=30000`)
        .then(setBranches)
        .catch((e: Error) => setError(e.message));

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setLocLabel("موقعك الحالي");
          setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
          void load(pos.coords.latitude, pos.coords.longitude);
        },
        () => load(RIYADH.lat, RIYADH.lng),
        { timeout: 3000 }
      );
    } else {
      void load(RIYADH.lat, RIYADH.lng);
    }
  }, []);

  return { branches, error, locLabel, coords };
}

/**
 * تصنيفات C-09 مرتبةً: قائمة السوبر أدمن (cms.categories) إن وُجدت — بعدد المطاعم القريبة
 * لكل تصنيف (وقد يكون صفراً)؛ وإلا تُشتق من مطابخ الفروع القريبة.
 */
export function useCategories(branches: BranchCard[] | null): Array<{ name: string; count: number }> | null {
  const [adminCats, setAdminCats] = useState<string[] | null>(null);

  useEffect(() => {
    api<Array<{ name_ar: string }>>("GET", "/v1/content/categories")
      .then((cats) => setAdminCats(cats.map((c) => c.name_ar)))
      .catch(() => setAdminCats([])); // ميزة تحسين — السقوط للاشتقاق التلقائي
  }, []);

  if (branches === null || adminCats === null) return null;

  const counts = new Map<string, number>();
  for (const b of branches) {
    if (b.cuisine_ar) counts.set(b.cuisine_ar, (counts.get(b.cuisine_ar) ?? 0) + 1);
  }
  if (adminCats.length > 0) {
    return adminCats.map((name) => ({ name, count: counts.get(name) ?? 0 }));
  }
  return [...counts.entries()].map(([name, count]) => ({ name, count }));
}

/** رأس التطبيق: موقع الاستلام + جرس C-62 + بحث C-11/C-12 بنتائجه */
export function AppHead({ locLabel, coords }: { locLabel: string; coords: { lat: number; lng: number } }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResults | null>(null);
  const [notifs, setNotifs] = useState<NotifList | null>(null);
  const [showNotifs, setShowNotifs] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // تُقرأ بعد التركيب فقط — لا فرق ترطيب بين الخادم والعميل
  const [loggedIn, setLoggedIn] = useState(false);
  useEffect(() => setLoggedIn(Boolean(getToken())), []);

  // شارة غير المقروء عند فتح الصفحة — للمسجلين فقط
  useEffect(() => {
    if (!loggedIn) return;
    api<NotifList>("GET", "/v1/customers/me/notifications")
      .then(setNotifs)
      .catch(() => undefined); // الجرس ميزة تحسين — لا نُفشل الصفحة
  }, [loggedIn]);

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
        setNotifs((n) =>
          n ? { unread_count: 0, notifications: n.notifications.map((x) => ({ ...x, read: true })) } : n
        )
      );
    }
  };

  return (
    <header className={styles.apphead} style={{ position: "relative" }}>
      <div className={styles.loc}>
        <span style={{ color: "var(--pk-lime-900)", display: "inline-flex" }}>
          <IPin size={17} />
        </span>
        <div>
          <div className={styles.locLb}>الاستلام قرب</div>
          <b>{locLabel}</b>
        </div>
        {loggedIn ? (
          <button
            type="button"
            className={styles.bell}
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
            <div className={styles.notifEmpty}>لا نتائج لـ«{q.trim()}» — جرّب كلمة أخرى</div>
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

/** التنقل السفلي — التبويبات الخمس فعّالة والتمييز حسب المسار الحالي */
export function TabBar() {
  const path = usePathname();
  const cls = (on: boolean) => (on ? `${styles.tab} ${styles.tabOn}` : styles.tab);
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
      <Link href="/orders" className={cls(path.startsWith("/orders"))} data-testid="nav-orders">
        <IReceipt />
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

/** رأس صفحة داخلية موحّد + دعوة تسجيل الدخول للزائر — تستخدمه صفحات التبويبات */
export function GuestGate({ next, message }: { next: string; message: string }) {
  return (
    <div className={styles.empty}>
      <div className={styles.emptyIc}>
        <IUser />
      </div>
      <b>سجّل دخولك أولاً</b>
      <p>{message}</p>
      <Link href={`/auth?next=${encodeURIComponent(next)}`} className={styles.gateBtn} data-testid="gate-login">
        تسجيل الدخول
      </Link>
    </div>
  );
}

/** بطاقة مطعم (rcard) — مشتركة بين نتائج التصفح وقائمة المطاعم */
export function RestaurantCard({ b }: { b: BranchCard }) {
  const st = statusBadge(b.status);
  return (
    <Link href={`/r/${b.id}`} className={styles.rcard} data-testid="branch-card">
      <div className={styles.img}>
        {b.cover_url || b.logo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={b.cover_url ?? b.logo_url ?? ""} alt="" className={styles.imgCover} />
        ) : (
          <IStore size={40} />
        )}
        <span className={`${styles.stBadge} ${st.cls}`}>{st.label}</span>
      </div>
      <div className={styles.bd}>
        <div className={styles.nm}>
          {b.logo_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={b.logo_url} alt="" className={styles.nmLogo} />
          )}
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
    </Link>
  );
}
