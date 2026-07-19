"use client";

/**
 * الإعدادات — الخصوصية والموقع (C-67)، الشروط والسياسات، حذف الحساب (C-69).
 * لا عناصر توصيل — الموقع يُشارك أثناء رحلة الاستلام فقط.
 */
import { useState } from "react";
import { api, clearTokens, getToken, ApiError } from "@/lib/api";
import { useIsoLayout } from "@/lib/use-api";
import { useRouter } from "next/navigation";
import { GuestGate, TabBar } from "../../shell";
import { IShield, SubHead } from "../ui";
import pageStyles from "../../page.module.css";
import styles from "../account.module.css";

export default function SettingsPage() {
  const router = useRouter();
  const [guest, setGuest] = useState<boolean | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useIsoLayout(() => setGuest(!getToken()), []);

  const deleteAccount = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api("POST", "/v1/customers/me/delete-request");
      clearTokens();
      router.replace("/");
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "تعذر تنفيذ الطلب — حاول مجدداً");
      setBusy(false);
    }
  };

  return (
    <main className={pageStyles.page}>
      <SubHead title="الإعدادات" />
      <div className={pageStyles.body}>
        {guest && <GuestGate next="/account/settings" message="سجّل دخولك لإدارة إعداداتك" />}
        {guest === false && (
          <>
            <div className={pageStyles.acSection}>الخصوصية والموقع</div>
            <div className={pageStyles.acCard}>
              <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                <span className={styles.rowIcon} style={{ marginTop: 2 }}>
                  <IShield />
                </span>
                <div className={pageStyles.acMuted}>
                  موقعك يُشارك أثناء رحلة الاستلام فقط ويُحذف خامه بعد ٣٠ يوماً · لوحات سياراتك مشفرة
                  ولا تظهر كاملة إلا لموظف التسليم أثناء طلبك النشط · بطاقاتك لا نخزن أرقامها أبداً
                  (Tokenization) · يمكنك طلب حذف حسابك وبياناتك في أي وقت من هذه الصفحة.
                </div>
              </div>
            </div>

            <div className={pageStyles.acSection}>الشروط والسياسات</div>
            <div className={pageStyles.acCard}>
              <div className={pageStyles.acMuted}>
                باستخدامك بيكلي أنت توافق على الشروط وسياسة الخصوصية المنشورة على{" "}
                <a href="https://thepickly.com" target="_blank" rel="noreferrer" style={{ color: "var(--pk-blue-500)", fontWeight: 700 }}>
                  thepickly.com
                </a>
              </div>
            </div>

            <div className={pageStyles.acSection}>حذف الحساب</div>
            <div className={styles.dangerCard}>
              <div className={styles.dangerTitle}>حذف حسابي نهائياً</div>
              <div className={pageStyles.acMuted} style={{ marginTop: 6 }}>
                يُقفل حسابك فوراً وتدخل بياناتك فترة المعالجة ثم تُحذف. لا يمكن الحذف مع وجود طلب نشط
                أو استرجاع مفتوح. رصيد محفظتك ونقاطك تسقط بالحذف.
              </div>
              {err && (
                <div className={pageStyles.noteErr} role="alert" style={{ marginTop: 10 }}>
                  <span>{err}</span>
                </div>
              )}
              {!confirming ? (
                <button
                  type="button"
                  className={styles.dangerBtn}
                  onClick={() => setConfirming(true)}
                  data-testid="delete-account"
                >
                  حذف الحساب
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className={`${styles.dangerBtn} ${styles.dangerBtnSolid}`}
                    disabled={busy}
                    onClick={() => void deleteAccount()}
                    data-testid="delete-account-confirm"
                  >
                    {busy ? "جارٍ الحذف…" : "متأكد — احذف حسابي"}
                  </button>
                  <button
                    type="button"
                    className={styles.dangerBtn}
                    style={{ borderColor: "var(--pk-line)", color: "var(--pk-text-2)" }}
                    disabled={busy}
                    onClick={() => setConfirming(false)}
                  >
                    تراجع
                  </button>
                </>
              )}
            </div>
          </>
        )}
      </div>
      <TabBar />
    </main>
  );
}
