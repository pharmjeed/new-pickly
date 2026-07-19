"use client";

/**
 * ادعُ أصدقاءك — كودك الدائم للمشاركة، ومكافأة الطرفين تُصرف رصيد محفظة
 * بعد أول طلب مكتمل للمدعو. إدخال كود صديق متاح قبل أول طلب لك فقط.
 */
import { useState } from "react";
import { api, fmtSar, getToken, ApiError } from "@/lib/api";
import { useApi, useIsoLayout } from "@/lib/use-api";
import { GuestGate, TabBar } from "../../shell";
import { ICopy, IGift, SubHead } from "../ui";
import pageStyles from "../../page.module.css";
import styles from "../account.module.css";

interface Referral {
  code: string;
  referrer_reward_halalas: number;
  friend_reward_halalas: number;
  invited_count: number;
  rewarded_count: number;
  can_redeem: boolean;
  redeemed_code: string | null;
}

export default function InvitePage() {
  const [guest, setGuest] = useState<boolean | null>(null);
  const [copied, setCopied] = useState(false);
  const [friendCode, setFriendCode] = useState("");
  const [redeemBusy, setRedeemBusy] = useState(false);
  const [redeemErr, setRedeemErr] = useState<string | null>(null);
  useIsoLayout(() => setGuest(!getToken()), []);
  const { data: ref, error, mutate } = useApi<Referral>(guest === false ? "/v1/customers/me/referral" : null);

  const share = async () => {
    if (!ref) return;
    const text = `جرّب بيكلي — تطلب وتدفع وتستلم من سيارتك بلا نزول. سجّل بكودي ${ref.code} وخذ ${fmtSar(ref.friend_reward_halalas)} في محفظتك بعد أول طلب! https://thepickly.com`;
    try {
      if (navigator.share) {
        await navigator.share({ title: "بيكلي", text });
        return;
      }
    } catch {
      /* أُلغيت المشاركة — ننسخ بدلاً منها */
    }
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const copyCode = async () => {
    if (!ref) return;
    await navigator.clipboard.writeText(ref.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const redeem = async () => {
    setRedeemBusy(true);
    setRedeemErr(null);
    try {
      await api("POST", "/v1/customers/me/referral/redeem", { code: friendCode.trim().toUpperCase() });
      mutate((prev) =>
        prev ? { ...prev, can_redeem: false, redeemed_code: friendCode.trim().toUpperCase() } : prev
      );
      setFriendCode("");
    } catch (e) {
      setRedeemErr(e instanceof ApiError ? e.message : "تعذر تسجيل الكود — حاول مجدداً");
    } finally {
      setRedeemBusy(false);
    }
  };

  return (
    <main className={pageStyles.page}>
      <SubHead title="ادعُ أصدقاءك" />
      <div className={pageStyles.body}>
        {guest && <GuestGate next="/account/invite" message="سجّل دخولك لدعوة أصدقائك وكسب المكافآت" />}
        {guest === false && (
          <>
            {error && (
              <div className={pageStyles.noteErr} role="alert">
                <span>{error}</span>
              </div>
            )}
            {!ref && !error && (
              <div className={pageStyles.col} aria-busy="true">
                <div className={`${pageStyles.skl} ${pageStyles.sklCard}`} />
              </div>
            )}
            {ref && (
              <>
                <div className={`${styles.hero} ${styles.heroLime}`} data-testid="invite-hero">
                  <span className={styles.inviteGift} style={{ margin: "0 auto" }}>
                    <IGift size={22} />
                  </span>
                  <div className={styles.heroSub} style={{ marginTop: 10 }}>
                    شارك كودك واربح <b>{fmtSar(ref.referrer_reward_halalas)}</b> عن كل صديق يكمل أول طلب —
                    وصديقك يستلم <b>{fmtSar(ref.friend_reward_halalas)}</b> في محفظته
                  </div>
                  <div className={styles.codeBox}>
                    <span className={styles.codeText} data-testid="referral-code">
                      {ref.code}
                    </span>
                    <button type="button" className={styles.copyBtn} onClick={() => void copyCode()} aria-label="نسخ الكود">
                      <ICopy />
                    </button>
                  </div>
                  {copied && <div className={styles.okNote} style={{ marginTop: 10 }}>نُسخ — أرسله لصديقك</div>}
                  <button
                    type="button"
                    className={styles.primaryBtn}
                    style={{ marginTop: 12 }}
                    onClick={() => void share()}
                    data-testid="share-app"
                  >
                    دعوة صديق
                  </button>
                </div>

                <div className={styles.statsRow}>
                  <div className={styles.statBox}>
                    <div className={styles.statNum}>{ref.invited_count.toLocaleString("en")}</div>
                    <div className={styles.statLabel}>أصدقاء انضموا بكودك</div>
                  </div>
                  <div className={styles.statBox}>
                    <div className={styles.statNum}>{ref.rewarded_count.toLocaleString("en")}</div>
                    <div className={styles.statLabel}>مكافآت صُرفت لك</div>
                  </div>
                </div>

                {ref.can_redeem && (
                  <>
                    <div className={pageStyles.acSection}>دعاك صديق؟</div>
                    <div className={pageStyles.acCard}>
                      <div className={pageStyles.acMuted}>
                        أدخل كوده قبل أول طلب لك — ومكافأتكما تنزل بعد استلامه
                      </div>
                      <input
                        className={`${styles.field} ${styles.codeField}`}
                        style={{ marginTop: 10 }}
                        value={friendCode}
                        onChange={(e) => setFriendCode(e.target.value)}
                        placeholder="ABC123"
                        maxLength={8}
                        data-testid="redeem-input"
                      />
                      {redeemErr && (
                        <div className={pageStyles.noteErr} role="alert" style={{ marginTop: 10 }}>
                          <span>{redeemErr}</span>
                        </div>
                      )}
                      <button
                        type="button"
                        className={styles.primaryBtn}
                        style={{ marginTop: 10 }}
                        disabled={friendCode.trim().length < 6 || redeemBusy}
                        onClick={() => void redeem()}
                        data-testid="redeem-submit"
                      >
                        {redeemBusy ? "جارٍ التسجيل…" : "تسجيل الكود"}
                      </button>
                    </div>
                  </>
                )}
                {ref.redeemed_code && (
                  <div className={styles.okNote}>انضممت بدعوة صديق (كود {ref.redeemed_code}) — مكافأتكما تنزل بعد أول طلب تستلمه</div>
                )}
              </>
            )}
          </>
        )}
      </div>
      <TabBar />
    </main>
  );
}
