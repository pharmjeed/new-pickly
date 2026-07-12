"use client";

/**
 * P3 · C-09 الاستكشاف الموحد — الرئيسية:
 * بحث C-11 في الأعلى ← بانرات CMS متحركة (A-13، تُدار من السوبر أدمن) ← تصنيفات المطاعم
 * ← زر كل المطاعم. قائمة المطاعم نفسها صفحة تالية: /restaurants (تصفية بالتصنيف).
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { AppHead, IStore, TabBar, cuisineIcon, useCategories, useNearby } from "./shell";
import styles from "./page.module.css";

interface Banner {
  title_ar: string;
  body_ar: string | null;
  image_url: string | null;
  link: string | null;
}

const BANNER_MS = 4000;

/** بانرات CMS — تنقّل تلقائي بتلاشٍ وانزلاق، والنقاط للتنقل اليدوي */
function Banners() {
  const [banners, setBanners] = useState<Banner[] | null>(null);
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    api<Banner[]>("GET", "/v1/content/banners")
      .then(setBanners)
      .catch(() => setBanners([])); // البانرات ميزة تحسين — لا نُفشل الرئيسية
  }, []);

  useEffect(() => {
    if (!banners || banners.length < 2) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % banners.length), BANNER_MS);
    return () => clearInterval(t);
  }, [banners]);

  if (banners === null) return <div className={`${styles.skl} ${styles.sklBanner}`} />;
  if (banners.length === 0) return null;

  const current = banners[Math.min(idx, banners.length - 1)];
  if (!current) return null;

  const inner = (
    <>
      {current.image_url ? (
        // صور البانرات من CMS روابط خارجية — next/image يتطلب أذونات نطاقات مسبقة
        // eslint-disable-next-line @next/next/no-img-element
        <img src={current.image_url} alt={current.title_ar} className={styles.bimg} />
      ) : null}
      <div className={styles.btxt}>
        <b>{current.title_ar}</b>
        {current.body_ar && <p>{current.body_ar}</p>}
      </div>
    </>
  );

  return (
    <section className={styles.banners} data-testid="home-banners" aria-label="عروض بيكلي">
      {current.link ? (
        current.link.startsWith("/") ? (
          <Link key={idx} href={current.link} className={styles.bslide}>
            {inner}
          </Link>
        ) : (
          <a key={idx} href={current.link} className={styles.bslide} target="_blank" rel="noreferrer">
            {inner}
          </a>
        )
      ) : (
        <div key={idx} className={styles.bslide}>
          {inner}
        </div>
      )}
      {banners.length > 1 && (
        <div className={styles.bdots}>
          {banners.map((_, i) => (
            <button
              key={i}
              type="button"
              aria-label={`البانر ${i + 1}`}
              className={i === idx ? `${styles.bdot} ${styles.bdotOn}` : styles.bdot}
              onClick={() => setIdx(i)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

export default function HomePage() {
  const { branches, error, locLabel, coords } = useNearby();
  // تصنيفات C-09 — قائمة السوبر أدمن بترتيبها، أو الاشتقاق من الفروع القريبة
  const cats = useCategories(branches);

  return (
    <main className={styles.page}>
      <AppHead locLabel={locLabel} coords={coords} />

      <div className={styles.body}>
        {error && (
          <div className={styles.noteErr} role="alert">
            <span>{error}</span>
          </div>
        )}

        {/* بانرات متحركة من السوبر أدمن (A-13) — تحت البحث مباشرة */}
        <Banners />

        {/* تصنيفات المطاعم */}
        {(!branches || cats === null) && !error && (
          <div className={styles.col} aria-label="جارٍ التحميل" aria-busy="true">
            <div className={`${styles.skl} ${styles.sklH96}`} />
            <div className={`${styles.skl} ${styles.sklH64}`} />
            <div className={`${styles.skl} ${styles.sklH64}`} />
          </div>
        )}

        {branches && cats !== null && (
          <>
            <div className={styles.sech}>
              <h2>التصنيفات</h2>
            </div>
            {cats.length === 0 ? (
              <div className={styles.empty}>
                <div className={styles.emptyIc}>
                  <IStore />
                </div>
                <b>ما فيه مطاعم قريبة منك الآن</b>
                <p>بيكلي يتوسع — جرّب من موقع آخر أو عُد لاحقاً</p>
              </div>
            ) : (
              <div className={styles.cats} data-testid="home-cats">
                {cats.map(({ name, count }) => (
                  <Link
                    key={name}
                    href={`/restaurants?c=${encodeURIComponent(name)}`}
                    className={styles.catCard}
                    data-testid="cat-card"
                  >
                    <span className={styles.catIc}>{cuisineIcon(name)}</span>
                    <b className={styles.catNm}>{name}</b>
                    <span className={styles.catCt}>{count} {count === 1 ? "مطعم" : "مطاعم"}</span>
                  </Link>
                ))}
              </div>
            )}

            {branches.length > 0 && (
              <Link href="/restaurants" className={styles.allBtn} data-testid="all-restaurants">
                <IStore size={20} />
                كل المطاعم القريبة ({branches.length})
              </Link>
            )}
          </>
        )}
      </div>

      <TabBar />
    </main>
  );
}
