"use client";

/**
 * B-07/B-08: KDS المطبخ — التحضير والجاهزية (design/branch/B-07.html) —
 * شاشة مطبخ فعلياً مستقلة (docs/21§1): ثلاثة أعمدة «في الانتظار» (MERCHANT_ACCEPTED)
 * و«قيد التحضير» (PREPARING) من tab=preparing، و«جاهز» من tab=ready.
 * «بدء التحضير» → POST /preparing · «جاهز» → POST /ready · «نقص منتج» → Sheet BR-4.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import s from "./kds.module.css";

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

interface DetailsItem {
  /** معرّف صنف الطلب — مطلوب لبلاغ نقص المنتج (BR-4) */
  id: string;
  name_ar: string;
  quantity: number;
  modifiers: string[];
  notes: string | null;
}

interface OrderDetails {
  id: string;
  display_code: string;
  order_status: string;
  items: DetailsItem[];
  customer_notes: string | null;
  parking_spot: string | null;
  vehicle_summary: string | null;
}

/** الأحمر = تجاوز زمن التجهيز المعلن — الافتراضي 15 د (default_prep_minutes) */
const LATE_MINUTES = 15;

const pad2 = (n: number): string => String(n).padStart(2, "0");
/** أرقام لاتينية بصيغة MM:SS (Mono) */
const mmss = (totalSeconds: number): string =>
  `${pad2(Math.floor(Math.max(0, totalSeconds) / 60))}:${pad2(Math.max(0, totalSeconds) % 60)}`;

/** أنواع مشكلة الصنف — BR-4 */
const ISSUE_TYPES = [
  ["out_of_stock", "نفد من المخزون"],
  ["partial", "متوفر جزئياً"]
] as const;

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

