"use client";

/**
 * P3 · C-09/C-10 — قائمة المطاعم القريبة (بعد رئيسية الاستكشاف):
 * chips تصنيفات (docs/21 P3) تصفية ?c= + بطاقات rcard كما في التصميم.
 */
import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AppHead, RestaurantCard, TabBar, useCategories, useNearby } from "../shell";
import { QirtasEmptyLive } from "../qirtas-motion";
import styles from "../page.module.css";

function RestaurantsList() {
  const { branches, error, locLabel, coords } = useNearby();
  const params = useSearchParams();
  const cuisine = params.get("c");

  // تصنيفات C-09 — قائمة السوبر أدمن بترتيبها، أو الاشتقاق من الفروع القريبة
  const cats = useCategories(branches) ?? [];
  const filtered = (branches ?? []).filter((b) => !cuisine || b.cuisine_ar === cuisine);

  return (
    <main className={styles.page}>
      <AppHead locLabel={locLabel} coords={coords} />

      <div className={styles.body}>
        {error && (
          <div className={styles.noteErr} role="alert">
            <span>{error}</span>
          </div>
        )}

        {!branches && !error && (
          <div className={styles.col} aria-label="جارٍ التحميل" aria-busy="true">
            <div className={`${styles.skl} ${styles.sklH64}`} />
            <div className={`${styles.skl} ${styles.sklCard}`} />
            <div className={`${styles.skl} ${styles.sklCard}`} />
          </div>
        )}

        {branches && (
          <>
            <div className={styles.sech}>
              <h2>{cuisine ?? "قريبة منك"}</h2>
            </div>

            {/* chips التصنيفات — «الكل» + المطابخ المتوفرة قريباً */}
            {cats.length > 0 && (
              <div className={styles.chips} data-testid="cuisine-chips">
                <Link href="/restaurants" className={cuisine ? styles.chip : `${styles.chip} ${styles.chipOn}`}>
                  الكل
                </Link>
                {cats.map(({ name }) => (
                  <Link
                    key={name}
                    href={`/restaurants?c=${encodeURIComponent(name)}`}
                    className={name === cuisine ? `${styles.chip} ${styles.chipOn}` : styles.chip}
                    data-testid="cuisine-chip"
                  >
                    {name}
                  </Link>
                ))}
              </div>
            )}

            {filtered.length === 0 && (
              <div className={styles.empty}>
                <QirtasEmptyLive mood="sad">
                  <b>ما فيه فروع قريبة منك الآن</b>
                  <p>بيكلي يتوسع — جرّب من موقع آخر أو عُد لاحقاً</p>
                </QirtasEmptyLive>
              </div>
            )}

            {filtered.map((b, i) => (
              <RestaurantCard key={b.id} b={b} i={i} />
            ))}
          </>
        )}
      </div>

      <TabBar />
    </main>
  );
}

export default function RestaurantsPage() {
  // useSearchParams يتطلب حد Suspense في App Router
  return (
    <Suspense fallback={null}>
      <RestaurantsList />
    </Suspense>
  );
}
