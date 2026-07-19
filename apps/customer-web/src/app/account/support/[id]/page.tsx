"use client";

/** C-66 — تفاصيل التذكرة: المحادثة مع الدعم + الرد ما دامت غير مغلقة. */
import { useState } from "react";
import { useParams } from "next/navigation";
import { api, getToken, ApiError } from "@/lib/api";
import { useApi, useIsoLayout } from "@/lib/use-api";
import { GuestGate, TabBar } from "../../../shell";
import { SubHead, fmtDate } from "../../ui";
import pageStyles from "../../../page.module.css";
import styles from "../../account.module.css";

interface Message {
  id: string;
  author: string;
  body: string;
  created_at: string;
}
interface Ticket {
  id: string;
  subject: string;
  status: string;
  messages?: Message[];
}

export default function TicketPage() {
  const { id } = useParams<{ id: string }>();
  const [guest, setGuest] = useState<boolean | null>(null);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useIsoLayout(() => setGuest(!getToken()), []);
  const { data: ticket, error, mutate } = useApi<Ticket>(
    guest === false ? `/v1/customers/me/support-tickets/${id}` : null
  );

  const send = async () => {
    setBusy(true);
    setErr(null);
    try {
      const fresh = await api<Ticket>("POST", `/v1/customers/me/support-tickets/${id}/messages`, {
        body: reply.trim()
      });
      mutate(() => fresh);
      setReply("");
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "تعذر الإرسال — حاول مجدداً");
    } finally {
      setBusy(false);
    }
  };

  const closed = ticket?.status === "closed";

  return (
    <main className={pageStyles.page}>
      <SubHead title={ticket?.subject ?? "التذكرة"} backHref="/account/support" />
      <div className={pageStyles.body}>
        {guest && <GuestGate next={`/account/support/${id}`} message="سجّل دخولك لعرض التذكرة" />}
        {guest === false && (
          <>
            {error && (
              <div className={pageStyles.noteErr} role="alert">
                <span>{error}</span>
              </div>
            )}
            {!ticket && !error && (
              <div className={pageStyles.col} aria-busy="true">
                <div className={`${pageStyles.skl} ${pageStyles.sklCard}`} />
              </div>
            )}
            {ticket && (
              <>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {(ticket.messages ?? []).map((m) => (
                    <div
                      key={m.id}
                      className={`${styles.bubble} ${m.author === "customer" ? styles.bubbleMine : ""}`}
                    >
                      {m.body}
                      <div className={styles.bubbleMeta}>
                        {m.author === "customer" ? "أنت" : "فريق بيكلي"} · {fmtDate(m.created_at)}
                      </div>
                    </div>
                  ))}
                </div>

                {closed ? (
                  <div className={pageStyles.acMuted}>التذكرة مغلقة — افتح تذكرة جديدة إذا احتجت شيئاً</div>
                ) : (
                  <div className={pageStyles.acCard}>
                    <textarea
                      className={`${styles.field} ${styles.fieldArea}`}
                      value={reply}
                      onChange={(e) => setReply(e.target.value)}
                      placeholder="اكتب ردك…"
                      maxLength={2000}
                      data-testid="reply-body"
                    />
                    {err && (
                      <div className={pageStyles.noteErr} role="alert" style={{ marginTop: 10 }}>
                        <span>{err}</span>
                      </div>
                    )}
                    <button
                      type="button"
                      className={styles.primaryBtn}
                      style={{ marginTop: 10 }}
                      disabled={busy || reply.trim().length < 1}
                      onClick={() => void send()}
                      data-testid="reply-submit"
                    >
                      {busy ? "جارٍ الإرسال…" : "إرسال الرد"}
                    </button>
                  </div>
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
