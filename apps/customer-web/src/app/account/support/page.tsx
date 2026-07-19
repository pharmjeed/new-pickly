"use client";

/** C-65 — المساعدة والدعم: تذاكرك + فتح تذكرة جديدة (خلف علم support_tickets). */
import { useState } from "react";
import Link from "next/link";
import { api, getToken, ApiError } from "@/lib/api";
import { useApi, useIsoLayout } from "@/lib/use-api";
import { GuestGate, TabBar } from "../../shell";
import { IChevron, SubHead, fmtDate } from "../ui";
import pageStyles from "../../page.module.css";
import styles from "../account.module.css";

interface Ticket {
  id: string;
  subject: string;
  status: string;
  created_at: string;
  updated_at: string;
}

const TICKET_STATUS_AR: Record<string, { label: string; cls: "ok" | "warn" | "muted" }> = {
  open: { label: "مفتوحة", cls: "ok" },
  pending_customer: { label: "بانتظار ردّك", cls: "warn" },
  pending_merchant: { label: "لدى المطعم", cls: "warn" },
  resolved: { label: "حُلّت", cls: "muted" },
  closed: { label: "مغلقة", cls: "muted" }
};

export default function SupportPage() {
  const [guest, setGuest] = useState<boolean | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useIsoLayout(() => setGuest(!getToken()), []);
  const { data: tickets, error, mutate } = useApi<Ticket[]>(
    guest === false ? "/v1/customers/me/support-tickets" : null
  );

  const create = async () => {
    setBusy(true);
    setErr(null);
    try {
      const t = await api<Ticket>("POST", "/v1/customers/me/support-tickets", {
        subject: subject.trim(),
        body: body.trim()
      });
      mutate((prev) => [t, ...(prev ?? [])]);
      setSubject("");
      setBody("");
      setShowForm(false);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "تعذر فتح التذكرة — حاول مجدداً");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className={pageStyles.page}>
      <SubHead title="المساعدة والدعم" />
      <div className={pageStyles.body}>
        {guest && <GuestGate next="/account/support" message="سجّل دخولك للتواصل مع الدعم" />}
        {guest === false && (
          <>
            {error && (
              <div className={pageStyles.noteErr} role="alert">
                <span>{error}</span>
              </div>
            )}

            {!showForm ? (
              <button
                type="button"
                className={styles.primaryBtn}
                onClick={() => setShowForm(true)}
                data-testid="new-ticket"
              >
                + تذكرة جديدة
              </button>
            ) : (
              <div className={pageStyles.acCard}>
                <div className={styles.fieldLabel}>الموضوع</div>
                <input
                  className={styles.field}
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="مثال: مشكلة في طلب أمس"
                  maxLength={120}
                  data-testid="ticket-subject"
                />
                <div className={styles.fieldLabel} style={{ marginTop: 12 }}>
                  التفاصيل
                </div>
                <textarea
                  className={`${styles.field} ${styles.fieldArea}`}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="اشرح لنا وش صار — وبنرد عليك هنا"
                  maxLength={2000}
                  data-testid="ticket-body"
                />
                {err && (
                  <div className={pageStyles.noteErr} role="alert" style={{ marginTop: 10 }}>
                    <span>{err}</span>
                  </div>
                )}
                <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                  <button
                    type="button"
                    className={styles.primaryBtn}
                    disabled={busy || subject.trim().length < 3 || body.trim().length < 1}
                    onClick={() => void create()}
                    data-testid="ticket-submit"
                  >
                    {busy ? "جارٍ الإرسال…" : "إرسال"}
                  </button>
                  <button
                    type="button"
                    className={styles.dangerBtn}
                    style={{ marginTop: 0, width: "auto", paddingInline: 18, borderColor: "var(--pk-line)", color: "var(--pk-text-2)" }}
                    onClick={() => setShowForm(false)}
                  >
                    إلغاء
                  </button>
                </div>
              </div>
            )}

            <div className={pageStyles.acSection}>تذاكري</div>
            {tickets && tickets.length === 0 && (
              <div className={pageStyles.acCard}>
                <div className={pageStyles.acMuted}>لا تذاكر — إذا واجهتك أي مشكلة افتح تذكرة وبنتابعها معك</div>
              </div>
            )}
            {tickets && tickets.length > 0 && (
              <div className={styles.navCard}>
                {tickets.map((t) => {
                  const st = TICKET_STATUS_AR[t.status] ?? { label: t.status, cls: "muted" as const };
                  return (
                    <Link key={t.id} href={`/account/support/${t.id}`} className={styles.navRow} data-testid="ticket-row">
                      <span className={styles.rowLabel}>
                        {t.subject}
                        <span className={styles.bubbleMeta}> {fmtDate(t.updated_at)}</span>
                      </span>
                      <span
                        className={`${styles.chip} ${st.cls === "ok" ? styles.chipOk : st.cls === "warn" ? styles.chipWarn : ""}`}
                      >
                        {st.label}
                      </span>
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
