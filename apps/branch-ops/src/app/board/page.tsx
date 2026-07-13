"use client";

/**
 * B-03: لوحة التشغيل الجامعة (design/branch/B-03.html) — التبويبات = الحالات،
 * القبول/الرفض على البطاقة، عداد قبول BR-1، الترتيب حسب زمن الوصول (docs/21§1).
 * «وصلوا» ليست تبويباً بل عمود جانبي دائم الظهور (BR-9): الفرع يعمل على «جاهزة»
 * ويرى الواصلين في اللحظة نفسها — والتسليم كله من العمود.
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
  /** بلغ العميل نقطة الموقف المثبتة على الخريطة (GPS) — إشارة معلوماتية */
  at_spot_at: string | null;
  items_count: number;
  total_halalas: number;
  eta_minutes: number | null;
  accept_deadline_at: string | null;
  arrived_at: string | null;
  /** FR-C06: asap | later | scheduled — «لاحقاً» يعني تجهيزاً غير موقوت بالوصول */
  pickup_time: "asap" | "later" | "scheduled";
  scheduled_slot_start: string | null;
  /** الوقت المتوقع — يُختم عند القبول من «متوسط وقت التجهيز» في إعدادات المطعم */
  prep_minutes: number | null;
  /** مسار التجهيز الموازي (docs/05§3) — يتقدم ولو كان العميل في الطريق أو واصلاً */
  preparing_at: string | null;
  ready_at: string | null;
  created_at: string;
}

/** رحلة العميل قبل الوصول — التجهيز يستمر موازياً لها بالحقائق (preparing_at/ready_at) */
const EN_ROUTE = ["CUSTOMER_ON_THE_WAY", "CUSTOMER_NEARBY"];

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

// «وصلوا» ليست هنا عمداً — عمود جانبي دائم لا تبويب يحجب «جاهزة»
const TABS = [
  ["scheduled", "مجدولة"],
  ["new", "جديدة"],
  ["preparing", "قيد التحضير"],
  ["ready", "جاهزة"],
  ["completed", "مكتملة"]
] as const;

/** BR-5: عتبة «الموعد اقترب» — شريط تنبيه + نغمتان قبل دخول المجدول قائمة «جديدة» */
const SCHED_SOON_MS = 30 * 60_000;

