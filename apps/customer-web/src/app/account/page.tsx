"use client";

/**
 * C-59 — حسابي: رأس بأفاتار + بطاقات سريعة (محفظتي/مكافآتي/قسائمي) + دعوة صديق
 * + أقسام حسابي/التفضيلات/أخرى. لا عناصر توصيل — نموذج بيكلي استلام من السيارة.
 */
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, clearTokens, fmtSar, getToken } from "@/lib/api";
import { useApi, useIsoLayout } from "@/lib/use-api";
import { GuestGate, TabBar, IBell, ICar, IReceipt, IUser } from "../shell";
import {
  ICardIcon,
  ICoupon,
  IGear,
  IGift,
  IGlobe,
  IHeadset,
  IPencil,
  IStarCoin,
  IWallet,
  NavRow
} from "./ui";
import pageStyles from "../page.module.css";
import styles from "./account.module.css";

interface Me {
  id: string;
  phone: string;
  full_name: string | null;
  preferred_language: "ar" | "en";
  marketing_opt_in: boolean;
}
interface Wallet {
  balance_halalas: number;
}
interface Rewards {
  points: number;
}
interface Referral {
  code: string;
  referrer_reward_halalas: number;
  friend_reward_halalas: number;
}

export default function AccountPage() {
  const router = useRouter();
  const [guest, setGuest] = useState<boolean | null>(null);
  const [langSheet, setLangSheet] = useState(false);
  useIsoLayout(() => setGuest(!getToken()), []);
  const authed = guest === false;

  const { data: me, error, mutate: mutateMe } = useApi<Me>(authed ? "/v1/customers/me" : null);
  // المحفظة/المكافآت/الدعوة خلف أعلام — فشل أيٍّ منها يخفي بطاقته ولا يعطل الصفحة
  const { data: wallet } = useApi<Wallet>(authed ? "/v1/customers/me/wallet" : null);
  const { data: rewards } = useApi<Rewards>(authed ? "/v1/customers/me/rewards" : null);
  const { data: referral } = useApi<Referral>(authed ? "/v1/customers/me/referral" : null);
  const { data: offers } = useApi<{ id: string }[]>("/v1/offers");

  const logout = async () => {
    try {
      await api("POST", "/v1/auth/logout");
    } catch {
      /* الخروج محلي على أي حال */
    }
    clearTokens();
    router.replace("/");
  };

  /** إشعارات العروض التسويقية — تبديل متفائل ثم حفظ خادمي */
  const toggleMarketing = (next: boolean) => {
    mutateMe((prev) => (prev ? { ...prev, marketing_opt_in: next } : prev));
    void api("PATCH", "/v1/customers/me", { marketing_opt_in: next }).catch(() => {
      mutateMe((prev) => (prev ? { ...prev, marketing_opt_in: !next } : prev));
    });
  };

  const quickCount = 1 + (wallet ? 1 : 0) + (rewards ? 1 : 0);
  const initial = me?.full_name?.trim()?.charAt(0) || "بـ";

  return (
    <main className={pageStyles.page}>
      <div className={pageStyles.pageHead}>
        <h1>حسابي</h1>
      </div>

      <div className={pageStyles.body}>
        {guest && <GuestGate next="/account" message="سجّل دخولك لإدارة حسابك ومحفظتك ومكافآتك" />}

        {guest === false && (
          <>
            {error && (
              <div className={pageStyles.noteErr} role="alert">
                <span>{error}</span>
              </div>
            )}

            {!me && !error && (
              <div className={pageStyles.col} aria-label="جارٍ التحميل" aria-busy="true">
                <div className={`${pageStyles.skl} ${pageStyles.sklH64}`} />
                <div className={`${pageStyles.skl} ${pageStyles.sklCard}`} />
                <div className={`${pageStyles.skl} ${pageStyles.sklCard}`} />
              </div>
            )}

            {me && (
              <>
                {/* ===== رأس الحساب ===== */}
                <div className={styles.profileHead} data-testid="account-profile">
                  <span className={styles.avatar} aria-hidden="true">
                    {initial}
                  </span>
                  <div>
                    <div className={styles.profileName}>{me.full_name ?? "بدون اسم"}</div>
                    <div className={styles.profilePhone}>{me.phone}</div>
                  </div>
                  <Link href="/account/profile" className={styles.editBtn} aria-label="تعديل الملف الشخصي">
                    <IPencil />
                  </Link>
                </div>

                {/* ===== البطاقات السريعة ===== */}
                <div
                  className={`${styles.quickGrid} ${quickCount === 2 ? styles.quickGrid2 : ""}`}
                  data-testid="account-quick"
                >
                  {wallet && (
                    <Link href="/account/wallet" className={styles.quickCard} data-testid="quick-wallet">
                      <span className={`${styles.quickIcon} ${styles.quickIconLime}`}>
                        <IWallet />
                      </span>
                      <b className={styles.quickValue}>{fmtSar(wallet.balance_halalas)}</b>
                      <span className={styles.quickLabel}>محفظتي</span>
                    </Link>
                  )}
                  {rewards && (
                    <Link href="/account/rewards" className={styles.quickCard} data-testid="quick-rewards">
                      <span className={`${styles.quickIcon} ${styles.quickIconBlue}`}>
                        <IStarCoin />
                      </span>
                      <b className={styles.quickValue}>{rewards.points.toLocaleString("en")} نقطة</b>
                      <span className={styles.quickLabel}>مكافآتي</span>
                    </Link>
                  )}
                  <Link href="/offers" className={styles.quickCard} data-testid="quick-coupons">
                    <span className={`${styles.quickIcon} ${styles.quickIconPink}`}>
                      <ICoupon />
                    </span>
                    <b className={styles.quickValue}>
                      {offers ? `${offers.length.toLocaleString("en")} قسيمة` : "قسائم"}
                    </b>
                    <span className={styles.quickLabel}>قسائمي</span>
                  </Link>
                </div>

                {/* ===== دعوة صديق ===== */}
                {referral && (
                  <Link href="/account/invite" className={styles.inviteBanner} data-testid="invite-banner">
                    <span className={styles.inviteGift}>
                      <IGift size={22} />
                    </span>
                    <span className={styles.inviteText}>
                      <span className={styles.inviteTitle}>
                        شارك بيكلي واربح {fmtSar(referral.referrer_reward_halalas)}
                      </span>
                      <span className={styles.inviteSub}>
                        وصديقك يستلم {fmtSar(referral.friend_reward_halalas)} بعد أول طلب له
                      </span>
                    </span>
                    <span className={styles.invitePill}>دعوة صديق</span>
                  </Link>
                )}

                {/* ===== حسابي ===== */}
                <div className={pageStyles.acSection}>حسابي</div>
                <div className={styles.navCard}>
                  <NavRow href="/account/profile" icon={<IUser />} label="ملفي الشخصي" testId="row-profile" />
                  <NavRow href="/account/vehicles" icon={<ICar size={19} />} label="سياراتي" testId="row-vehicles" />
                  <NavRow href="/account/payments" icon={<ICardIcon />} label="طرق الدفع" testId="row-payments" />
                  <NavRow href="/account/invoices" icon={<IReceipt />} label="الفواتير" testId="row-invoices" />
                </div>

                {/* ===== التفضيلات ===== */}
                <div className={pageStyles.acSection}>التفضيلات</div>
                <div className={styles.navCard}>
                  <NavRow
                    icon={<IGlobe />}
                    label="اللغة"
                    value={me.preferred_language === "en" ? "English" : "العربية"}
                    onClick={() => setLangSheet(true)}
                    testId="row-language"
                  />
                  <div className={styles.toggleRow}>
                    <span className={styles.rowIcon}>
                      <IBell size={18} />
                    </span>
                    <span className={styles.rowLabel}>إشعارات العروض</span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={me.marketing_opt_in}
                      aria-label="إشعارات العروض"
                      className={`${styles.toggle} ${me.marketing_opt_in ? styles.toggleOn : ""}`}
                      onClick={() => toggleMarketing(!me.marketing_opt_in)}
                      data-testid="toggle-marketing"
                    >
                      <span className={styles.toggleKnob} />
                    </button>
                  </div>
                  <NavRow href="/account/settings" icon={<IGear />} label="الإعدادات" testId="row-settings" />
                </div>

                {/* ===== أخرى ===== */}
                <div className={pageStyles.acSection}>أخرى</div>
                <div className={styles.navCard}>
                  <NavRow href="/account/support" icon={<IHeadset />} label="المساعدة والدعم" testId="row-support" />
                </div>

                <button
                  type="button"
                  className={pageStyles.logoutBtn}
                  onClick={() => void logout()}
                  data-testid="logout"
                >
                  تسجيل خروج
                </button>
              </>
            )}
          </>
        )}
      </div>

      {/* ===== ورقة اللغة ===== */}
      {langSheet && me && (
        <div className={styles.sheetWrap} onClick={() => setLangSheet(false)}>
          <div className={styles.sheet} role="dialog" aria-label="اللغة" onClick={(e) => e.stopPropagation()}>
            <h2 className={styles.sheetTitle}>اللغة</h2>
            <button
              type="button"
              className={`${styles.sheetOption} ${styles.sheetOptionOn}`}
              onClick={() => setLangSheet(false)}
            >
              العربية
              <span className={styles.sheetCheck}>✓</span>
            </button>
            <button type="button" className={styles.sheetOption} disabled>
              English
              <span className={styles.sheetSoon}>قريباً</span>
            </button>
          </div>
        </div>
      )}

      <TabBar />
    </main>
  );
}
