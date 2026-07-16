"use client";

/**
 * B-03: لوحة التشغيل الجامعة (design/branch/B-03.html) — دمج التبويبات النشطة
 * (جديدة + قيد التحضير + جاهزة + الواصلون) في تبويب واحد «التشغيل» بقرار المالك 2026-07-14:
 * البطاقة لا تنتقل بين تبويبات — حالتها وأزرارها تتغيّر في مكانها، والقبول/الجاهز/التسليم
 * كلها بضغطة على نفس البطاقة. الوصول يظهر **على البطاقة نفسها** (شارة + وميض + صوت) بدل
 * العمود الجانبي «وصلوا» — يلغي فصل BR-9 السابق بموافقة المالك الصريحة.
 * «مجدولة» و«مكتملة» تبقيان تبويبين منفصلين (قبل التشغيل / أرشيف بعده).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import s from "./board.module.css";
import { VehicleId, type CardVehicle } from "./vehicle-id";
import { Qirtas, QirtasBadge, QirtasLoader } from "../qirtas";

interface Card {
  id: string;
  display_code: string;
  order_status: string;
  customer_first_name: string;
  customer_phone_masked: string;
  vehicle_summary: string | null;
  /** هوية السيارة المنظّمة (لوحة/شعار/لون) — أثناء الطلب النشط فقط */
  vehicle: CardVehicle | null;
  /** رقم اليوم التسلسلي بالفرع — يتصفر منتصف الليل بتوقيت الرياض */
  daily_number: number | null;
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
  /** لحظة القبول — مرساة العدّاد التنازلي، نفسها عند العميل في التتبع فيتطابق الرقمان */
  accepted_at: string | null;
  /** مسار التجهيز الموازي (docs/05§3) — يتقدم ولو كان العميل في الطريق أو واصلاً */
  preparing_at: string | null;
  ready_at: string | null;
  created_at: string;
}

/** رحلة العميل قبل الوصول — التجهيز يستمر موازياً لها بالحقائق (preparing_at/ready_at) */
const EN_ROUTE = ["CUSTOMER_ON_THE_WAY", "CUSTOMER_NEARBY"];
/** العميل وصل فعلياً (قابل للتسليم متى جهز) — تُبرزه البطاقة بشارة ووميض */
const ARRIVED = ["CUSTOMER_ARRIVED", "HANDOFF_IN_PROGRESS"];
/**
 * رحلة موازية للتجهيز: في الطريق أو وصل أو بدأ تسليمه. البطاقة تحمل زرها بحقيقة
 * الجاهزية (ready_at) — إعلان الوصول لا يزيح الطلب، بل يضيف عليه شارة الوصول والتسليم.
 */
const JOURNEY_PARALLEL = ["CUSTOMER_ON_THE_WAY", "CUSTOMER_NEARBY", "CUSTOMER_ARRIVED", "HANDOFF_IN_PROGRESS"];

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

/**
 * «التشغيل» تبويب جامع يدمج النشطة (جديدة/قيد التحضير/جاهزة/واصلون) في قائمة واحدة —
 * يُجلب من tabs الثلاثة (new/preparing/ready) التي تقسّم كل الحالات النشطة بلا تداخل.
 * المجدولة والمكتملة تبقيان تبويبين مستقلين.
 */
const TABS = [
  ["scheduled", "مجدولة"],
  ["active", "التشغيل"],
  ["completed", "مكتملة"]
] as const;

/** BR-5: عتبة «الموعد اقترب» — شريط تنبيه + نغمتان قبل دخول المجدول قائمة «التشغيل» */
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

