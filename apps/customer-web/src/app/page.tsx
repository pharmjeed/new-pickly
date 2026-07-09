"use client";

/**
 * P3 · C-09 الاستكشاف الموحد — الرئيسية (المرجع: design/customer/P3.html)
 * نطاق الطيار (docs/21§3): هيدر + قائمة الفروع القريبة.
 * البحث والفلاتر والخريطة والإشعارات والتبويبات الأخرى مؤجلة — تظهر شكلياً معطلة.
 * الفروع: الرياض افتراضياً مع محاولة تحديد الموقع (الموقع ميزة تحسين لا شرط — docs/14§8).
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import styles from "./page.module.css";

interface BranchCard {
  id: string;
  brand_name_ar: string;
  status: string;
  distance_meters: number | null;
  eta_minutes: number | null;
  address_short: string;
  busy_message: string | null;
}

const RIYADH = { lat: 24.7, lng: 46.68 };

/* ===== أيقونات خطية من رموز P3.html ===== */
function Icon({
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
const IPin = ({ size = 13 }: { size?: number }) => (
  <Icon size={size}>
    <path d="M50,14 C36,14 26,24 26,38 C26,54 50,84 50,84 C50,84 74,54 74,38 C74,24 64,14 50,14 Z" />
    <circle cx="50" cy="37" r="6" fill="currentColor" stroke="none" />
  </Icon>
);
const ICar = ({ size = 13 }: { size?: number }) => (
  <Icon size={size}>
    <path d="M30,56 Q35,40 50,40 Q65,40 70,56" />
    <rect x="18" y="54" width="64" height="18" rx="9" />
    <circle cx="34" cy="78" r="6" strokeWidth="6" />
    <circle cx="66" cy="78" r="6" strokeWidth="6" />
  </Icon>
);
const ISearch = ({ size = 15 }: { size?: number }) => (
  <Icon size={size}>
    <circle cx="44" cy="44" r="24" />
    <path d="M62,62 L82,82" />
  </Icon>
);
const IBell = ({ size = 18 }: { size?: number }) => (
  <Icon size={size}>
    <path d="M50,18 C36,18 30,28 30,40 C30,58 24,64 22,68 H78 C76,64 70,58 70,40 C70,28 64,18 50,18 Z" />
    <path d="M42,78 C44,84 56,84 58,78" />
  </Icon>
);
const IStore = ({ size = 32 }: { size?: number }) => (
  <Icon size={size}>
    <path d="M22,42 V80 H78 V42" />
    <path d="M16,42 L24,20 H76 L84,42 C84,48 78,52 73,52 C68,52 64,48 64,44 C64,48 60,52 55,52 C50,52 46,48 46,44 C46,48 42,52 37,52 C32,52 28,48 28,44 C28,48 24,52 19,52 C16,52 16,46 16,42 Z" />
    <path d="M40,80 V62 H60 V80" />
  </Icon>
);
const IAlert = ({ size = 18 }: { size?: number }) => (
  <Icon size={size}>
    <path d="M50,16 L88,80 H12 Z" />
    <path d="M50,42 V60" />
    <circle cx="50" cy="70" r="1.5" fill="currentColor" strokeWidth="5" />
  </Icon>
);
const IHome = () => (
  <Icon size={21}>
    <path d="M20,50 L50,22 L80,50" />
    <path d="M30,46 V78 H70 V46" />
  </Icon>
);
const ITag = () => (
  <Icon size={21}>
    <path d="M18,50 L50,18 L82,18 L82,50 L50,82 Z" />
    <circle cx="66" cy="34" r="6" fill="currentColor" stroke="none" />
  </Icon>
);
const IReceipt = () => (
  <Icon size={21}>
    <path d="M30,16 H70 V84 L62,78 L54,84 L46,78 L38,84 L30,78 Z" />
    <path d="M40,36 H60 M40,50 H60" />
  </Icon>
);
const IHeart = () => (
  <Icon size={21}>
    <path d="M50,80 C20,60 14,40 26,28 C36,18 50,26 50,36 C50,26 64,18 74,28 C86,40 80,60 50,80 Z" />
  </Icon>
);
const IUser = () => (
  <Icon size={21}>
    <circle cx="50" cy="36" r="16" />
    <path d="M22,82 C26,64 38,58 50,58 C62,58 74,64 78,82" />
  </Icon>
);

/* حالة الفرع → شارة على صورة البطاقة (كما في rcard بالتصميم) */
function statusBadge(status: string): { label: string; cls: string } {
  if (status === "open") return { label: "مفتوح", cls: styles.stOpen };
  if (status === "busy") return { label: "ازدحام", cls: styles.stBusy };
  return { label: "مغلق", cls: styles.stClosed };
}

export default function HomePage() {
  const [branches, setBranches] = useState<BranchCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [locLabel, setLocLabel] = useState("الرياض");

  useEffect(() => {
    const load = (lat: number, lng: number) =>
      api<BranchCard[]>("GET", `/v1/branches/nearby?lat=${lat}&lng=${lng}&radius=30000`)
        .then(setBranches)
        .catch((e: Error) => setError(e.message));

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setLocLabel("موقعك الحالي");
          void load(pos.coords.latitude, pos.coords.longitude);
        },
        () => load(RIYADH.lat, RIYADH.lng), // الموقع ميزة تحسين لا شرط (docs/14§8)
        { timeout: 3000 }
      );
    } else {
      void load(RIYADH.lat, RIYADH.lng);
    }
  }, []);

  return (
    <main className={styles.page}>
      {/* ===== رأس الرئيسية: موقع الاستلام + جرس + بحث (C-09 apphead) ===== */}
      <header className={styles.apphead}>
        <div className={styles.loc}>
          <span style={{ color: "var(--pk-lime-900)", display: "inline-flex" }}>
            <IPin size={17} />
          </span>
          <div>
            <div className={styles.locLb}>الاستلام قرب</div>
            <b>{locLabel}</b>
          </div>
          {/* الإشعارات مؤجلة عن نطاق الطيار — معطل شكلياً */}
          <span className={styles.bell} aria-disabled="true" title="الإشعارات — قريباً">
            <IBell />
          </span>
        </div>
        {/* البحث مؤجل (docs/21§3) — معطل شكلياً */}
        <div className={styles.search} aria-disabled="true">
          <ISearch />
          <span>ابحث عن مطعم، منتج، تصنيف…</span>
          <span className={styles.soon}>قريباً</span>
        </div>
      </header>

      <div className={styles.body}>
        {/* حالة الخطأ */}
        {error && (
          <div className={styles.noteErr} role="alert">
            <IAlert />
            <span>{error}</span>
          </div>
        )}

        {/* حالة التحميل — هياكل كما في data-state="load" */}
        {!branches && !error && (
          <div className={styles.col} aria-label="جارٍ التحميل" aria-busy="true">
            <div className={`${styles.skl} ${styles.sklH96}`} />
            <div className={`${styles.skl} ${styles.sklH64}`} />
            <div className={`${styles.skl} ${styles.sklCard}`} />
            <div className={`${styles.skl} ${styles.sklCard}`} />
            <div className={`${styles.skl} ${styles.sklH64}`} />
          </div>
        )}

        {branches && (
          <>
            <div className={styles.sech}>
              <h2>قريبة منك</h2>
            </div>

            {/* الحالة الفارغة */}
            {branches.length === 0 && (
              <div className={styles.empty}>
                <div className={styles.emptyIc}>
                  <IStore />
                </div>
                <b>ما فيه فروع قريبة منك الآن</b>
                <p>بيكلي يتوسع — جرّب من موقع آخر أو عُد لاحقاً</p>
              </div>
            )}

            {/* قائمة الفروع — بطاقة rcard كما في التصميم */}
            {branches.map((b) => {
              const st = statusBadge(b.status);
              return (
                <Link
                  key={b.id}
                  href={`/r/${b.id}`}
                  className={styles.rcard}
                  data-testid="branch-card"
                >
                  <div className={styles.img}>
                    <IStore size={40} />
                    <span className={`${styles.stBadge} ${st.cls}`}>{st.label}</span>
                  </div>
                  <div className={styles.bd}>
                    <div className={styles.nm}>
                      <b>
                        {b.brand_name_ar}
                        {b.address_short ? ` — ${b.address_short}` : ""}
                      </b>
                    </div>
                    <div className={styles.metaR}>
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
            })}
          </>
        )}
      </div>

      {/* ===== التنقل السفلي — الرئيسية وحسابي فعّالان، البقية مؤجلة ===== */}
      <nav className={styles.tabbar}>
        <Link href="/" className={`${styles.tab} ${styles.tabOn}`}>
          <IHome />
          الرئيسية
        </Link>
        <span className={`${styles.tab} ${styles.tabOff}`} aria-disabled="true">
          <ITag />
          العروض
        </span>
        <span className={`${styles.tab} ${styles.tabOff}`} aria-disabled="true">
          <IReceipt />
          طلباتي
        </span>
        <span className={`${styles.tab} ${styles.tabOff}`} aria-disabled="true">
          <IHeart />
          المفضلة
        </span>
        <Link href="/auth" className={styles.tab} data-testid="nav-auth">
          <IUser />
          حسابي
        </Link>
      </nav>
    </main>
  );
}
