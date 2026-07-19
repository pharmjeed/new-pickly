"use client";

/** C-61 — طرق الدفع: بطاقاتك المحفوظة (Tokenization فقط — لا نخزن الرقم أبداً). */
import { useState } from "react";
import { api, getToken } from "@/lib/api";
import { useApi, useIsoLayout } from "@/lib/use-api";
import { GuestGate, TabBar } from "../../shell";
import { ITrash, SubHead } from "../ui";
import pageStyles from "../../page.module.css";
import styles from "../account.module.css";

interface Card {
  id: string;
  brand: string;
  last4: string;
  exp_month: number;
  exp_year: number;
  is_default: boolean;
  expired: boolean;
}

const CARD_AR: Record<string, string> = { visa: "فيزا", mastercard: "ماستركارد", mada: "مدى" };

export default function PaymentsPage() {
  const [guest, setGuest] = useState<boolean | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  useIsoLayout(() => setGuest(!getToken()), []);
  const { data: cards, error, mutate } = useApi<Card[]>(guest === false ? "/v1/customers/me/cards" : null);

  const remove = async (id: string) => {
    if (!window.confirm("حذف هذه البطاقة من حسابك؟")) return;
    setBusyId(id);
    try {
      await api("DELETE", `/v1/customers/me/cards/${id}`);
      mutate((prev) => prev?.filter((c) => c.id !== id) ?? prev);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <main className={pageStyles.page}>
      <SubHead title="طرق الدفع" />
      <div className={pageStyles.body}>
        {guest && <GuestGate next="/account/payments" message="سجّل دخولك لإدارة بطاقاتك" />}
        {guest === false && (
          <>
            {error && (
              <div className={pageStyles.noteErr} role="alert">
                <span>{error}</span>
              </div>
            )}
            {cards && cards.length === 0 && (
              <div className={pageStyles.acCard}>
                <div className={pageStyles.acMuted}>
                  لا بطاقات محفوظة — تُحفظ عند الدفع باختيارك، ولا نخزن رقمها أبداً
                </div>
              </div>
            )}
            {cards?.map((c) => (
              <div key={c.id} className={pageStyles.acCard} data-testid="card-row">
                <div className={pageStyles.acRow}>
                  <span>
                    {CARD_AR[c.brand] ?? c.brand}
                    {c.is_default && <b> · الافتراضية</b>}
                    {c.expired && <span style={{ color: "var(--pk-error)" }}> · منتهية</span>}
                  </span>
                  <span className={pageStyles.acAmt}>•••• {c.last4}</span>
                </div>
                <button
                  type="button"
                  className={styles.dangerBtn}
                  disabled={busyId === c.id}
                  onClick={() => void remove(c.id)}
                >
                  <ITrash /> حذف البطاقة
                </button>
              </div>
            ))}
            <div className={pageStyles.acMuted}>
              الدفع عبر Apple Pay وبطاقات مدى/فيزا/ماستركارد وSTC Pay — وإضافة بطاقة جديدة تتم أثناء الدفع.
            </div>
          </>
        )}
      </div>
      <TabBar />
    </main>
  );
}