export default function BoardPage() {
  const router = useRouter();
  const [branchId, setBranchId] = useState<string | null>(null);
  const [tab, setTab] = useState<string>("active");
  const [cards, setCards] = useState<Card[]>([]);
  const [queue, setQueue] = useState<QueueEntry[]>([]);
  // شارات التبويبات — عدد ما ينتظر الموظف في كل خانة، ظاهرة دائماً
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

  // توكن Push من غلاف التطبيق (mobile-apps/branch) — يصل عبر حدث pickly:push-token
  // أو window.__picklyPush إن سبق الحقنُ هذا الـeffect. تسجيله يمكّن إشعار الطلب
  // الجديد النظامي الذي يرن حتى والجهاز مقفل (صوت اللوحة يتجمد مع قفل الشاشة).
  useEffect(() => {
    if (!branchId) return;
    const register = (detail: { token?: string; platform?: string } | undefined) => {
      const t = detail?.token;
      if (!t) return;
      const dedupeKey = `bo_push_${branchId}`;
      if (localStorage.getItem(dedupeKey) === t) return; // مسجّل سلفاً لهذا الفرع
      void call("POST", "/v1/merchant/devices/push-token", {
        branch_id: branchId,
        token: t,
        platform: detail?.platform === "ios" ? "ios" : "android"
      })
        .then(() => localStorage.setItem(dedupeKey, t))
        .catch(() => {
          /* تحسين — يُعاد في التحميل التالي */
        });
    };
    register((window as unknown as { __picklyPush?: { token?: string; platform?: string } }).__picklyPush);
    const onToken = (ev: Event) => register((ev as CustomEvent<{ token?: string; platform?: string }>).detail);
    document.addEventListener("pickly:push-token", onToken);
    return () => document.removeEventListener("pickly:push-token", onToken);
  }, [branchId, call]);

  // ساعة الترويسة + عدادات BR-1 التنازلية (أرقام لاتينية Mono)
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const refresh = useCallback(async () => {
    if (!branchId) return;
    try {
      if (tab === "active") {
        // «التشغيل»: اتحاد النشطة الثلاثة (new/preparing/ready) — تقسيم بلا تداخل، فالدمج بلا تكرار
        const [n, p, r] = await Promise.all([
          call<Card[]>("GET", `/v1/merchant/orders?branch_id=${branchId}&tab=new`),
          call<Card[]>("GET", `/v1/merchant/orders?branch_id=${branchId}&tab=preparing`),
          call<Card[]>("GET", `/v1/merchant/orders?branch_id=${branchId}&tab=ready`)
        ]);
        setCards([...n, ...p, ...r]);
      } else {
        setCards(await call<Card[]>("GET", `/v1/merchant/orders?branch_id=${branchId}&tab=${tab}`));
      }
      setError(null);
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    // طابور الوصول (B-11 / BR-9) لزمن الانتظار على البطاقات الواصلة + شارات التبويبات — حيّة مهما كان التبويب
    try {
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

  /** تنبيه صوتي بسيط (بلا ملفات صوت — WebAudio) — سياق واحد مشترك يُعاد إيقاظه، فلا تتراكم السياقات مع طول عمر الشاشة */
  const audioCtx = useRef<AudioContext | null>(null);
  const beep = useCallback((freq = 880, vol = 0.18, dur = 0.5) => {
    try {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = (audioCtx.current ??= new Ctx());
      if (ctx.state === "suspended") void ctx.resume();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(vol, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
      osc.start();
      osc.stop(ctx.currentTime + dur);
    } catch {
      /* الصوت تحسين — الشارة المرئية تكفي */
    }
  }, []);

  /** نغمة الطلب الجديد — ثلاث نغمات صاعدة تميّزه عن جرس الوصول الهابط ونغمتي المجدول */
  const newOrderChime = useCallback(() => {
    beep(660);
    setTimeout(() => beep(880), 200);
    setTimeout(() => beep(1100), 400);
  }, [beep]);

  // جرس وصول العميل — «دينغ-دونغ» هابط أعلى صوتاً من البقية يتكرر ثلاث مرات
  // (قرار المالك 2026-07-16)؛ الهبوط يعكس صعود نغمة الطلب الجديد فلا يلتبسان
  const arrivalChime = useCallback(() => {
    for (const rep of [0, 900, 1800]) {
      setTimeout(() => beep(988, 0.5, 0.35), rep);
      setTimeout(() => beep(659, 0.5, 0.5), rep + 250);
    }
  }, [beep]);

  // إنذار الطلب الجديد — متكرر ولا يصمت إلا بالقبول أو الرفض (قرار المالك 2026-07-16):
  // ما دام عدّاد «جديدة» في tab-counts فوق الصفر (يُستطلع كل 2.5 ث مهما كان التبويب
  // المعروض) تُعاد النغمة كل ثانية ونصف — تشمل فتح اللوحة على طلب معلّق قائم، وتنطلق
  // فوراً من جديد إن وصل طلب آخر فوق المعلّق، وتسكت لحظة خلوّ الخانة.
  const pendingCount = counts.new ?? 0;
  useEffect(() => {
    if (pendingCount <= 0) return;
    newOrderChime();
    const t = setInterval(newOrderChime, 1500);
    return () => clearInterval(t);
  }, [pendingCount, newOrderChime]);

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

  // وصول عميل جديد — جرس مميز يلفت الموظف؛ نستنتج الواصلين من بطاقات «التشغيل» نفسها
  useEffect(() => {
    const arrivedNow = cards.filter((c) => ARRIVED.includes(c.order_status));
    if (arrSeen.current === null) {
      arrSeen.current = new Set(arrivedNow.map((c) => c.id));
      return;
    }
    let fresh = false;
    for (const c of arrivedNow) {
      if (!arrSeen.current.has(c.id)) {
        arrSeen.current.add(c.id);
        fresh = true;
      }
    }
    if (fresh) arrivalChime();
  }, [cards, arrivalChime]);

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

  /**
   * ترتيب «التشغيل»: الأولوية للتسليم — الواصل الجاهز (قابل تسليم فوري، يومض) أولاً،
   * ثم الواصل الذي لم يجهز، ثم الجديد (مهلة القبول تنزل)، ثم بقية التحضير/الجاهز.
   * وداخل كل رتبة الأقدم إنشاءً أولاً. المجدولة بالأقرب موعداً، والمكتملة بزمن الإنشاء.
   */
  const sorted = useMemo(() => {
    const list = [...cards];
    if (tab === "scheduled") {
      list.sort((a, b) => (a.scheduled_slot_start ?? "").localeCompare(b.scheduled_slot_start ?? ""));
    } else if (tab === "active") {
      const rank = (c: Card): number => {
        const arrived = ARRIVED.includes(c.order_status);
        if (arrived && c.ready_at) return 0;
        if (arrived) return 1;
        if (c.order_status === "MERCHANT_PENDING") return 2;
        return 3;
      };
      list.sort((a, b) => rank(a) - rank(b) || a.created_at.localeCompare(b.created_at));
    } else {
      list.sort((a, b) => a.created_at.localeCompare(b.created_at));
    }
    return list;
  }, [cards, tab]);

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

  // عدد النشطة على تبويب «التشغيل» — مجموع الخانات الثلاث (arrived مجموعة فرعية فلا تُجمع)
  const activeCount = (counts.new ?? 0) + (counts.preparing ?? 0) + (counts.ready ?? 0);
  const arrivedCount = counts.arrived ?? 0;

  /** متى يدخل المجدول قائمة «التشغيل» — عدّ تنازلي قريب، ووقت/يوم لما بعُد */
  const schedLabel = (c: Card): string => {
    if (!c.scheduled_slot_start || now === null) return "عند موعده";
    const ms = Date.parse(c.scheduled_slot_start) - now;
    if (ms <= 0) return "الآن — لحظات وينتقل إلى «التشغيل»";
    const min = Math.ceil(ms / 60_000);
    if (min <= 90) return `خلال ${min} د`;
    const d = new Date(c.scheduled_slot_start);
    const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    return new Date(now).toDateString() === d.toDateString()
      ? `اليوم ${time}`
      : `${d.toLocaleDateString("ar", { weekday: "long" })} ${time}`;
  };

  /**
   * شارة التجهيز الحية — عدّاد تنازلي بنفس مرساة عدّاد العميل في صفحة التتبع
   * (accepted_at + prep_minutes) فيرى الموظف الرقم ذاته الذي يراه العميل لحظة بلحظة،
   * وعند التجاوز تتحول الشارة حمراء وتعدّ تصاعدياً بمقدار التأخير.
   */
  const prepChip = (c: Card): React.ReactNode => {
    if (c.prep_minutes === null) return null;
    if (!c.accepted_at || now === null)
      return (
        /* طلبات قديمة بلا مرساة قبول — الرقم الثابت كما كان */
        <span className={s.prepOk} data-testid="prep-avg">
          ⏱ الوقت المتوقع <b className={s.mono}>{c.prep_minutes}</b> د — متوسط المطعم
        </span>
      );
    const leftMs = Date.parse(c.accepted_at) + c.prep_minutes * 60_000 - now;
    const overtime = leftMs <= 0; // نفس عتبة عدّاد العميل — يتحول عنده إلى «جاهز تقريباً»
    return (
      <span className={`${s.prepOk} ${overtime ? s.prepOver : ""}`} data-testid="prep-avg">
        {overtime ? (
          <>
            ⏱ تجاوز المتوقع بـ <b className={s.mono} data-testid="prep-countdown">{mmss(Math.floor(-leftMs / 1000))}</b>
          </>
        ) : (
          <>
            ⏱ يتبقى <b className={s.mono} data-testid="prep-countdown">{mmss(Math.floor(leftMs / 1000))}</b>
          </>
        )}
      </span>
    );
  };

  const clock =
    now === null ? "--:--" : `${pad2(new Date(now).getHours())}:${pad2(new Date(now).getMinutes())}`;

  return (
    <main className={s.board}>
      {/* ترويسة اللوحة */}
      <header className={s.bhdr}>
        <div className={s.brand}>
          <QirtasBadge size={40} />
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

      {/* التبويبات: مجدولة · التشغيل (النشطة مجموعةً) · مكتملة — شارة عدد دائمة
          وعلى «التشغيل» شارة واصلين نابضة إن وُجد من وصل، كي لا يغيب عن الموظف */}
      <nav className={s.btabs} role="tablist">
        {TABS.map(([key, label]) => {
          const n =
            key === "scheduled"
              ? Math.max(sched.length, counts[key] ?? 0)
              : key === "active"
                ? activeCount
                : 0;
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
                  className={`${s.n} ${key === "scheduled" ? s.nSched : s.nPrep}`}
                  data-testid={key === "scheduled" ? "scheduled-count" : `tab-count-${key}`}
                >
                  {n}
                </span>
              )}
              {key === "active" && arrivedCount > 0 && (
                <span className={`${s.n} ${s.nArr} ${s.nArrLive}`} data-testid="arrived-count">
                  🚘 {arrivedCount}
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

        <div className={s.grid}>
          {sorted.map((c) => {
            const deadline = c.accept_deadline_at ? Date.parse(c.accept_deadline_at) : null;
            const remainMs =
              c.order_status === "MERCHANT_PENDING" && deadline !== null && now !== null
                ? Math.max(0, deadline - now)
                : null;
            const windowMs =
              deadline !== null ? Math.max(1000, deadline - Date.parse(c.created_at)) : null;
            // العميل وصل — الإنذار في شارة «وصل» وحدها (تنوّر أحمر)، لا وميض على البطاقة
            const arrived = ARRIVED.includes(c.order_status);
            // واصل وطلبه جاهز — يُظهر زر «تم التسليم»
            const deliverable = arrived && !!c.ready_at;
            const q = queueByOrder.get(c.id);
            return (
              <article
                key={c.id}
                className={s.ocard}
                data-state={cardState(c.order_status)}
                data-testid="order-card"
              >
                <div className={s.hd}>
                  {/* الرقم اليومي بارزاً (#N — يتصفر يومياً)؛ الكود P-XXXX لا يظهر على البطاقة إلا كبديل عند غياب الرقم اليومي */}
                  {c.daily_number !== null ? (
                    <div className={s.onum}>
                      <b className={s.dnum} data-testid="daily-number">#{c.daily_number}</b>
                    </div>
                  ) : (
                    <span className={s.oid}>{c.display_code}</span>
                  )}
                  <div className={s.grow}>
                    {/* هوية السيارة: شعار + موديل + دائرة اللون + لوحة سعودية مصغّرة — كتاب الهوية §11 */}
                    {c.vehicle ? (
                      <VehicleId v={c.vehicle} />
                    ) : (
                      c.vehicle_summary && <div className={s.vehicle}>{c.vehicle_summary}</div>
                    )}
                  </div>
                  {/* عمود الحضور مكدّس يساراً (وصول/مهلة قبول/موقف) — لا يتبعثر وسط البطاقة */}
                  <div className={s.end}>
                    {/* الوصول على البطاقة نفسها — شارة نابضة + زمن الانتظار (طابور BR-9) */}
                    {arrived && (
                      <span className={s.arrivedBadge} data-testid="arrived-badge">
                        🚘 وصل
                        {q && (
                          <span className={`${s.mono} ${q.service_target_exceeded ? s.waitOver : ""}`}>
                            {" "}
                            {mmss(q.waiting_seconds)}
                            {q.service_target_exceeded && " ⚠"}
                          </span>
                        )}
                      </span>
                    )}
                    {remainMs !== null && (
                      <div className={s.acceptTimer}>
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

                {/* سطر العميل والطلب — صف كامل العرض تحت الهوية بدل حشره بجانب السيارة */}
                <div className={s.meta}>
                  {/* وسم وقت الاستلام — BR-5 و«سأتحرك لاحقاً» (FR-C06) */}
                  {c.pickup_time === "scheduled" && (
                    <b style={{ color: "var(--pk-warn)" }} data-testid="pickup-tag">
                      مجدول{c.scheduled_slot_start ? ` ${new Date(c.scheduled_slot_start).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` : ""} ·{" "}
                    </b>
                  )}
                  {c.pickup_time === "later" && (
                    <b style={{ color: "var(--pk-blue-600)" }} data-testid="pickup-tag">
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
                      <div className={s.detailsLoading}>
                        <QirtasLoader size={40} />
                        جارٍ استعراض الطلب
                      </div>
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
                  {/* مجموعة الأزرار يميناً: زر الحالة الأساسي أولاً ثم «استعراض الطلب» الثانوي —
                      والشارات المعلوماتية مجموعة مقابلة يساراً كي لا تتخلل الأزرار */}
                  <div className={s.actBtns}>
                    {c.order_status === "MERCHANT_PENDING" && (
                      <>
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
                    {/* زر واحد «جاهز» — ينقل البطاقة إلى «جاهزة» ويُشعر العميل فوراً؛ وفي مسار الرحلة
                        الموازية (docs/05§3) تختم الخدمة preparing_at آلياً إن لم يسبق تسجيله */}
                    {(["MERCHANT_ACCEPTED", "PREPARING"].includes(c.order_status) ||
                      (JOURNEY_PARALLEL.includes(c.order_status) && !c.ready_at)) && (
                      <button
                        className={s.bbtn}
                        data-testid="mark-ready"
                        onClick={() => act(`/v1/merchant/orders/${c.id}/ready`, {})}
                      >
                        جاهز
                      </button>
                    )}
                    {/* جاهز والعميل وصل — التسليم بضغطة على نفس البطاقة (بدل عمود «وصلوا») */}
                    {deliverable && (
                      <button
                        className={`${s.bbtn} ${s.green}`}
                        data-testid="handoff-complete"
                        onClick={() => deliver(c.id, c.order_status)}
                      >
                        تم التسليم
                      </button>
                    )}
                    {/* استعراض محتوى الطلب متاح في كل الحالات — حتى قيد التحضير وما بعده */}
                    <button
                      className={`${s.bbtn} ${s.gray}`}
                      data-testid="view-order"
                      onClick={() => toggleDetails(c.id)}
                    >
                      {detailsFor === c.id ? "إخفاء" : "استعراض الطلب"}
                    </button>
                  </div>

                  <div className={s.actInfo}>
                    {/* مجدول راقد حتى موعده (BR-5) — استعراض فقط؛ ينتقل إلى «التشغيل» آلياً */}
                    {c.order_status === "ORDER_SUBMITTED" && (
                      <span className={s.prepWait} data-testid="scheduled-countdown">
                        ⏰ يدخل «التشغيل» {schedLabel(c)}
                      </span>
                    )}
                    {/* شارة التجهيز الحية — ترافق زر «جاهز» في كل حالاته */}
                    {(["MERCHANT_ACCEPTED", "PREPARING"].includes(c.order_status) ||
                      (JOURNEY_PARALLEL.includes(c.order_status) && !c.ready_at)) &&
                      prepChip(c)}
                    {/* العميل سبق التجهيز (docs/05§3): التحضير يستمر موازياً — لا بطاقة بلا زر */}
                    {JOURNEY_PARALLEL.includes(c.order_status) && !c.ready_at && EN_ROUTE.includes(c.order_status) && (
                      <span className={s.prepOk} data-testid="journey-badge">
                        🚗 العميل في الطريق — جهّزوا على وصوله
                      </span>
                    )}
                    {/* جاهز والعميل في الطريق — تسليم غير ممكن بعد (لم يصل) */}
                    {JOURNEY_PARALLEL.includes(c.order_status) && c.ready_at && EN_ROUTE.includes(c.order_status) && (
                      <span className={s.prepOk} data-testid="ready-en-route">
                        ✓ جاهز — العميل في الطريق
                      </span>
                    )}
                    {c.order_status === "COMPLETED" && <span className={s.done}>تم التسليم ✓</span>}
                  </div>
                </div>
              </article>
            );
          })}
        </div>

        {cards.length === 0 && (
          <div className={s.empty}>
            {/* القرطاس النعسان — الحالة الفارغة الرسمية */}
            <Qirtas mood="sleepy" size={110} />
            {tab === "scheduled" ? (
              <>
                <b>لا طلبات مجدولة قادمة</b>
                <p>حين يحجز عميل موعد استلام، يظهر طلبه هنا قبل موعده — وينتقل إلى «التشغيل» تلقائياً عند حلوله.</p>
              </>
            ) : tab === "completed" ? (
              <>
                <b>لا طلبات مكتملة بعد</b>
                <p>الطلبات المسلَّمة تُؤرشف هنا — التحديث كل ثوانٍ.</p>
              </>
            ) : (
              <>
                <b>لا طلبات نشطة الآن</b>
                <p>كل طلب جديد أو قيد التحضير أو جاهز أو واصل يظهر هنا في قائمة واحدة — التحديث كل ثوانٍ.</p>
              </>
            )}
          </div>
        )}
      </section>
    </main>
  );
}
