"use client";

/** الفواتير — إيصالات طلباتك المكتملة والمسترجعة؛ التفاصيل الكاملة في صفحة الطلب. */
import { useState } from "react";
import Link from "next/link";
import { fmtSar, getToken } from "@/lib/api";
import { useApi, useIsoLayout } from "@/lib/use-api";
import { GuestGate, TabBar } from "../../shell";
import { IChevron, SubHead, fmtDate } from "../ui";
import pageStyles from "../../page.module.css";
import styles from "../account.module.css";

interface OrderSummary {
  id: string;
  display_code: string;
  order_status: string;
  brand_name_ar: string;
  total_halalas: number;
  created_at: string;
}

/** حالات لها فاتورة/إيصال نهائي */
const INVOICE_STATUSES: Record<string, { label: string; cls: "ok" | "warn" }> = {
  COMPLETED: { label: "مكتمل", cls: "ok" },
  REFUND_PENDING: { label: "استرجاع قيد المعالجة", cls: "warn" },
  PARTIALLY_REFUNDED: { label: "مسترجع جزئياً", cls: "warn" },
  REFUNDED: { label: "مسترجع", cls: "warn" }
};

export default function InvoicesPage() {
  const [guest, setGuest] = useState<boolean | null>(null);
  useIsoLayout(() => setGuest(!getToken()), []);
  const { data: orders, error } = useApi<OrderSummary[]>(
    guest === false ? "/v1/customers/me/orders" : null
  );
  const invoices = orders?.filter((o) => o.order_status in INVOICE_STATUSES);

  return (
    <main className={pageStyles.page}>
      <SubHead title="الفواتير" />
      <div className={pageStyles.body}>
        {guest && <GuestGate next="/account/invoices" message="سجّل دخولك لعرض فواتيرك" />}
        {guest === false && (
          <>
            {error && (
              <div className={pageStyles.noteErr} role="alert">
                <span>{error}</span>
              </div>
            )}
            {!orders && !error && (
              <div className={pageStyles.col} aria-busy="true">
                <div className={`${pageStyles.skl} ${pageStyles.sklCard}`} />
              </div>
            )}
            {invoices && invoices.length === 0 && (
              <div className={pageStyles.acCard}>
                <div className={pageStyles.acMuted}>لا فواتير بعد — تظهر هنا بعد اكتمال أول طلب</div>
              </div>
            )}
            {invoices && invoices.length > 0 && (
              <div className={styles.navCard}>
                {invoices.map((o) => {
                  const st = INVOICE_STATUSES[o.order_status];
                  return (
                    <Link key={o.id} href={`/track/${o.id}`} className={styles.navRow} data-testid="invoice-row">
                      <span className={styles.rowLabel}>
                        {o.brand_name_ar}
                        <span className={styles.bubbleMeta}>
                          {" "}
                          {o.display_code} · {fmtDate(o.created_at)}
                        </span>
                      </span>
                      <span className={`${styles.chip} ${st.cls === "ok" ? styles.chipOk : styles.chipWarn}`}>
                        {st.label}
                      </span>
                      <span className={pageStyles.acAmt}>{fmtSar(o.total_halalas)}</span>
                      <span className={styles.rowChevron}>
                        <IChevron />
                      </span>
                    </Link>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
      <TabBar />
    </main>
  );
}
