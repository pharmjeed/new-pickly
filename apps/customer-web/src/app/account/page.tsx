"use client";

/**
 * C-59 / W-10 — حسابي المصغر: الملف + محفظة بيكلي (خلف علم in_app_wallet)
 * + سياراتي + بطاقاتي (Tokenization) + تسجيل الخروج. الزائر يُدعى للدخول.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, clearTokens, fmtSar, getToken } from "@/lib/api";
import { useApi, useIsoLayout } from "@/lib/use-api";
import { GuestGate, TabBar } from "../shell";
import styles from "../page.module.css";

interface Me {
  id: string;
  phone: string;
  full_name: string | null;
}
interface Vehicle {
  id: string;
  make_ar: string | null;
  model_ar: string | null;
  color_ar: string;
  plate_short: string;
  is_default: boolean;
}
interface Card {
  id: string;
  brand: string;
  last4: string;
  exp_month: number;
  exp_year: number;
  is_default: boolean;
  expired: boolean;
}
interface WalletEntry {
  id: string;
  amount_halalas: number;
  reference: string | null;
  created_at: string;
}
interface Wallet {
  balance_halalas: number;
  entries: WalletEntry[];
}

const CARD_AR: Record<string, string> = { visa: "فيزا", mastercard: "ماستركارد", mada: "مدى" };

/** وصف قيد المحفظة بلغة العميل — كما في تطبيق العميل */
const entryLabel = (e: WalletEntry): string => {
  if (e.reference?.startsWith("order:")) return `دفع طلب ${e.reference.slice(6).split(":")[0]}`;
  if (e.reference?.startsWith("refund:")) return "استرجاع لمحفظتك";
  if (e.reference === "admin") return e.amount_halalas > 0 ? "إيداع من بيكلي" : "تسوية من بيكلي";
  return e.amount_halalas > 0 ? "إيداع" : "خصم";
};

export default function AccountPage() {
  const router = useRouter();
  const [guest, setGuest] = useState<boolean | null>(null);
  useIsoLayout(() => setGuest(!getToken()), []);
  const authed = guest === false;
  const { data: me, error } = useApi<Me>(authed ? "/v1/customers/me" : null);
  const { data: vehiclesData, error: vehiclesError } = useApi<Vehicle[]>(
    authed ? "/v1/customers/me/vehicles" : null
  );
  const { data: cardsData, error: cardsError } = useApi<Card[]>(authed ? "/v1/customers/me/cards" : null);
  // محفظة بيكلي خلف علم in_app_wallet — فشلها لا يعطل الصفحة (خطؤها مُهمل)
  const { data: wallet } = useApi<Wallet>(authed ? "/v1/customers/me/wallet" : null);
  // كما السلوك السابق: فشل السيارات/البطاقات يعرض قائمة فارغة لا خطأ
  const vehicles = vehiclesData ?? (vehiclesError !== null ? [] : null);
  const cards = cardsData ?? (cardsError !== null ? [] : null);

  const logout = async () => {
    try {
      await api("POST", "/v1/auth/logout");
    } catch {
      /* الخروج محلي على أي حال */
    }
    clearTokens();
    router.replace("/");
  };

  return (
    <main className={styles.page}>
      <div className={styles.pageHead}>
        <h1>حسابي</h1>
      </div>

      <div className={styles.body}>
        {guest && <GuestGate next="/account" message="سجّل دخولك لإدارة حسابك وسياراتك وبطاقاتك" />}

        {guest === false && (
          <>
            {error && (
              <div className={styles.noteErr} role="alert">
                <span>{error}</span>
              </div>
            )}

            {!me && !error && (
              <div className={styles.col} aria-label="جارٍ التحميل" aria-busy="true">
                <div className={`${styles.skl} ${styles.sklH64}`} />
                <div className={`${styles.skl} ${styles.sklCard}`} />
              </div>
            )}

            {me && (
              <>
                <div className={styles.acCard} data-testid="account-profile">
                  <div className={styles.acName}>{me.full_name ?? "بدون اسم"}</div>
                  <div className={styles.acPhone}>{me.phone}</div>
                </div>

                {wallet && (
                  <>
                    <div className={styles.acSection}>محفظة بيكلي</div>
                    <div className={styles.acCard} data-testid="account-wallet">
                      <div className={styles.acBal}>{fmtSar(wallet.balance_halalas)}</div>
                      <div className={styles.acMuted}>رصيدك — يُصرف تلقائياً عند تفعيله في الدفع</div>
                      {wallet.entries.slice(0, 5).map((e) => (
                        <div key={e.id} className={styles.acRow}>
                          <span>{entryLabel(e)}</span>
                          <span className={e.amount_halalas > 0 ? styles.acAmtPlus : styles.acAmt}>
                            {e.amount_halalas > 0 ? "+" : "−"}
                            {fmtSar(Math.abs(e.amount_halalas))}
                          </span>
                        </div>
                      ))}
                      {wallet.entries.length === 0 && (
                        <div className={`${styles.acRow} ${styles.acMuted}`}>
                          لا حركات بعد — الاسترجاعات والتعويضات تصلك هنا
                        </div>
                      )}
                    </div>
                  </>
                )}

                <div className={styles.acSection}>سياراتي</div>
                <div className={styles.acCard} data-testid="account-vehicles">
                  {vehicles && vehicles.length === 0 && (
                    <div className={styles.acMuted}>لا سيارات محفوظة — تُضاف أثناء إتمام الطلب (حقلان فقط)</div>
                  )}
                  {vehicles?.map((v) => (
                    <div key={v.id} className={styles.acRow}>
                      <span>
                        {[v.model_ar ?? v.make_ar, v.color_ar].filter(Boolean).join(" · ") || v.color_ar}
                        {v.is_default && <b> · الافتراضية</b>}
                      </span>
                      <span className={styles.acAmt}>•••• {v.plate_short}</span>
                    </div>
                  ))}
                </div>
                <div className={styles.acMuted}>
                  اللوحات مشفرة ولا تظهر كاملة إلا لموظف التسليم أثناء طلبك النشط فقط.
                </div>

                <div className={styles.acSection}>بطاقاتي</div>
                <div className={styles.acCard} data-testid="account-cards">
                  {cards && cards.length === 0 && (
                    <div className={styles.acMuted}>لا بطاقات محفوظة — تُحفظ عند الدفع باختيارك، ولا نخزن رقمها أبداً</div>
                  )}
                  {cards?.map((c) => (
                    <div key={c.id} className={styles.acRow}>
                      <span>
                        {CARD_AR[c.brand] ?? c.brand}
                        {c.is_default && <b> · الافتراضية</b>}
                        {c.expired && <span style={{ color: "var(--pk-error)" }}> · منتهية</span>}
                      </span>
                      <span className={styles.acAmt}>•••• {c.last4}</span>
                    </div>
                  ))}
                </div>

                <button type="button" className={styles.logoutBtn} onClick={() => void logout()} data-testid="logout">
                  تسجيل خروج
                </button>
              </>
            )}
          </>
        )}
      </div>

      <TabBar />
    </main>
  );
}
