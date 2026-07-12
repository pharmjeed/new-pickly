"use client";

/**
 * C-18 / C-64 — المفضلة: علامات حفظها العميل (قلب صفحة المطعم)
 * من GET /v1/customers/me/favorites — البطاقة تفتح أقرب فرع نشط، مع حذف بالقلب.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { api, getToken } from "@/lib/api";
import { GuestGate, IHeart, IPin, IStore, RIYADH, TabBar, statusBadge } from "../shell";
import styles from "../page.module.css";

interface FavoriteBrand {
  brand_id: string;
  name_ar: string;
  cuisine_ar: string | null;
  logo_url: string | null;
  cover_url: string | null;
  branch_id: string | null;
  branch_status: string | null;
  distance_meters: number | null;
  created_at: string;
}

export default function FavoritesPage() {
  const [favs, setFavs] = useState<FavoriteBrand[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [guest, setGuest] = useState<boolean | null>(null);

  useEffect(() => {
    if (!getToken()) {
      setGuest(true);
      return;
    }
    setGuest(false);
    const load = (lat: number, lng: number) =>
      api<FavoriteBrand[]>("GET", `/v1/customers/me/favorites?lat=${lat}&lng=${lng}`)
        .then(setFavs)
        .catch((e: Error) => setError(e.message));
    if (typeof navigator !== "undefined" && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => void load(pos.coords.latitude, pos.coords.longitude),
        () => void load(RIYADH.lat, RIYADH.lng),
        { timeout: 3000 }
      );
    } else {
      void load(RIYADH.lat, RIYADH.lng);
    }
  }, []);

  const remove = (brand_id: string) => {
    // حذف متفائل — الفشل يعيد العنصر
    const prev = favs;
    setFavs((list) => (list ?? []).filter((f) => f.brand_id !== brand_id));
    api("DELETE", `/v1/customers/me/favorites/${brand_id}`).catch(() => setFavs(prev));
  };

  return (
    <main className={styles.page}>
      <div className={styles.pageHead}>
        <h1>المفضلة</h1>
      </div>

      <div className={styles.body}>
        {guest && <GuestGate next="/favorites" message="احفظ مطاعمك المفضلة بالقلب وارجع لها من هنا" />}

        {guest === false && (
          <>
            {error && (
              <div className={styles.noteErr} role="alert">
                <span>{error}</span>
              </div>
            )}

            {!favs && !error && (
              <div className={styles.col} aria-label="جارٍ التحميل" aria-busy="true">
                <div className={`${styles.skl} ${styles.sklH64}`} />
                <div className={`${styles.skl} ${styles.sklH64}`} />
              </div>
            )}

            {favs && favs.length === 0 && (
              <div className={styles.empty}>
                <div className={styles.emptyIc}>
                  <IHeart />
                </div>
                <b>ما فيه مفضلة بعد</b>
                <p>اضغط القلب في صفحة أي مطعم يعجبك ويظهر هنا</p>
                <Link href="/restaurants" className={styles.gateBtn}>
                  تصفح المطاعم
                </Link>
              </div>
            )}

            {favs?.map((f) => {
              const st = f.branch_status ? statusBadge(f.branch_status) : null;
              const card = (
                <>
                  <div className={styles.ordLogo}>
                    {f.logo_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={f.logo_url} alt="" />
                    ) : (
                      <IStore size={24} />
                    )}
                  </div>
                  <div className={styles.ordBd}>
                    <div className={styles.ordTop}>
                      <span className={styles.ordBrand}>{f.name_ar}</span>
                      {st && <span className={`${styles.stBadge} ${st.cls}`}>{st.label}</span>}
                    </div>
                    <div className={styles.ordMeta}>
                      {[
                        f.cuisine_ar,
                        f.distance_meters !== null ? `${(f.distance_meters / 1000).toFixed(1)} كم` : null
                      ]
                        .filter(Boolean)
                        .join(" · ") || "—"}
                      {f.distance_meters !== null && (
                        <span style={{ marginInlineStart: 4, display: "inline-flex", verticalAlign: "middle" }}>
                          <IPin size={12} />
                        </span>
                      )}
                    </div>
                  </div>
                </>
              );
              return (
                <div key={f.brand_id} className={styles.favRow} data-testid="favorite-row">
                  {f.branch_id ? (
                    <Link href={`/r/${f.branch_id}`} className={styles.favLink}>
                      {card}
                    </Link>
                  ) : (
                    <div className={styles.favLink} style={{ opacity: 0.6 }}>
                      {card}
                    </div>
                  )}
                  <button
                    type="button"
                    className={styles.favDel}
                    onClick={() => remove(f.brand_id)}
                    aria-label={`إزالة ${f.name_ar} من المفضلة`}
                    data-testid="favorite-remove"
                  >
                    <IHeart />
                  </button>
                </div>
              );
            })}
          </>
        )}
      </div>

      <TabBar />
    </main>
  );
}
