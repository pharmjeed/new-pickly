"use client";

/**
 * P3 · C-09 الاستكشاف الموحد — الرئيسية:
 * بحث C-11 في الأعلى ← بانرات CMS متحركة (A-13، تُدار من السوبر أدمن) ← تصنيفات المطاعم
 * ← قائمة «قريب منك» بكل المطاعم الأقرب فالأقرب. /restaurants تبقى للتصفية بالتصنيف.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { useApi } from "@/lib/use-api";
import { AppHead, RestaurantCard, TabBar, cuisinePhoto, useCategories, useNearby } from "./shell";
import { QirtasDrive, QirtasEmptyLive } from "./qirtas-motion";
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
  const { data, error } = useApi<Banner[]>("/v1/content/banners");
  // البانرات ميزة تحسين — فشلها يخفي القسم ولا يُفشل الرئيسية
  const banners = data ?? (error !== null ? [] : null);
  const [idx, setIdx] = useState(0);

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
  // قائمة «قريب منك» — كل المطاعم الأقرب فالأقرب (مجهولة المسافة آخراً)
  const nearest = [...(branches ?? [])].sort(
    (a, b) => (a.distance_meters ?? Infinity) - (b.distance_meters ?? Infinity)
  );

  return (
    <main className={styles.page}>
      <AppHead locLabel={locLabel} coords={coords} />

      <div className={styles.body}>
        {error && (
          <div className={styles.noteErr} role="alert">
            <span>{error}</span>
          </div>
        )}

        {/* بطل العلامة — القرطاس راكب سيارته منطلقاً لاستلام طلبه (روح لوحة العرض) */}
        <Link href="/restaurants" className={`${styles.hero} pk-in`} data-testid="home-hero">
          <span className={styles.heroBlob} aria-hidden="true" />
          <div className={styles.heroTxt}>
            <b>
              استلم طلبك
              <br />
              <span className={styles.heroPink}>من سيارتك!</span>
            </b>
            <span className={styles.heroTag}>طلبك جاهز.. ونحن بانتظارك 🚗</span>
          </div>
          <div className={styles.heroArt}>
            <QirtasDrive size={84} />
          </div>
        </Link>

        {/* بانرات متحركة من السوبر أدمن (A-13) — تحت البطل */}
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
            <div className={`${styles.sech} pk-in pk-d1`}>
              <h2>التصنيفات</h2>
            </div>
            {cats.length === 0 ? (
              <div className={styles.empty}>
                <QirtasEmptyLive mood="sleepy">
                  <b>ما فيه مطاعم قريبة منك الآن</b>
                  <p>بيكلي يتوسع — جرّب من موقع آخر أو عُد لاحقاً</p>
                </QirtasEmptyLive>
              </div>
            ) : (
              <div className={styles.cats} data-testid="home-cats">
                {cats.map(({ name, count }, i) => (
                  <Link
                    key={name}
                    href={`/restaurants?c=${encodeURIComponent(name)}`}
                    className={`${styles.catCard} pk-pop`}
                    style={{ animationDelay: `${100 + Math.min(i, 8) * 55}ms` }}
                    data-testid="cat-card"
                  >
                    <span className={styles.catPh}>
                      {/* أصل ثابت صغير من public — كصور البانرات، next/image يتطلب تهيئة لا تلزم هنا */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={cuisinePhoto(name)} alt="" width={64} height={64} loading="lazy" />
                    </span>
                    <b className={styles.catNm}>{name}</b>
                    <span className={styles.catCt}>{count} {count === 1 ? "مطعم" : "مطاعم"}</span>
                  </Link>
                ))}
              </div>
            )}

            {nearest.length > 0 && (
              <>
                <div className={`${styles.sech} pk-in pk-d4`}>
                  <h2>قريب منك</h2>
                </div>
                {nearest.map((b, i) => (
                  <RestaurantCard key={b.id} b={b} i={i} />
                ))}
              </>
            )}
          </>
        )}
      </div>

      <TabBar />
    </main>
  );
}