function cardState(status: string): string {
  if (status === "ORDER_SUBMITTED") return "scheduled";
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
  // العمود الجانبي «وصلوا» — استطلاع مستقل عن التبويب المعروض
  const [arrived, setArrived] = useState<Card[]>([]);
  const [queue, setQueue] = useState<QueueEntry[]>([]);
  // شارات التبويبات — عدد ما ينتظر الموظف في كل خانة (ماعدا «مكتملة»)، ظاهرة دائماً
  const [counts, setCounts] = useState<Record<string, number>>({});
  // null = أول جلب — نزرع بصمت كي لا نصفّر عند فتح اللوحة على واصلين قدامى
  const arrSeen = useRef<Set<string> | null>(null);
  // BR-5: المجدولة القادمة — استطلاع مستقل عن التبويب لشارة العدّ الدائمة وتنبيه اقتراب الموعد
  const [sched, setSched] = useState<Card[]>([]);
  const schedSeen = useRef<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
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
    // العمود الجانبي «وصلوا» + طابور الوصول (B-11 / BR-9) + شارات التبويبات — حيّة مهما كان التبويب
    try {
      setArrived(await call<Card[]>("GET", `/v1/merchant/orders?branch_id=${branchId}&tab=arrived`));
      setQueue(await call<QueueEntry[]>("GET", `/v1/merchant/arrival-queue?branch_id=${branchId}`));
      setCounts(await call<Record<string, number>>("GET", `/v1/merchant/tab-counts?branch_id=${branchId}`));
    } catch {
      /* تحسين عرض — لا يوقف اللوحة */
    }
  }, [branchId, tab, call]);

  useEffect(() => {
    void refresh();
    const t = setInterval(refresh, 2500);
    return () => clearInterval(t);
  }, [refresh]);

  /** تنبيه صوتي بسيط (بلا ملفات صوت — WebAudio) */
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
      /* الصوت تحسين — الشارة المرئية تكفي */
    }
  }, []);

  // BR-5: المجدولة القادمة — كل 15 ث؛ عند دخول طلبٍ نطاق الثلاثين دقيقة: نغمتان
  useEffect(() => {
    if (!branchId) return;
    let stopped = false;
    const tick = async () => {
      try {
        const list = await call<Card[]>("GET", `/v1/merchant/orders?branch_id=${branchId}&tab=scheduled`);
        if (stopped) return;
        setSched(list);
        for (const c of list) {
          const ms = c.scheduled_slot_start ? Date.parse(c.scheduled_slot_start) - Date.now() : null;
          if (ms !== null && ms <= SCHED_SOON_MS && !schedSeen.current.has(c.id)) {
            schedSeen.current.add(c.id);
            beep();
            setTimeout(beep, 650);
          }
        }
      } catch {
        /* الشارة تحسين عرض — لا توقف اللوحة */
      }
    };
    void tick();
    const t = setInterval(tick, 15_000);
    return () => {
      stopped = true;
      clearInterval(t);
    };
  }, [branchId, call, beep]);

  // وصول عميل جديد للعمود الجانبي — نغمة تلفت الموظف ولو كان على تبويب آخر
  useEffect(() => {
    if (arrSeen.current === null) {
      arrSeen.current = new Set(arrived.map((c) => c.id));
      return;
    }
    let fresh = false;
    for (const c of arrived) {
      if (!arrSeen.current.has(c.id)) {
        arrSeen.current.add(c.id);
        fresh = true;
      }
    }
    if (fresh) beep();
  }, [arrived, beep]);

  const act = async (path: string, body?: unknown, idem = false) => {
    try {
      await call("POST", path, body, idem);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  // «تم التسليم» بضغطة واحدة — يخرج الموظف (إن لزم) ثم يُكمل بلا رمز تحقق
  const deliver = async (id: string, status: string) => {
    try {
      if (status === "CUSTOMER_ARRIVED") {
        await call("POST", `/v1/merchant/orders/${id}/handoff/start`);
      }
      await call("POST", `/v1/merchant/orders/${id}/handoff/complete`, {
        verification: { method: "board" }
      });
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

  // ترتيب التبويبات: المجدولة بالأقرب موعداً (BR-5)، والبقية بزمن إنشاء الطلب
  const sorted = useMemo(() => {
    const list = [...cards];
    if (tab === "scheduled") {
      list.sort((a, b) => (a.scheduled_slot_start ?? "").localeCompare(b.scheduled_slot_start ?? ""));
    } else {
      list.sort((a, b) => a.created_at.localeCompare(b.created_at));
    }
    return list;
  }, [cards, tab]);

  // العمود الجانبي بترتيب طابور الوصول (BR-9) — الأسبق وصولاً أولاً
  const arrivedSorted = useMemo(() => {
    return [...arrived].sort((a, b) => {
      const pa = queueByOrder.get(a.id)?.position ?? Number.MAX_SAFE_INTEGER;
      const pb = queueByOrder.get(b.id)?.position ?? Number.MAX_SAFE_INTEGER;
      if (pa !== pb) return pa - pb;
      return (a.arrived_at ?? a.created_at).localeCompare(b.arrived_at ?? b.created_at);
    });
  }, [arrived, queueByOrder]);

  // BR-5: المجدولة التي اقترب موعدها (≤ 30 د) — شريط تنبيه دائم فوق اللوحة
  const schedSoon = useMemo(
    () =>
      now === null
        ? []
        : sched.filter(
            (c) => c.scheduled_slot_start !== null && Date.parse(c.scheduled_slot_start) - now <= SCHED_SOON_MS
          ),
    [sched, now]
  );

  /** متى يدخل المجدول قائمة «جديدة» — عدّ تنازلي قريب، ووقت/يوم لما بعُد */
  const schedLabel = (c: Card): string => {
    if (!c.scheduled_slot_start || now === null) return "عند موعده";
    const ms = Date.parse(c.scheduled_slot_start) - now;
    if (ms <= 0) return "الآن — لحظات وينتقل إلى «جديدة»";
    const min = Math.ceil(ms / 60_000);
    if (min <= 90) return `خلال ${min} د`;
    const d = new Date(c.scheduled_slot_start);
    const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    return new Date(now).toDateString() === d.toDateString()
      ? `اليوم ${time}`
      : `${d.toLocaleDateString("ar", { weekday: "long" })} ${time}`;
  };

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

      {/* التبويبات = الحالات — شارة عدد دائمة على كل تبويب (ماعدا «مكتملة»: ليست واجباً منتظراً)
          كي يعرف الموظف ما عليه في كل خانة دون تنقّل */}
      <nav className={s.btabs} role="tablist">
        {TABS.map(([key, label]) => {
          const n = key === "scheduled" ? Math.max(sched.length, counts[key] ?? 0) : counts[key] ?? 0;
          return (
            <button
              key={key}
              role="tab"
              aria-selected={tab === key}
              className={`${s.btab} ${tab === key ? s.btabOn : ""}`}
              data-testid={`tab-${key}`}
              onClick={() => setTab(key)}
            >
              {key !== "completed" && n > 0 && (
                <span
                  className={`${s.n} ${
                    key === "scheduled" ? s.nSched : key === "new" ? s.nNew : key === "preparing" ? s.nPrep : s.nNear
                  }`}
                  data-testid={key === "scheduled" ? "scheduled-count" : `tab-count-${key}`}
                >
                  {n}
                </span>
              )}
              {label}
            </button>
          );
        })}
      </nav>

      <section className={s.bmain}>
        {/* BR-5: موعد مجدول على الأبواب — شريط نابض يقود للتبويب مهما كان المعروض */}
        {schedSoon.length > 0 && tab !== "scheduled" && (
          <button className={s.schedBanner} data-testid="scheduled-banner" onClick={() => setTab("scheduled")}>
            ⏰{" "}
            {schedSoon.length === 1
              ? "طلب مجدول اقترب موعده"
              : `${schedSoon.length} طلبات مجدولة اقتربت مواعيدها`}{" "}
            — {schedSoon.slice(0, 3).map((c) => c.display_code).join(" · ")} · اضغط للاستعراض
          </button>
        )}
        {error && (
          <div className={s.noteErr} data-testid="board-error">
            {error}
          </div>
        )}

        <div className={s.bcols}>
          <div className={s.bcontent}>
            <div className={s.grid}>
          {sorted.map((c) => {
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
                className={s.ocard}
                data-state={cardState(c.order_status)}
                data-testid="order-card"
              >
                <div className={s.hd}>
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
                    {c.parking_spot &&
                      (c.at_spot_at && c.order_status !== "COMPLETED" ? (
                        /* GPS رصد العميل عند نقطة موقفه — الموظف يطلع للمكان الصحيح مباشرة */
                        <span className={`${s.slot} ${s.slotLive}`} data-testid="at-spot-badge">
                          🅿 عند الموقف {c.parking_spot} ✓
                        </span>
                      ) : (
                        <span className={s.slot}>موقف {c.parking_spot}</span>
                      ))}
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
                  {/* مجدول راقد حتى موعده (BR-5) — استعراض فقط؛ ينتقل إلى «جديدة» آلياً */}
                  {c.order_status === "ORDER_SUBMITTED" && (
                    <>
                      <button
                        className={`${s.bbtn} ${s.gray}`}
                        data-testid="view-order"
                        onClick={() => toggleDetails(c.id)}
                      >
                        {detailsFor === c.id ? "إخفاء" : "استعراض الطلب"}
                      </button>
                      <span className={s.prepWait} data-testid="scheduled-countdown">
                        ⏰ يدخل «جديدة» {schedLabel(c)}
                      </span>
                    </>
                  )}
                  {c.order_status === "MERCHANT_PENDING" && (
                    <>
                      <button
                        className={`${s.bbtn} ${s.gray}`}
                        data-testid="view-order"
                        onClick={() => toggleDetails(c.id)}
                      >
                        {detailsFor === c.id ? "إخفاء" : "استعراض الطلب"}
                      </button>
                      {/* قبول بضغطة — الوقت المتوقع يُختم آلياً من «متوسط وقت التجهيز» في الإعدادات */}
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
                    <>
                      {c.prep_minutes !== null && (
                        <span className={s.prepOk} data-testid="prep-avg">
                          ⏱ الوقت المتوقع <b className={s.mono}>{c.prep_minutes}</b> د — متوسط المطعم
                        </span>
                      )}
                      {/* زر واحد «جاهز» — ينقل البطاقة إلى «جاهزة» ويُشعر العميل فوراً */}
                      <button
                        className={s.bbtn}
                        data-testid="mark-ready"
                        onClick={() => act(`/v1/merchant/orders/${c.id}/ready`, {})}
                      >
                        جاهز
                      </button>
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
                  {/* العميل سبق التجهيز (docs/05§3): التحضير يستمر موازياً — لا بطاقة بلا زر.
                      الواصلون لا يظهرون هنا — بطاقاتهم في العمود الجانبي «وصلوا» بأزرار التسليم */}
                  {EN_ROUTE.includes(c.order_status) && !c.ready_at && (
                    <>
                      <span className={s.prepOk} data-testid="journey-badge">
                        🚗 العميل في الطريق — جهّزوا على وصوله
                      </span>
                      {/* زر واحد «جاهز» — الخدمة تختم preparing_at آلياً إن لم يسبق تسجيله */}
                      <button
                        className={s.bbtn}
                        data-testid="mark-ready"
                        onClick={() => act(`/v1/merchant/orders/${c.id}/ready`, {})}
                      >
                        جاهز
                      </button>
                    </>
                  )}
                  {EN_ROUTE.includes(c.order_status) && c.ready_at && (
                    <span className={s.prepOk} data-testid="ready-en-route">
                      ✓ جاهز — العميل في الطريق
                    </span>
                  )}
                  {c.order_status === "COMPLETED" && <span className={s.done}>تم التسليم ✓</span>}
                </div>
              </article>
            );
          })}
            </div>

            {cards.length === 0 && (
              <div className={s.empty}>
                {tab === "scheduled" ? (
                  <>
                    <b>لا طلبات مجدولة قادمة</b>
                    <p>حين يحجز عميل موعد استلام، يظهر طلبه هنا قبل موعده — وينتقل إلى «جديدة» تلقائياً عند حلوله.</p>
                  </>
                ) : (
                  <>
                    <b>لا طلبات في هذا التبويب</b>
                    <p>البطاقات تظهر هنا فور تغيّر حالتها — التحديث كل ثوانٍ.</p>
                  </>
                )}
              </div>
            )}
          </div>

          {/* العمود الجانبي «وصلوا» — حي بجانب كل التبويبات: الموظف على «جاهزة»
              ويرى الواصل لحظتها، والتسليم كله من هنا (BR-9) */}
          <aside className={s.arrPanel} data-testid="arrived-panel">
            <div className={s.arrHd}>
              🚘 وصلوا
              {arrived.length > 0 && (
                <span className={`${s.n} ${s.nArr}`} data-testid="arrived-count">
                  {arrived.length}
                </span>
              )}
            </div>

            {arrivedSorted.map((c) => {
              const q = queueByOrder.get(c.id);
              return (
                <article
                  key={c.id}
                  className={`${s.acard} ${q?.service_target_exceeded ? s.acardOver : ""}`}
                  data-testid="arrived-card"
                >
                  <div className={s.acardHd}>
                    {q && <span className={s.aPos}>{q.position}</span>}
                    <span className={s.oid}>{c.display_code}</span>
                    {q && (
                      <span className={`${s.mono} ${s.aWait} ${q.service_target_exceeded ? s.waitOver : ""}`}>
                        {mmss(q.waiting_seconds)}
                        {q.service_target_exceeded && " ⚠"}
                      </span>
                    )}
                  </div>
                  {c.vehicle_summary && <div className={s.aVehicle}>{c.vehicle_summary}</div>}
                  <div className={s.aMeta}>
                    {c.customer_first_name}
                    {c.parking_spot &&
                      (c.at_spot_at ? (
                        <span className={`${s.slot} ${s.slotLive} ${s.aSlot}`} data-testid="at-spot-badge">
                          🅿 عند الموقف {c.parking_spot} ✓
                        </span>
                      ) : (
                        <span className={`${s.slot} ${s.aSlot}`}>موقف {c.parking_spot}</span>
                      ))}
                  </div>
                  <div className={s.aActions}>
                    {/* واصل وطلبه لم يجهز (docs/05§3) — «جاهز» من هنا مباشرة ثم يخرج الموظف */}
                    {!c.ready_at ? (
                      <>
                        <span className={s.prepWait} data-testid="journey-badge">
                          لم يجهز بعد
                        </span>
                        <button
                          className={`${s.bbtn} ${s.abtn}`}
                          data-testid="mark-ready"
                          onClick={() => act(`/v1/merchant/orders/${c.id}/ready`, {})}
                        >
                          جاهز
                        </button>
                      </>
                    ) : c.order_status === "CUSTOMER_ARRIVED" ||
                      c.order_status === "HANDOFF_IN_PROGRESS" ? (
                      <button
                        className={`${s.bbtn} ${s.green} ${s.abtn}`}
                        data-testid="handoff-complete"
                        onClick={() => deliver(c.id, c.order_status)}
                      >
                        تم التسليم
                      </button>
                    ) : null}
                  </div>
                </article>
              );
            })}

            {arrived.length === 0 && (
              <p className={s.arrEmpty}>لا عملاء واصلين الآن — أول واصل يظهر هنا فوراً مع تنبيه صوتي.</p>
            )}
          </aside>
        </div>
      </section>
    </main>
  );
}
