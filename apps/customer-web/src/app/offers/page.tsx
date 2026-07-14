"use client";

/**
 * C-17 — العروض: كوبونات بيكلي العامة وعروض المطاعم السارية من GET /v1/offers.
 * نسخ الكود بضغطة — التحقق النهائي من الأهلية يتم عند تطبيقه على السلة (BR-7).
 */
import { useEffect, useState } from "react";
import { api, fmtSar } from "@/lib/api";
import { TabBar } from "../shell";
import { QirtasEmpty } from "../qirtas";
import styles from "../page.module.css";

interface OfferCard {
  id: string;
  code: string;
  type: "amount" | "percent" | "free_product";
  value: number;
  min_order_halalas: number | null;
  new_users_only: boolean;
  merchant_name_ar: string | null;
  brand_logo_url: string | null;
  ends_at: string | null;
}

/** قيمة الخصم المعروضة داخل الشارة */
function offerValue(o: OfferCard): { val: string; unit: string } {
  if (o.type === "percent") return { val: `${o.value / 100}٪`, unit: "خصم" };
  if (o.type === "amount") return { val: (o.value / 100).toLocaleString("en"), unit: "ر.س" };
  return { val: "🎁", unit: "هدية" };
}

function offerTitle(o: OfferCard): string {
  const scope = o.merchant_name_ar ? `من ${o.merchant_name_ar}` : "من بيكلي على كل المطاعم";
  if (o.type === "percent") return `خصم ${o.value / 100}٪ ${scope}`;
  if (o.type === "amount") return `خصم ${fmtSar(o.value)} ${scope}`;
  return `منتج مجاني ${scope}`;
}

export default function OffersPage() {
  const [offers, setOffers] = useState<OfferCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    api<OfferCard[]>("GET", "/v1/offers")
      .then(setOffers)
      .catch((e: Error) => setError(e.message));
  }, []);

  const copy = (code: string) => {
    void navigator.clipboard?.writeText(code).catch(() => undefined);
    setCopied(code);
    setTimeout(() => setCopied((c) => (c === code ? null : c)), 1600);
  };

  return (
    <main className={styles.page}>
      <div className={styles.pageHead}>
        <h1>العروض</h1>
      </div>

      <div className={styles.body}>
        {error && (
          <div className={styles.noteErr} role="alert">
            <span>{error}</span>
          </div>
        )}

        {!offers && !error && (
          <div className={styles.col} aria-label="جارٍ التحميل" aria-busy="true">
            <div className={`${styles.skl} ${styles.sklH64}`} />
            <div className={`${styles.skl} ${styles.sklH64}`} />
            <div className={`${styles.skl} ${styles.sklH64}`} />
          </div>
        )}

        {offers && offers.length === 0 && (
          <div className={styles.empty}>
            <QirtasEmpty mood="sleepy">
              <b>لا عروض حالياً</b>
              <p>نضيف كوبونات وعروض المطاعم هنا أولاً بأول — عُد قريباً</p>
            </QirtasEmpty>
          </div>
        )}

        {offers?.map((o) => {
          const v = offerValue(o);
          return (
            <div key={o.id} className={styles.offCard} data-testid="offer-card">
              <div className={styles.offBadge}>
                {o.brand_logo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={o.brand_logo_url} alt="" />
                ) : (
                  <>
                    <span className={styles.offVal}>{v.val}</span>
                    <span className={styles.offUnit}>{v.unit}</span>
                  </>
                )}
              </div>
              <div className={styles.offBd}>
                <div className={styles.offTitle}>{offerTitle(o)}</div>
                <div className={styles.offMeta}>
                  {[
                    o.min_order_halalas ? `حد أدنى ${fmtSar(o.min_order_halalas)}` : null,
                    o.new_users_only ? "للطلب الأول" : null,
                    o.ends_at
                      ? `حتى ${new Date(o.ends_at).toLocaleDateString("ar-SA", { day: "numeric", month: "long" })}`
                      : null
                  ]
                    .filter(Boolean)
                    .join(" · ") || "يُطبق عند الدفع"}
                </div>
              </div>
              <button type="button" className={styles.offCode} onClick={() => copy(o.code)} data-testid="offer-code">
                {copied === o.code ? "نُسخ ✓" : o.code}
              </button>
            </div>
          );
        })}
      </div>

      <TabBar />
    </main>
  );
}
