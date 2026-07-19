"use client";

/** ملفي الشخصي — تعديل الاسم؛ الجوال هو مُعرّف الدخول ولا يُعدّل من هنا. */
import { useEffect, useState } from "react";
import { api, getToken, ApiError } from "@/lib/api";
import { useApi, useIsoLayout } from "@/lib/use-api";
import { GuestGate, TabBar } from "../../shell";
import { SubHead } from "../ui";
import pageStyles from "../../page.module.css";
import styles from "../account.module.css";

interface Me {
  id: string;
  phone: string;
  full_name: string | null;
}

export default function ProfilePage() {
  const [guest, setGuest] = useState<boolean | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useIsoLayout(() => setGuest(!getToken()), []);
  const { data: me, error, mutate } = useApi<Me>(guest === false ? "/v1/customers/me" : null);

  useEffect(() => {
    if (me) setName(me.full_name ?? "");
  }, [me]);

  const save = async () => {
    setBusy(true);
    setErr(null);
    setSaved(false);
    try {
      await api("PATCH", "/v1/customers/me", { full_name: name.trim() });
      mutate((prev) => (prev ? { ...prev, full_name: name.trim() } : prev));
      setSaved(true);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "تعذر الحفظ — حاول مجدداً");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className={pageStyles.page}>
      <SubHead title="ملفي الشخصي" />
      <div className={pageStyles.body}>
        {guest && <GuestGate next="/account/profile" message="سجّل دخولك لتعديل ملفك الشخصي" />}
        {guest === false && (
          <>
            {error && (
              <div className={pageStyles.noteErr} role="alert">
                <span>{error}</span>
              </div>
            )}
            {me && (
              <div className={pageStyles.acCard}>
                <div className={styles.fieldLabel}>الاسم</div>
                <input
                  className={styles.field}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="اسمك الكريم"
                  maxLength={80}
                  data-testid="profile-name"
                />
                <div className={styles.fieldLabel} style={{ marginTop: 14 }}>
                  الجوال
                </div>
                <input className={styles.field} value={me.phone} disabled dir="ltr" />
                <div className={pageStyles.acMuted} style={{ marginTop: 6 }}>
                  الجوال هو مفتاح دخولك — لتغييره تواصل مع الدعم
                </div>
                {err && (
                  <div className={pageStyles.noteErr} role="alert" style={{ marginTop: 10 }}>
                    <span>{err}</span>
                  </div>
                )}
                {saved && <div className={styles.okNote} style={{ marginTop: 10 }}>تم الحفظ ✓</div>}
                <button
                  type="button"
                  className={styles.primaryBtn}
                  style={{ marginTop: 14 }}
                  disabled={busy || name.trim().length < 2 || name.trim() === (me.full_name ?? "")}
                  onClick={() => void save()}
                  data-testid="profile-save"
                >
                  {busy ? "جارٍ الحفظ…" : "حفظ"}
                </button>
              </div>
            )}
          </>
        )}
      </div>
      <TabBar />
    </main>
  );
}
