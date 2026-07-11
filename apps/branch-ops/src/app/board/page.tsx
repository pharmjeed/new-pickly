"use client";

/**
 * B-03: لوحة التشغيل الجامعة (design/branch/B-03.html) — التبويبات = الحالات،
 * القبول/الرفض/التسليم على البطاقة، عداد قبول BR-1، طابور الوصول (BR-9)،
 * الترتيب حسب زمن الوصول (docs/21§1).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  /** FR-C06: asap | later | scheduled — «لاحقاً» يعني تجهيزاً غير موقوت بالوصول */
  pickup_time: "asap" | "later" | "scheduled";
  scheduled_slot_start: string | null;
  /** وقت التجهيز المتوقع المحدد عند القبول + موافقة العميل عليه */
  prep_minutes: number | null;
  prep_time_confirmed_at: string | null;
  /** مهلتا ما بعد القبول (5 د لكلٍّ — BR-2) لعداد «بانتظار الدفع» */
  prep_confirm_deadline_at: string | null;
  payment_deadline_at: string | null;
  /** مسار التجهيز الموازي (docs/05§3) — يتقدم ولو كان العميل في الطريق أو واصلاً */
  preparing_at: string | null;
  ready_at: string | null;
  created_at: string;
}

/** رادار الوصول — docs/14§5-مكرر */
interface RadarEntry {
  order_id: string;
  display_code: string;
  order_status: string;
  customer_first_name: string;
  vehicle_summary: string | null;
  prep_minutes: number | null;
  preparing_at: string | null;
  ready_at: string | null;
  arrived_at: string | null;
  trip_active: boolean;
  eta_minutes: number | null;
  eta_updated_at: string | null;
}

/** بين القبول والدفع — معلوماتي فقط، التحضير يبدأ آلياً عند الدفع */
const AWAITING_PAYMENT_STATES = ["MERCHANT_ACCEPTED", "PAYMENT_PENDING", "PAYMENT_FAILED"];

/** خيارات وقت التجهيز المتوقع عند القبول — بالدقائق */
const PREP_CHOICES = [10, 15, 20, 25] as const;

/** رحلة العميل — التجهيز يستمر موازياً لها بالحقائق (preparing_at/ready_at) */
const JOURNEY_STATES = ["CUSTOMER_ON_THE_WAY", "CUSTOMER_NEARBY", "CUSTOMER_ARRIVED"];

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
  ["awaiting_payment", "بانتظار الدفع"],
  ["preparing", "قيد التحضير"],
  ["ready", "جاهزة"],
  ["arrived", "وصلوا"],
  ["completed", "مكتملة"]
] as const;

