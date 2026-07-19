"use client";

/** محفظة بيكلي — الرصيد وكل القيود (docs/01§1). الرصيد يُصرف تلقائياً عند تفعيله في الدفع. */
import { useState } from "react";
import { fmtSar, getToken } from "@/lib/api";
import { useApi, useIsoLayout } from "@/lib/use-api";
import { GuestGate, TabBar } from "../../shell";
import { SubHead, fmtDate, walletEntryLabel, type WalletEntry } from "../ui";
import pageStyles from "../../page.module.css";
import styles from "../account.module.css";

interface Wallet {
  balance_halalas: number;
  entries: WalletEntry[];
}

export default function WalletPage() {
  const [guest, setGuest] = useState<boolean | null>(null);
  useIsoLayout(() => setGuest(!getToken()), []);
  const { data: wallet, error } = useApi<Wallet>(guest === false ? "/v1/customers/me/wallet" : null);

  return (
    <main className={pageStyles.page}>
      <SubHead title="محفظتي" />
      <div className={pageStyles.body}>
        {guest && <GuestGate next="/account/wallet" message="سجّل دخولك لعرض محفظتك" />}
        {guest === false && (
          <>
            {error && (
              <div className={pageStyles.noteErr} role="alert">
                <span>{error}</span>
              </div>
            )}
            {!wallet && !error && (
              <div className={pageStyles.col} aria-busy="true">
                <div className={`${pageStyles.skl} ${pageStyles.sklCard}`} />
              </div>
            )}
            {wallet && (
              <>
                <div className={`${styles.hero} ${styles.heroLime}`} data-testid="account-wallet">
                  <div className={styles.heroValue}>{fmtSar(wallet.balance_halalas)}</div>
                  <div className={styles.heroSub}>رصيدك — يُصرف تلقائياً عند تفعيله في الدفع</div>
                </div>

                <div className={pageStyles.acSection}>الحركات</div>
                <div className={pageStyles.acCard}>
                  {wallet.entries.length === 0 && (
                    <div className={pageStyles.acMuted}>
                      لا حركات بعد — الاسترجاعات والتعويضات ومكافآت الدعوة تصلك هنا
                    </div>
                  )}
                  {wallet.entries.map((e) => (
                    <div key={e.id} className={pageStyles.acRow}>
                      <span>
                        {walletEntryLabel(e)}
                        <span className={styles.bubbleMeta}> · {fmtDate(e.created_at)}</span>
                      </span>
                      <span className={e.amount_halalas > 0 ? pageStyles.acAmtPlus : pageStyles.acAmt}>
                        {e.amount_halalas > 0 ? "+" : "−"}
                        {fmtSar(Math.abs(e.amount_halalas))}
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
