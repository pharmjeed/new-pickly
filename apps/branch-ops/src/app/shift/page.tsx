"use client";

/**
 * B-02/B-16: الوردية — صفحة واحدة بوضعين (design/branch/B-02.html) — J14.
 * فتح: POST /v1/merchant/shifts/open {branch_id, prep_minutes?, notes?}.
 * إغلاق: ملخص اليوم من GET /v1/merchant/shifts/summary ثم POST /v1/merchant/shifts/close.
 * التبديل بحسب حالة الفرع من GET /v1/merchant/branches (open → إغلاق، closed → فتح).
 */
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import s from "./shift.module.css";

interface Branch {
  id: string;
  name_ar: string;
  status: string;
  default_prep_minutes: number;
}

interface ShiftSummary {
  total_today: number;
  completed_today: number;
  rejected_or_noshow: number;
  open_now: number;
}

const pad2 = (n: number): string => String(n).padStart(2, "0");

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

export default function ShiftPage() {
  const router = useRouter();
  const [branchId, setBranchId] = useState<string | null>(null);
  const [branch, setBranch] = useState<Branch | null>(null);
  const [summary, setSummary] = useState<ShiftSummary | null>(null);
  const [prep, setPrep] = useState<number>(15);
  const [prepTouched, setPrepTouched] = useState(false);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState<number | null>(null);

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

  // ساعة الترويسة (أرقام لاتينية Mono)
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const refresh = useCallback(async () => {
    if (!branchId) return;
    try {
      const branches = await call<Branch[]>("GET", "/v1/merchant/branches");
      const b = branches.find((x) => x.id === branchId) ?? null;
      setBranch(b);
      setError(null);
      if (b && b.status === "open") {
        // وضع الإغلاق — ملخص اليوم B-16
        setSummary(await call<ShiftSummary>("GET", `/v1/merchant/shifts/summary?branch_id=${branchId}`));
      } else {
        setSummary(null);
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }, [branchId, call]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // زمن التجهيز الافتراضي من إعدادات الفرع (يُعدّل قبل الفتح)
  useEffect(() => {
    if (branch && !prepTouched) setPrep(branch.default_prep_minutes);
  }, [branch, prepTouched]);

  const mode: "open" | "close" | null = branch === null ? null : branch.status === "open" ? "close" : "open";

  const openShift = async () => {
    if (!branchId || busy) return;
    setBusy(true);
    setOkMsg(null);
    try {
      await call("POST", "/v1/merchant/shifts/open", {
        branch_id: branchId,
        prep_minutes: prep,
        ...(notes.trim() ? { notes: notes.trim() } : {})
      });
      setNotes("");
      setOkMsg("فُتحت الوردية — الفرع يستقبل الطلبات الآن");
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const closeShift = async () => {
    if (!branchId || busy) return;
    setBusy(true);
    setOkMsg(null);
    try {
      await call("POST", "/v1/merchant/shifts/close", {
        branch_id: branchId,
        ...(notes.trim() ? { notes: notes.trim() } : {})
      });
      setNotes("");
      setOkMsg("أُغلقت الوردية — توقف استقبال الطلبات الجديدة");
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const clock =
    now === null ? "--:--" : `${pad2(new Date(now).getHours())}:${pad2(new Date(now).getMinutes())}`;

  return (
    <main className={s.page}>
      {/* ترويسة اللوحة */}
      <header className={s.bhdr}>
        <div className={s.brand}>
          <Badge />
          <div>
            <b>بيكلي — شاشة الفرع</b>
            <div className={s.sub}>{branch ? branch.name_ar : "الوردية"} · شاشة الاستلام</div>
          </div>
        </div>
        <div className={s.sp}>
          <span className={s.pill}>
            <i className={mode === "close" ? s.dotOk : s.dotOff} />
            {mode === "close" ? "الوردية مفتوحة" : "الوردية مغلقة"}
          </span>
          <span className={s.clock}>{clock}</span>
        </div>
      </header>

      <section className={s.bmain}>
        {error && (
          <div className={s.noteErr} data-testid="shift-error">
            {error}
          </div>
        )}
        {okMsg && <div className={s.noteOk}>{okMsg}</div>}

        {mode === null && !error && <div className={s.loading}>جارٍ تحميل حالة الفرع…</div>}

        {/* ===== وضع الفتح (B-02) ===== */}
        {mode === "open" && (
          <>
            <h1 className={s.h1}>فتح وردية جديدة</h1>
            <div className={s.grid2}>
              <div className={s.card}>
                <b className={s.cardTitle}>إعدادات التشغيل</b>
                <div className={s.setRow}>
                  <span>حالة استقبال الطلبات</span>
                  <span className={s.badgeOff}>متوقف — بانتظار الفتح</span>
                </div>
                <div className={s.setRow}>
                  <span>زمن التجهيز الافتراضي</span>
                  <span className={s.qty}>
                    <button
                      type="button"
                      aria-label="زيادة زمن التجهيز"
                      onClick={() => {
                        setPrepTouched(true);
                        setPrep((p) => Math.min(90, p + 1));
                      }}
                    >
                      +
                    </button>
                    <span className={s.qtyVal}>{prep}</span>
                    <button
                      type="button"
                      aria-label="إنقاص زمن التجهيز"
                      onClick={() => {
                        setPrepTouched(true);
                        setPrep((p) => Math.max(5, p - 1));
                      }}
                    >
                      −
                    </button>
                  </span>
                </div>
                <p className={s.hint}>
                  بالدقائق — يُطبَّق على كل الطلبات الجديدة حتى تغييره أو تفعيل وضع الازدحام.
                </p>
              </div>
              <div className={s.card}>
                <b className={s.cardTitle}>ملاحظات افتتاح الوردية (اختياري)</b>
                <textarea
                  className={s.textarea}
                  value={notes}
                  maxLength={280}
                  placeholder="مثال: الموقف 6 مغلق للصيانة اليوم"
                  onChange={(e) => setNotes(e.target.value)}
                />
                <div className={s.noteInfo}>تظهر الملاحظات في سجل التشغيل — لا تُعرض للعملاء.</div>
              </div>
            </div>
            <div className={s.footRow}>
              <button className={s.bbtn} data-testid="shift-open" disabled={busy} onClick={openShift}>
                افتح الوردية — ابدأ الاستقبال
              </button>
            </div>
          </>
        )}

        {/* ===== وضع الإغلاق (B-16) ===== */}
        {mode === "close" && (
          <>
            <h1 className={s.h1}>إغلاق الوردية</h1>

            {summary && summary.open_now > 0 && (
              <div className={s.noteWarn} data-testid="shift-open-orders-warning">
                <b>
                  {summary.open_now === 1 ? "طلب واحد مفتوح" : `${summary.open_now} طلبات مفتوحة`}
                </b>{" "}
                — الإغلاق يوقف الطلبات الجديدة فقط ولا يعطّل تسليم القائم. سلّمها من اللوحة قبل المغادرة.
              </div>
            )}

            {/* ملخص اليوم */}
            <div className={s.sumline}>
              <div className={s.sum}>
                <span className={s.sumK}>طلبات اليوم</span>
                <span className={s.sumV}>{summary ? summary.total_today : "—"}</span>
              </div>
              <div className={s.sum}>
                <span className={s.sumK}>مكتملة</span>
                <span className={s.sumV}>{summary ? summary.completed_today : "—"}</span>
              </div>
              <div className={s.sum}>
                <span className={s.sumK}>مرفوضة / لم يحضر</span>
                <span className={s.sumV}>{summary ? summary.rejected_or_noshow : "—"}</span>
              </div>
              <div className={s.sum}>
                <span className={s.sumK}>مفتوحة الآن</span>
                <span className={`${s.sumV} ${summary && summary.open_now > 0 ? s.sumWarn : ""}`}>
                  {summary ? summary.open_now : "—"}
                </span>
              </div>
            </div>

            <div className={s.card}>
              <b className={s.cardTitle}>ملاحظات تشغيلية للوردية التالية (اختياري)</b>
              <textarea
                className={s.textarea}
                value={notes}
                maxLength={280}
                placeholder="مثال: بيكون البقري ينفد غداً — بلغوا التوريد"
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>

            <div className={s.footRow}>
              <button
                className={`${s.bbtn} ${s.red}`}
                data-testid="shift-close"
                disabled={busy}
                onClick={closeShift}
              >
                إغلاق الوردية الآن
              </button>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
