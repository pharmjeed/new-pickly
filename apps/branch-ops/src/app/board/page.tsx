"use client";

/**
 * B-03: لوحة التشغيل الجامعة (design/branch/B-03.html) — التبويبات = الحالات،
 * القبول/الرفض/التسليم على البطاقة، عداد قبول BR-1، طابور الوصول (BR-9)،
 * الترتيب حسب زمن الوصول (docs/21§1).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import s from "./board.module.css";

interface Card {
  id: string;
  display_code: string;
  order_status: string;
  customer_first_name: string;
  customer_phone_masked: string;
  vehicle_summary: string | null;
  parking_spot: string | null;
  items_count: number;
  total_halalas: number;
  eta_minutes: number | null;
  accept_deadline_at: string | null;
  arrived_at: string | null;
  created_at: string;
}

interface QueueEntry {
  order_id: string;
  display_code: string;
  position: number;
  vehicle_summary: string | null;
  parking_spot: string | null;
  waiting_seconds: number;
  service_target_exceeded: boolean;
}

interface OrderDetails {
  id: string;
  display_code: string;
  order_status: string;
  items: Array<{ id: string; name_ar: string; quantity: number; modifiers: string[]; notes: string | null }>;
  customer_notes: string | null;
  parking_spot: string | null;
  vehicle_summary: string | null;
}

const TABS = [
  ["new", "جديدة"],
  ["preparing", "قيد التحضير"],
  ["ready", "جاهزة"],
  ["arrived", "وصلوا"],
  ["completed", "مكتملة"]
] as const;

function cardState(status: string): string {
  if (status === "MERCHANT_PENDING") return "new";
  if (["MERCHANT_ACCEPTED", "PREPARING"].includes(status)) return "prep";
  if (["CUSTOMER_NEARBY", "CUSTOMER_ON_THE_WAY"].includes(status)) return "near";
  if (["CUSTOMER_ARRIVED", "HANDOFF_IN_PROGRESS"].includes(status)) return "arrived";
  if (status === "COMPLETED") return "done";
  return "prep";
}

/** crypto.randomUUID غير متوفرة خارج السياقات الآمنة (نشر HTTP) — بديل RFC4122 v4 عبر getRandomValues */
function uuid(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x40;
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const pad2 = (n: number): string => String(n).padStart(2, "0");
/** أرقام لاتينية بصيغة MM:SS (Mono) */
const mmss = (totalSeconds: number): string =>
  `${pad2(Math.floor(Math.max(0, totalSeconds) / 60))}:${pad2(Math.max(0, totalSeconds) % 60)}`;
const sar = (halalas: number): string => (halalas / 100).toFixed(2);

/** شارة بيكلي — كتاب الهوية */
function Badge() {
  return (
    <svg width="38" height="38" viewBox="0 0 100 100" aria-hidden="true">
      <rect width="100" height="100" rx="24" fill="var(--pk-lime-500)" />
      <g transform="skewX(-8) translate(4,0)" stroke="var(--pk-ink-900)" fill="none">
        <path d="M36,34 L62,34 L59,72 L39,72 Z" strokeWidth="4" strokeLinejoin="round" />
        <path d="M43,34 Q49,24 55,34" strokeWidth="3.5" strokeLinecap="round" />
        <path d="M70,40 H88" strokeWidth="5" strokeLinecap="round" />
        <path d="M74,52 H88" strokeWidth="5" strokeLinecap="round" opacity="0.55" />
        <path d="M70,64 H80" strokeWidth="5" strokeLinecap="round" opacity="0.3" />
      </g>
    </svg>
  );
}

export default function BoardPage() {
  const router = useRouter();
  const [branchId, setBranchId] = useState<string | null>(null);
  const [tab, setTab] = useState<string>("new");
  const [cards, setCards] = useState<Card[]>([]);
  const [queue, setQueue] = useState<QueueEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [codeFor, setCodeFor] = useState<string | null>(null);
  const [codeVal, setCodeVal] = useState("");
  const [now, setNow] = useState<number | null>(null);
  // استعراض تفاصيل الطلب قبل القبول
  const [detailsFor, setDetailsFor] = useState<string | null>(null);
  const [details, setDetails] = useState<OrderDetails | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);

  const token = typeof window !== "undefined" ? localStorage.getItem("bo_token") : null;

  const call = useCallback(
    async <T,>(method: string, path: string, body?: unknown, idem = false): Promise<T> => {
      const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
      if (body !== undefined) headers["Content-Type"] = "application/json";
      if (idem) headers["Idempotency-Key"] = uuid();
      const res = await fetch(`/api${path}`, {
        method,
        headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {})
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: { message_ar?: string } };
        throw new Error(data.error?.message_ar ?? `خطأ ${res.status}`);
      }
      return (await res.json()) as T;
    },
    [token]
  );

  // نطاق الفرع من التوكن (JWT payload)
  useEffect(() => {
    if (!token) {
      router.push("/");
      return;
    }
    try {
      // حمولة JWT بترميز base64url — تطبيعها قبل atob وإلا رُميت InvalidCharacterError وطُردت الجلسة
      const b64 = (token.split(".")[1] ?? "").replace(/-/g, "+").replace(/_/g, "/");
      const payload = JSON.parse(atob(b64)) as { branch_ids?: string[] };
      setBranchId(payload.branch_ids?.[0] ?? null);
    } catch {
      router.push("/");
    }
  }, [token, router]);

  // ساعة الترويسة + عدادات BR-1 التنازلية (أرقام لاتينية Mono)
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const refresh = useCallback(async () => {
    if (!branchId) return;
    try {
      const list = await call<Card[]>("GET", `/v1/merchant/orders?branch_id=${branchId}&tab=${tab}`);
      setCards(list);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    // طابور الوصول (B-11 / BR-9) — تحسين عرض لتبويب «وصلوا» فقط
    if (tab === "arrived") {
      try {
        setQueue(await call<QueueEntry[]>("GET", `/v1/merchant/arrival-queue?branch_id=${branchId}`));
      } catch {
        setQueue([]);
      }
    }
  }, [branchId, tab, call]);

  useEffect(() => {
    void refresh();
    const t = setInterval(refresh, 2500);
    return () => clearInterval(t);
  }, [refresh]);

  const act = async (path: string, body?: unknown, idem = false) => {
    try {
      await call("POST", path, body, idem);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  // استعراض/إخفاء تفاصيل الطلب قبل القبول
  const toggleDetails = async (id: string) => {
    if (detailsFor === id) {
      setDetailsFor(null);
      setDetails(null);
      return;
    }
    setDetailsFor(id);
    setDetails(null);
    setDetailsLoading(true);
    try {
      setDetails(await call<OrderDetails>("GET", `/v1/merchant/orders/${id}/details`));
    } catch (e) {
      setError((e as Error).message);
      setDetailsFor(null);
    } finally {
      setDetailsLoading(false);
    }
  };

  const queueByOrder = useMemo(() => new Map(queue.map((q) => [q.order_id, q])), [queue]);

  // الترتيب حسب زمن الوصول: تبويب «وصلوا» بترتيب الطابور (BR-9)، والبقية بزمن إنشاء الطلب
  const sorted = useMemo(() => {
    const list = [...cards];
    if (tab === "arrived") {
      list.sort((a, b) => {
        const pa = queueByOrder.get(a.id)?.position ?? Number.MAX_SAFE_INTEGER;
        const pb = queueByOrder.get(b.id)?.position ?? Number.MAX_SAFE_INTEGER;
        if (pa !== pb) return pa - pb;
        return (a.arrived_at ?? a.created_at).localeCompare(b.arrived_at ?? b.created_at);
      });
    } else {
      list.sort((a, b) => a.created_at.localeCompare(b.created_at));
    }
    return list;
  }, [cards, tab, queueByOrder]);

  const clock =
    now === null ? "--:--" : `${pad2(new Date(now).getHours())}:${pad2(new Date(now).getMinutes())}`;

  return (
    <main className={s.board}>
      {/* ترويسة اللوحة */}
      <header className={s.bhdr}>
        <div className={s.brand}>
          <Badge />
          <div>
            <b>بيكلي — شاشة الفرع</b>
            <div className={s.sub}>لوحة التشغيل · شاشة الاستلام</div>
          </div>
        </div>
        <div className={s.sp}>
          <span className={s.pill}>
            <i className={s.dot} /> متصل
          </span>
          <span className={s.clock}>{clock}</span>
        </div>
      </header>

      {/* التبويبات = الحالات (بعداد التبويب النشط) */}
      <nav className={s.btabs} role="tablist">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            className={`${s.btab} ${tab === key ? s.btabOn : ""}`}
            data-testid={`tab-${key}`}
            onClick={() => setTab(key)}
          >
            {tab === key && (
              <span
                className={`${s.n} ${
                  key === "new"
                    ? s.nNew
                    : key === "preparing"
                      ? s.nPrep
                      : key === "ready"
                        ? s.nNear
                        : key === "arrived"
                          ? s.nArr
                          : s.nDone
                }`}
              >
                {cards.length}
              </span>
            )}
            {label}
          </button>
        ))}
      </nav>

      <section className={s.bmain}>
        {error && (
          <div className={s.noteErr} data-testid="board-error">
            {error}
          </div>
        )}

        <div className={s.grid}>
          {sorted.map((c) => {
            const q = tab === "arrived" ? queueByOrder.get(c.id) : undefined;
            const deadline = c.accept_deadline_at ? Date.parse(c.accept_deadline_at) : null;
            const remainMs =
              c.order_status === "MERCHANT_PENDING" && deadline !== null && now !== null
                ? Math.max(0, deadline - now)
                : null;
            const windowMs =
              deadline !== null ? Math.max(1000, deadline - Date.parse(c.created_at)) : null;
            return (
              <article
                key={c.id}
                className={`${s.ocard} ${q?.service_target_exceeded ? s.over : ""}`}
                data-state={cardState(c.order_status)}
                data-testid="order-card"
              >
                <div className={s.hd}>
                  {q && <span className={s.pos}>{q.position}</span>}
                  <span className={s.oid}>{c.display_code}</span>
                  <div className={s.grow}>
                    {/* بطاقة السيارة أكبر عنصر — كتاب الهوية §11 */}
                    {c.vehicle_summary && <div className={s.vehicle}>{c.vehicle_summary}</div>}
                    <div className={s.meta}>
                      {c.customer_first_name} · <span className={s.mono}>{c.customer_phone_masked}</span> ·{" "}
                      {c.items_count} أصناف · <span className={s.mono}>{sar(c.total_halalas)} SAR</span>
                      {c.eta_minutes !== null && (
                        <>
                          {" "}
                          · ETA <span className={s.mono}>{c.eta_minutes}</span> د
                        </>
                      )}
                      {q && (
                        <>
                          {" "}
                          · انتظار{" "}
                          <b className={`${s.mono} ${q.service_target_exceeded ? s.waitOver : ""}`}>
                            {mmss(q.waiting_seconds)}
                          </b>
                          {q.service_target_exceeded && <b className={s.waitOver}> — تجاوز المستهدف</b>}
                        </>
                      )}
                    </div>
                  </div>
                  <div className={s.end}>
                    {remainMs !== null && (
                      <div className={s.acceptTimer}>
                        <span className={s.countLbl}>مهلة القبول (BR-1)</span>
                        <span className={s.count}>
                          <span className={s.countT}>{mmss(Math.floor(remainMs / 1000))}</span>
                        </span>
                      </div>
                    )}
                    {c.parking_spot && <span className={s.slot}>موقف {c.parking_spot}</span>}
                  </div>
                </div>

                {remainMs !== null && windowMs !== null && (
                  <div className={s.timerbar}>
                    <i
                      className={s.timerfill}
                      style={{ width: `${Math.min(100, Math.round((remainMs / windowMs) * 100))}%` }}
                    />
                  </div>
                )}

                {/* استعراض محتوى الطلب — يظهر لأي حالة عند الطلب، ومهم قبل القبول */}
                {detailsFor === c.id && (
                  <div className={s.details} data-testid="order-details">
                    {detailsLoading || !details ? (
                      <div className={s.detailsLoading}>…جارٍ استعراض الطلب</div>
                    ) : (
                      <>
                        <div className={s.detailsHd}>محتوى الطلب</div>
                        <ul className={s.itemList}>
                          {details.items.map((it) => (
                            <li key={it.id} className={s.itemRow}>
                              <span className={s.itemQty}>{it.quantity}×</span>
                              <span className={s.itemName}>
                                {it.name_ar}
                                {it.modifiers.length > 0 && (
                                  <span className={s.itemMods}> — {it.modifiers.join(" · ")}</span>
                                )}
                                {it.notes && <span className={s.itemNote}> ✎ {it.notes}</span>}
                              </span>
                            </li>
                          ))}
                        </ul>
                        {details.customer_notes && (
                          <div className={s.custNote}>ملاحظة العميل: {details.customer_notes}</div>
                        )}
                      </>
                    )}
                  </div>
                )}

                <div className={s.actions}>
                  {c.order_status === "MERCHANT_PENDING" && (
                    <>
                      <button
                        className={`${s.bbtn} ${s.gray}`}
                        data-testid="view-order"
                        onClick={() => toggleDetails(c.id)}
                      >
                        {detailsFor === c.id ? "إخفاء" : "استعراض الطلب"}
                      </button>
                      <button
                        className={s.bbtn}
                        data-testid="accept-order"
                        onClick={() => act(`/v1/merchant/orders/${c.id}/accept`, {}, true)}
                      >
                        قبول
                      </button>
                      <button
                        className={`${s.bbtn} ${s.red}`}
                        data-testid="reject-order"
                        onClick={() => act(`/v1/merchant/orders/${c.id}/reject`, { reason: "high_load" }, true)}
                      >
                        رفض
                      </button>
                    </>
                  )}
                  {c.order_status === "MERCHANT_ACCEPTED" && (
                    <button
                      className={`${s.bbtn} ${s.gray}`}
                      data-testid="start-preparing"
                      onClick={() => act(`/v1/merchant/orders/${c.id}/preparing`)}
                    >
                      بدء التجهيز
                    </button>
                  )}
                  {c.order_status === "PREPARING" && (
                    <button
                      className={s.bbtn}
                      data-testid="mark-ready"
                      onClick={() => act(`/v1/merchant/orders/${c.id}/ready`, {})}
                    >
                      جاهز
                    </button>
                  )}
                  {c.order_status === "CUSTOMER_ARRIVED" && (
                    <button
                      className={`${s.bbtn} ${s.orange}`}
                      data-testid="handoff-start"
                      onClick={() => act(`/v1/merchant/orders/${c.id}/handoff/start`)}
                    >
                      خرج الموظف
                    </button>
                  )}
                  {c.order_status === "HANDOFF_IN_PROGRESS" && codeFor !== c.id && (
                    <button
                      className={`${s.bbtn} ${s.green}`}
                      data-testid="handoff-open-code"
                      onClick={() => {
                        setCodeFor(c.id);
                        setCodeVal("");
                      }}
                    >
                      تحقق وسلّم
                    </button>
                  )}
                  {codeFor === c.id && (
                    <div className={s.codeRow}>
                      <input
                        className={s.codeInput}
                        data-testid="handoff-code-input"
                        placeholder="رمز العميل"
                        inputMode="numeric"
                        maxLength={4}
                        value={codeVal}
                        onChange={(e) => setCodeVal(e.target.value)}
                      />
                      <button
                        className={`${s.bbtn} ${s.green}`}
                        data-testid="handoff-complete"
                        disabled={codeVal.length !== 4}
                        onClick={() =>
                          act(`/v1/merchant/orders/${c.id}/handoff/complete`, {
                            verification: { method: "code", code: codeVal }
                          })
                        }
                      >
                        سلّمت
                      </button>
                    </div>
                  )}
                  {c.order_status === "COMPLETED" && <span className={s.done}>تم التسليم ✓</span>}
                </div>
              </article>
            );
          })}
        </div>

        {cards.length === 0 && (
          <div className={s.empty}>
            <b>لا طلبات في هذا التبويب</b>
            <p>البطاقات تظهر هنا فور تغيّر حالتها — التحديث كل ثوانٍ.</p>
          </div>
        )}
      </section>
    </main>
  );
}