function cardState(status: string): string {
  if (status === "MERCHANT_PENDING") return "new";
  if (AWAITING_PAYMENT_STATES.includes(status)) return "new";
  if (status === "PREPARING") return "prep";
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
  // رادار الوصول — docs/14§5-مكرر: مستقل عن التبويب، يتحدث دائماً
  const [radar, setRadar] = useState<RadarEntry[]>([]);
  const redSeen = useRef<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [codeFor, setCodeFor] = useState<string | null>(null);
  const [codeVal, setCodeVal] = useState("");
  const [now, setNow] = useState<number | null>(null);
  // القبول على خطوتين: اختيار وقت التجهيز المتوقع (10/15/20/25 د) ثم التأكيد
  const [acceptFor, setAcceptFor] = useState<string | null>(null);
  const [prepSel, setPrepSel] = useState<number>(15);
  const [accepting, setAccepting] = useState(false);
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

  /** تنبيه صوتي — BN-05أ: العميل على بعد دقيقة أو وصل (بلا ملفات صوت — WebAudio) */
  const beep = useCallback(() => {
    try {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.18, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
      osc.start();
      osc.stop(ctx.currentTime + 0.5);
    } catch {
      /* الصوت تحسين — الرادار المرئي يكفي */
    }
  }, []);

  // رادار الوصول — تحديث مستمر مستقل عن التبويب + صوت عند دخول طلب النطاق الأحمر
  useEffect(() => {
    if (!branchId) return;
    let stopped = false;
    const tick = async () => {
      try {
        const entries = await call<RadarEntry[]>("GET", `/v1/merchant/radar?branch_id=${branchId}`);
        if (stopped) return;
        setRadar(entries);
        for (const e of entries) {
          const red = e.arrived_at !== null || (e.trip_active && e.eta_minutes !== null && e.eta_minutes <= 1);
          if (red && !redSeen.current.has(e.order_id)) {
            redSeen.current.add(e.order_id);
            beep();
          }
        }
      } catch {
        /* الرادار تحسين عرض — لا يوقف اللوحة */
      }
    };
    void tick();
    const t = setInterval(tick, 2500);
    return () => {
      stopped = true;
      clearInterval(t);
    };
  }, [branchId, call, beep]);

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

  // ===== رادار الوصول: مقارنة المتبقي للوصول بما مضى من دقائق التجهيز (docs/14§5-مكرر) =====
  const prepElapsedMin = (e: RadarEntry): number | null =>
    e.preparing_at && now !== null ? Math.max(0, Math.floor((now - Date.parse(e.preparing_at)) / 60_000)) : null;
  const prepRemainingMin = (e: RadarEntry): number | null => {
    if (e.ready_at || e.prep_minutes === null) return null;
    const elapsed = prepElapsedMin(e);
    return elapsed === null ? null : e.prep_minutes - elapsed;
  };
  const radarTone = (e: RadarEntry): "red" | "amber" | "green" | "gray" => {
    if (e.arrived_at || (e.trip_active && e.eta_minutes !== null && e.eta_minutes <= 1)) return "red";
    if (!e.trip_active || e.eta_minutes === null) return "gray";
    if (e.ready_at) return "green";
    const remaining = prepRemainingMin(e);
    if (remaining !== null && e.eta_minutes < remaining) return "amber";
    return "green";
  };
  const TONE_ORDER = { red: 0, amber: 1, green: 2, gray: 3 } as const;
  const radarSorted = [...radar].sort((a, b) => {
    const d = TONE_ORDER[radarTone(a)] - TONE_ORDER[radarTone(b)];
    if (d !== 0) return d;
    return (a.eta_minutes ?? 999) - (b.eta_minutes ?? 999);
  });

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

      <div className={s.workRow}>
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
            // العلامة الحمراء: العميل على بعد دقيقة أو وصل (docs/14§5-مكرر)
            const redAlert =
              c.arrived_at !== null || (c.eta_minutes !== null && c.eta_minutes <= 1);
            return (
              <article
                key={c.id}
                className={`${s.ocard} ${q?.service_target_exceeded ? s.over : ""} ${redAlert ? s.redCard : ""}`}
                data-state={cardState(c.order_status)}
                data-testid="order-card"
              >
                {redAlert && (
                  <span className={s.redFlag} data-testid="red-flag">
                    🔴 {c.arrived_at ? "العميل واصل" : "يصل خلال دقيقة"}
                  </span>
                )}
                <div className={s.hd}>
                  {q && <span className={s.pos}>{q.position}</span>}
                  <span className={s.oid}>{c.display_code}</span>
                  <div className={s.grow}>
                    {/* بطاقة السيارة أكبر عنصر — كتاب الهوية §11 */}
                    {c.vehicle_summary && <div className={s.vehicle}>{c.vehicle_summary}</div>}
                    <div className={s.meta}>
                      {/* وسم وقت الاستلام — BR-5 و«سأتحرك لاحقاً» (FR-C06) */}
                      {c.pickup_time === "scheduled" && (
                        <b style={{ color: "var(--pk-warn, #B7791F)" }} data-testid="pickup-tag">
                          مجدول{c.scheduled_slot_start ? ` ${new Date(c.scheduled_slot_start).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` : ""} ·{" "}
                        </b>
                      )}
                      {c.pickup_time === "later" && (
                        <b style={{ color: "var(--pk-lime-900, #4C7A1C)" }} data-testid="pickup-tag">
                          سيتحرك لاحقاً — جهّزوا براحتكم ·{" "}
                        </b>
                      )}
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
                  {c.order_status === "MERCHANT_PENDING" && acceptFor !== c.id && (
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
                        onClick={() => {
                          setAcceptFor(c.id);
                          setPrepSel(15);
                        }}
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
                  {c.order_status === "MERCHANT_PENDING" && acceptFor === c.id && (
                    <div className={s.prepPick} data-testid="prep-time-picker">
                      <span className={s.prepLbl}>الوقت المتوقع لتجهيز الطلب:</span>
                      <div className={s.prepOpts}>
                        {PREP_CHOICES.map((m) => (
                          <button
                            key={m}
                            type="button"
                            className={`${s.prepOpt} ${prepSel === m ? s.prepOptOn : ""}`}
                            data-testid={`prep-${m}`}
                            onClick={() => setPrepSel(m)}
                          >
                            <b className={s.mono}>{m}</b> د
                          </button>
                        ))}
                      </div>
                      <div className={s.prepActions}>
                        <button
                          className={s.bbtn}
                          data-testid="confirm-accept"
                          disabled={accepting}
                          onClick={async () => {
                            setAccepting(true);
                            try {
                              await act(`/v1/merchant/orders/${c.id}/accept`, { prep_time_override_minutes: prepSel }, true);
                              setAcceptFor(null);
                            } finally {
                              setAccepting(false);
                            }
                          }}
                        >
                          تأكيد القبول ({prepSel} د)
                        </button>
                        <button
                          className={`${s.bbtn} ${s.gray}`}
                          data-testid="cancel-accept"
                          disabled={accepting}
                          onClick={() => setAcceptFor(null)}
                        >
                          رجوع
                        </button>
                      </div>
                    </div>
                  )}
                  {/* بين القبول والدفع — معلوماتي فقط؛ التحضير يبدأ آلياً عند نجاح الدفع (BR-2) */}
                  {AWAITING_PAYMENT_STATES.includes(c.order_status) && (
                    <>
                      {c.order_status === "MERCHANT_ACCEPTED" && !c.prep_time_confirmed_at && (
                        <span className={s.prepWait} data-testid="prep-waiting">
                          ⏳ بانتظار موافقة العميل على الوقت (<b className={s.mono}>{c.prep_minutes ?? "—"}</b> د)
                          {c.prep_confirm_deadline_at && now !== null && (
                            <b className={s.mono}>
                              {" "}
                              {mmss(Math.floor(Math.max(0, Date.parse(c.prep_confirm_deadline_at) - now) / 1000))}
                            </b>
                          )}
                        </span>
                      )}
                      {c.order_status === "PAYMENT_FAILED" && (
                        <span className={s.prepWait} data-testid="payment-failed">
                          ⚠ فشل الدفع — بانتظار إعادة محاولة العميل
                        </span>
                      )}
                      {c.order_status !== "PAYMENT_FAILED" && c.prep_time_confirmed_at && (
                        <span className={s.prepOk} data-testid="awaiting-payment">
                          ✓ وافق على <b className={s.mono}>{c.prep_minutes ?? "—"}</b> د — بانتظار الدفع
                          {c.payment_deadline_at && now !== null && (
                            <b className={s.mono}>
                              {" "}
                              {mmss(Math.floor(Math.max(0, Date.parse(c.payment_deadline_at) - now) / 1000))}
                            </b>
                          )}
                        </span>
                      )}
                      <span className={s.mono} style={{ fontSize: 12, color: "var(--pk-text-2)" }}>
                        التحضير يبدأ تلقائياً فور الدفع
                      </span>
                    </>
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
                  {/* العميل سبق التجهيز (docs/05§3): التحضير يستمر موازياً — لا بطاقة بلا زر */}
                  {JOURNEY_STATES.includes(c.order_status) && !c.ready_at && (
                    <>
                      <span
                        className={c.order_status === "CUSTOMER_ARRIVED" ? s.prepWait : s.prepOk}
                        data-testid="journey-badge"
                      >
                        {c.order_status === "CUSTOMER_ARRIVED"
                          ? "🚘 العميل واصل — طلبه لم يجهز بعد"
                          : "🚗 العميل في الطريق — جهّزوا على وصوله"}
                      </span>
                      {!c.preparing_at ? (
                        <button
                          className={`${s.bbtn} ${s.gray}`}
                          data-testid="start-preparing"
                          onClick={() => act(`/v1/merchant/orders/${c.id}/preparing`)}
                        >
                          بدء التجهيز
                        </button>
                      ) : (
                        <button
                          className={s.bbtn}
                          data-testid="mark-ready"
                          onClick={() => act(`/v1/merchant/orders/${c.id}/ready`, {})}
                        >
                          جاهز
                        </button>
                      )}
                    </>
                  )}
                  {["CUSTOMER_ON_THE_WAY", "CUSTOMER_NEARBY"].includes(c.order_status) && c.ready_at && (
                    <span className={s.prepOk} data-testid="ready-en-route">
                      ✓ جاهز — العميل في الطريق
                    </span>
                  )}
                  {c.order_status === "CUSTOMER_ARRIVED" && c.ready_at && (
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

      {/* رادار الوصول — docs/14§5-مكرر: لكل عميل متجه، المتبقي لوصوله × ما مضى من التجهيز */}
      <aside className={s.radar} data-testid="radar">
        <div className={s.radarHd}>
          رادار الوصول
          {radarSorted.some((e) => radarTone(e) === "red") && <span className={s.radarRedDot} />}
        </div>
        {radarSorted.length === 0 && (
          <p className={s.radarEmpty}>لا طلبات مدفوعة نشطة — تظهر هنا فور الدفع.</p>
        )}
        {radarSorted.map((e) => {
          const tone = radarTone(e);
          const elapsed = prepElapsedMin(e);
          return (
            <div key={e.order_id} className={s.rRow} data-tone={tone} data-testid="radar-row">
              <div className={s.rTop}>
                <span className={s.oid}>{e.display_code}</span>
                <b className={s.rName}>{e.customer_first_name}</b>
                {tone === "red" && (
                  <span className={s.rRed} data-testid="radar-red">
                    {e.arrived_at ? "🔴 واصل" : "🔴 ≤ دقيقة"}
                  </span>
                )}
              </div>
              {e.vehicle_summary && <div className={s.rVeh}>{e.vehicle_summary}</div>}
              <div className={s.rMeta}>
                {e.trip_active && e.eta_minutes !== null ? (
                  <span>
                    وصوله خلال <b className={s.mono}>{e.eta_minutes}</b> د
                  </span>
                ) : e.arrived_at ? (
                  <span>واصل — بانتظار التسليم</span>
                ) : (
                  <span className={s.rGray}>لم ينطلق بعد</span>
                )}
                {e.prep_minutes !== null && (
                  <span>
                    {e.ready_at ? (
                      "✓ جاهز"
                    ) : elapsed !== null ? (
                      <>
                        تجهيز <b className={s.mono}>{Math.min(elapsed, e.prep_minutes)}</b>/
                        <b className={s.mono}>{e.prep_minutes}</b> د
                      </>
                    ) : (
                      <>
                        تجهيز <b className={s.mono}>{e.prep_minutes}</b> د
                      </>
                    )}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </aside>
      </div>
    </main>
  );
}