export default function KdsPage() {
  const router = useRouter();
  const [branchId, setBranchId] = useState<string | null>(null);
  const [prepCards, setPrepCards] = useState<Card[]>([]);
  const [readyCards, setReadyCards] = useState<Card[]>([]);
  const [details, setDetails] = useState<Record<string, OrderDetails>>({});
  const detailsRef = useRef<Record<string, OrderDetails>>({});
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState<number | null>(null);

  // Sheet نقص المنتج (BR-4)
  const [issueFor, setIssueFor] = useState<Card | null>(null);
  const [issueItem, setIssueItem] = useState<number | null>(null);
  const [issueType, setIssueType] = useState<"out_of_stock" | "partial">("out_of_stock");
  const [issueNote, setIssueNote] = useState("");
  const [busy, setBusy] = useState(false);

  const token = typeof window !== "undefined" ? localStorage.getItem("bo_token") : null;

  const call = useCallback(
    async <T,>(method: string, path: string, body?: unknown): Promise<T> => {
      const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
      if (body !== undefined) headers["Content-Type"] = "application/json";
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
      const payload = JSON.parse(atob(token.split(".")[1] ?? "")) as { branch_ids?: string[] };
      setBranchId(payload.branch_ids?.[0] ?? null);
    } catch {
      router.push("/");
    }
  }, [token, router]);

  // ساعة الترويسة + مؤقتات البطاقات (أرقام لاتينية Mono)
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const refresh = useCallback(async () => {
    if (!branchId) return;
    let lists: [Card[], Card[]];
    try {
      lists = await Promise.all([
        call<Card[]>("GET", `/v1/merchant/orders?branch_id=${branchId}&tab=preparing`),
        call<Card[]>("GET", `/v1/merchant/orders?branch_id=${branchId}&tab=ready`)
      ]);
      setPrepCards(lists[0]);
      setReadyCards(lists[1]);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    // تفاصيل الطلب (العناصر والمُعدِّلات والملاحظات) — تُجلب مرة لكل طلب وتُحفظ
    const missing = [...lists[0], ...lists[1]]
      .map((c) => c.id)
      .filter((id) => !detailsRef.current[id]);
    if (missing.length === 0) return;
    const fetched = await Promise.all(
      missing.map(async (id) => {
        try {
          return await call<OrderDetails>("GET", `/v1/merchant/orders/${id}/details`);
        } catch {
          return null;
        }
      })
    );
    const add: Record<string, OrderDetails> = {};
    for (const d of fetched) if (d) add[d.id] = d;
    if (Object.keys(add).length > 0) {
      detailsRef.current = { ...detailsRef.current, ...add };
      setDetails(detailsRef.current);
    }
  }, [branchId, call]);

  useEffect(() => {
    void refresh();
    const t = setInterval(refresh, 2500);
    return () => clearInterval(t);
  }, [refresh]);

  const act = async (path: string, body?: unknown) => {
    try {
      await call("POST", path, body);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  // المؤقت منذ القبول — من created_at المتاح في البطاقة
  const elapsedSec = (c: Card): number | null =>
    now === null ? null : Math.floor((now - Date.parse(c.created_at)) / 1000);
  const isLate = (c: Card): boolean => {
    const e = elapsedSec(c);
    return e !== null && e >= LATE_MINUTES * 60;
  };

  const byCreated = (a: Card, b: Card): number => a.created_at.localeCompare(b.created_at);
  const waiting = useMemo(
    () => prepCards.filter((c) => c.order_status === "MERCHANT_ACCEPTED").sort(byCreated),
    [prepCards]
  );
  const cooking = useMemo(
    () => prepCards.filter((c) => c.order_status === "PREPARING").sort(byCreated),
    [prepCards]
  );
  const ready = useMemo(() => [...readyCards].sort(byCreated), [readyCards]);
  const lateCount = useMemo(
    () => [...waiting, ...cooking].filter(isLate).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [waiting, cooking, now]
  );

  const openIssue = (c: Card) => {
    setIssueFor(c);
    setIssueItem(null);
    setIssueType("out_of_stock");
    setIssueNote("");
  };

  const issueDetails = issueFor ? details[issueFor.id] : undefined;
  const selectedItem =
    issueDetails && issueItem !== null ? issueDetails.items[issueItem] : undefined;

  const submitIssue = async () => {
    if (!issueFor || !selectedItem) return;
    setBusy(true);
    try {
      await call("POST", `/v1/merchant/orders/${issueFor.id}/item-issue`, {
        order_item_id: selectedItem.id,
        issue: issueType,
        ...(issueNote.trim() !== "" ? { note: issueNote.trim() } : {})
      });
      setIssueFor(null);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
      setIssueFor(null);
    } finally {
      setBusy(false);
    }
  };

  const clock =
    now === null ? "--:--" : `${pad2(new Date(now).getHours())}:${pad2(new Date(now).getMinutes())}`;

  /** جسم بطاقة KDS — الكود + المؤقت + العناصر والمُعدِّلات والملاحظات */
  const renderTicket = (c: Card, actions: React.ReactNode) => {
    const d = details[c.id];
    const e = elapsedSec(c);
    return (
      <article key={c.id} className={s.kt} data-testid="kds-card">
        <div className={s.r1}>
          <span className={s.oid}>{c.display_code}</span>
          <span className={`${s.ktime} ${isLate(c) ? s.ktimeLate : ""}`}>
            {e === null ? "--:--" : mmss(e)}
          </span>
        </div>
        <ul className={s.items}>
          {d ? (
            d.items.map((it, i) => (
              <li key={i}>
                <span className={s.mono}>{it.quantity}×</span> {it.name_ar}
                {it.modifiers.length > 0 && <span className={s.mod}> — {it.modifiers.join("، ")}</span>}
                {it.notes && <div className={s.alrg}>⚠ {it.notes}</div>}
              </li>
            ))
          ) : (
            <li className={s.mod}>{c.items_count} أصناف — جارٍ جلب التفاصيل…</li>
          )}
          {d?.customer_notes && <li className={s.alrg}>⚠ ملاحظة العميل: {d.customer_notes}</li>}
        </ul>
        {actions !== null && <div className={s.actions}>{actions}</div>}
      </article>
    );
  };

  return (
    <main className={s.kds}>
      {/* ترويسة KDS */}
      <header className={s.bhdr}>
        <div className={s.brand}>
          <Badge />
          <div>
            <b>بيكلي — شاشة المطبخ</b>
            <div className={s.sub}>KDS · التحضير والجاهزية</div>
          </div>
        </div>
        <div className={s.sp}>
          <span className={s.pill}>
            <i className={s.dot} /> متصل
          </span>
          <span className={s.clock}>{clock}</span>
        </div>
      </header>

      <section className={s.bmain}>
        {error && (
          <div className={s.noteErr} data-testid="kds-error">
            {error}
          </div>
        )}

        {/* شريط الملخص — كما في B-07 */}
        <div className={s.sumline}>
          <span className={`${s.badge} ${s.bPrep}`}>
            KDS — <span className={s.mono}>{waiting.length + cooking.length}</span> قيد التحضير
          </span>
          {lateCount > 0 && (
            <span className={`${s.badge} ${s.bOver}`}>
              <span className={s.mono}>{lateCount}</span> متأخر
            </span>
          )}
        </div>

        <div className={s.grid3}>
          {/* في الانتظار — MERCHANT_ACCEPTED */}
          <div className={s.kcol}>
            <div className={`${s.kh} ${s.khWait}`}>
              في الانتظار <span className={s.khCount}>{waiting.length}</span>
            </div>
            <div className={s.kb}>
              {waiting.map((c) =>
                renderTicket(
                  c,
                  <>
                    <button
                      className={s.bbtn}
                      data-testid="kds-start"
                      onClick={() => act(`/v1/merchant/orders/${c.id}/preparing`)}
                    >
                      بدء التحضير
                    </button>
                    <button className={`${s.bbtn} ${s.gray}`} data-testid="kds-issue" onClick={() => openIssue(c)}>
                      نقص منتج
                    </button>
                  </>
                )
              )}
              {waiting.length === 0 && <div className={s.kempty}>لا طلبات في الانتظار</div>}
            </div>
          </div>

          {/* قيد التحضير — PREPARING */}
          <div className={s.kcol}>
            <div className={`${s.kh} ${s.khPrep}`}>
              قيد التحضير <span className={s.khCount}>{cooking.length}</span>
            </div>
            <div className={s.kb}>
              {cooking.map((c) =>
                renderTicket(
                  c,
                  <>
                    <button
                      className={`${s.bbtn} ${s.green}`}
                      data-testid="kds-ready"
                      onClick={() => act(`/v1/merchant/orders/${c.id}/ready`, {})}
                    >
                      جاهز ✓
                    </button>
                    <button className={`${s.bbtn} ${s.gray}`} data-testid="kds-issue" onClick={() => openIssue(c)}>
                      نقص منتج
                    </button>
                  </>
                )
              )}
              {cooking.length === 0 && <div className={s.kempty}>لا طلبات قيد التحضير</div>}
            </div>
          </div>

          {/* جاهز — tab=ready */}
          <div className={s.kcol}>
            <div className={`${s.kh} ${s.khDone}`}>
              جاهز <span className={s.khCount}>{ready.length}</span>
            </div>
            <div className={s.kb}>
              {ready.map((c) => renderTicket(c, null))}
              {ready.length === 0 && <div className={s.kempty}>لا طلبات جاهزة</div>}
            </div>
          </div>
        </div>

        <p className={s.foot}>
          المؤقتات من لحظة القبول · الأحمر = تجاوز زمن التجهيز المعلن · «جاهز» ممنوع قبل اكتمال كل
          الأصناف (B-08)
        </p>
      </section>

      {/* Sheet نقص منتج — BR-4 */}
      {issueFor && (
        <div className={s.overlay} onClick={() => setIssueFor(null)}>
          <div
            className={s.sheet}
            role="dialog"
            aria-modal="true"
            data-testid="kds-issue-sheet"
            onClick={(e) => e.stopPropagation()}
          >
            <div className={s.sheetTitle}>
              نقص منتج — <span className={s.oid}>{issueFor.display_code}</span>
            </div>

            <div className={s.sheetLbl}>اختر الصنف</div>
            <div className={s.itemList}>
              {issueDetails ? (
                issueDetails.items.map((it, i) => (
                  <button
                    key={i}
                    className={`${s.itemRow} ${issueItem === i ? s.itemRowOn : ""}`}
                    data-testid="kds-issue-item"
                    onClick={() => setIssueItem(i)}
                  >
                    <span className={`${s.rdot} ${issueItem === i ? s.rdotOn : ""}`} />
                    <span className={s.mono}>{it.quantity}×</span> {it.name_ar}
                    {it.modifiers.length > 0 && <span className={s.mod}> — {it.modifiers.join("، ")}</span>}
                  </button>
                ))
              ) : (
                <div className={s.kempty}>جارٍ جلب عناصر الطلب…</div>
              )}
            </div>

            <div className={s.sheetLbl}>نوع المشكلة</div>
            <div className={s.segRow}>
              {ISSUE_TYPES.map(([key, label]) => (
                <button
                  key={key}
                  className={`${s.itemRow} ${s.segBtn} ${issueType === key ? s.itemRowOn : ""}`}
                  onClick={() => setIssueType(key)}
                >
                  <span className={`${s.rdot} ${issueType === key ? s.rdotOn : ""}`} />
                  {label}
                </button>
              ))}
            </div>

            <textarea
              className={s.ta}
              placeholder="ملاحظة (اختياري)"
              maxLength={280}
              value={issueNote}
              onChange={(e) => setIssueNote(e.target.value)}
            />
            <div className={s.actions}>
              <button
                className={`${s.bbtn} ${s.red}`}
                data-testid="kds-issue-submit"
                disabled={!selectedItem || busy}
                onClick={() => void submitIssue()}
              >
                إبلاغ العميل (BR-4)
              </button>
              <button className={`${s.bbtn} ${s.gray}`} onClick={() => setIssueFor(null)}>
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
