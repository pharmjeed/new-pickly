"use client";

/** C-63 — مكافآتي: رصيد النقاط وكيف تُكسب وحركاتها. الاستبدال قادم (docs/01§2). */
import { useState } from "react";
import { getToken } from "@/lib/api";
import { useApi, useIsoLayout } from "@/lib/use-api";
import { GuestGate, TabBar } from "../../shell";
import { IStarCoin, SubHead, fmtDate } from "../ui";
import pageStyles from "../../page.module.css";
import styles from "../account.module.css";

interface RewardsTx {
  id: string;
  points: number;
  reason: string;
  created_at: string;
}
interface Rewards {
  points: number;
  points_per_sar: number;
  transactions: RewardsTx[];
}

export default function RewardsPage() {
  const [guest, setGuest] = useState<boolean | null>(null);
  useIsoLayout(() => setGuest(!getToken()), []);
  const { data: rewards, error } = useApi<Rewards>(guest === false ? "/v1/customers/me/rewards" : null);

  return (
    <main className={pageStyles.page}>
      <SubHead title="مكافآتي" />
      <div className={pageStyles.body}>
        {guest && <GuestGate next="/account/rewards" message="سجّل دخولك لعرض نقاطك ومكافآتك" />}
        {guest === false && (
          <>
            {error && (
              <div className={pageStyles.noteErr} role="alert">
                <span>{error}</span>
              </div>
            )}
            {!rewards && !error && (
              <div className={pageStyles.col} aria-busy="true">
                <div className={`${pageStyles.skl} ${pageStyles.sklCard}`} />
              </div>
            )}
            {rewards && (
              <>
                <div className={styles.hero} data-testid="account-rewards">
                  <div className={`${styles.heroValue} ${styles.heroValueBlue}`}>
                    {rewards.points.toLocaleString("en")} <IStarCoin size={26} />
                  </div>
                  <div className={styles.heroSub}>
                    {rewards.points_per_sar > 0
                      ? `تكسب ${rewards.points_per_sar.toLocaleString("en")} نقطة عن كل ريال تدفعه — تُضاف تلقائياً عند استلام طلبك`
                      : "النقاط تُضاف تلقائياً عند استلام طلبك"}
                  </div>
                  <span className={styles.soonChip}>استبدال النقاط بجوائز — قريباً</span>
                </div>

                <div className={pageStyles.acSection}>حركات النقاط</div>
                <div className={pageStyles.acCard}>
                  {rewards.transactions.length === 0 && (
                    <div className={pageStyles.acMuted}>لا نقاط بعد — أول طلب تستلمه يبدأ رصيدك</div>
                  )}
                  {rewards.transactions.map((t) => (
                    <div key={t.id} className={pageStyles.acRow}>
                      <span>
                        {t.reason}
                        <span className={styles.bubbleMeta}> · {fmtDate(t.created_at)}</span>
                      </span>
                      <span className={t.points > 0 ? pageStyles.acAmtPlus : pageStyles.acAmt}>
                        {t.points > 0 ? "+" : "−"}
                        {Math.abs(t.points).toLocaleString("en")}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>
      <TabBar />
    </main>
  );
}
