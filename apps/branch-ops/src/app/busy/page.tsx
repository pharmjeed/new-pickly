"use client";

/**
 * B-15: وضع الازدحام — مدير الفرع (design/branch/B-15.html) — BR-10.
 * POST /v1/merchant/branches/{branch_id}/busy-mode بالحقول المختارة فقط
 * {prep_delta_minutes? | pause? | close_pickup_only?} + customer_message? —
 * الخادم يرفض طلباً بلا أي إجراء. العودة الطبيعية: POST /v1/merchant/shifts/open {branch_id}.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import s from "./busy.module.css";

interface Branch {
  id: string;
  name_ar: string;
  status: string;
  busy_message: string | null;
}

type PrepDelta = 10 | 20 | 30;

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

export default function BusyPage() {
  const router = useRouter();
  const [branchId, setBranchId] = useState<string | null>(null);
  const [branch, setBranch] = useState<Branch | null>(null);
  const [prepDelta, setPrepDelta] = useState<PrepDelta | null>(null);
  const [pause, setPause] = useState(false);
  const [closePickup, setClosePickup] = useState(false);
  const [message, setMessage] = useState(
    "الضغط مرتفع حالياً — نعتذر عن أي تأخير، طلبك يستحق الانتظار"
  );
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
      setBranch(branches.find((b) => b.id === branchId) ?? null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [branchId, call]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // الخادم يرفض طلباً بلا أي إجراء — عطّل التطبيق حتى يُختار إجراء واحد على الأقل
  const hasAction = prepDelta !== null || pause || closePickup;

  const applyBusy = async () => {
    if (!branchId || !hasAction || busy) return;
    setBusy(true);
    setOkMsg(null);
    try {
      await call("POST", `/v1/merchant/branches/${branchId}/busy-mode`, {
        ...(prepDelta !== null ? { prep_delta_minutes: prepDelta } : {}),
        ...(pause ? { pause: true } : {}),
        ...(closePickup ? { close_pickup_only: true } : {}),
        ...(message.trim() ? { customer_message: message.trim().slice(0, 140) } : {})
      });
      setOkMsg("فُعِّل وضع الازدحام — انعكس فوراً على واجهات العملاء");
      setError(null);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // العودة الطبيعية — يعيد حالة الفرع open
  const endBusy = async () => {
    if (!branchId || busy) return;
    setBusy(true);
    setOkMsg(null);
    try {
      await call("POST", "/v1/merchant/shifts/open", { branch_id: branchId });
      setPrepDelta(null);
      setPause(false);
      setClosePickup(false);
      setOkMsg("أُنهي وضع الازدحام — عاد الفرع للاستقبال الطبيعي");
      setError(null);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const busyActive = branch !== null && branch.status !== "open";
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
            <div className={s.sub}>{branch ? branch.name_ar : "وضع الازدحام"} · شاشة الاستلام</div>
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
        <div className={s.titleRow}>
          <h1 className={s.h1}>وضع الازدحام</h1>
          <span className={s.roleBadge}>صلاحية مدير الفرع فقط (BR-10)</span>
        </div>

        {error && (
          <div className={s.noteErr} data-testid="busy-error">
            {error}
          </div>
        )}
        {okMsg && <div className={s.noteOk}>{okMsg}</div>}

        {busyActive && (
          <div className={s.noteWarn} data-testid="busy-active-note">
            <b>الوضع مفعّل الآن</b> — الفرع لا يستقبل بشكل طبيعي. انعكس فوراً على بطاقات الاكتشاف
            والتنبيه الزمني في السلة.
          </div>
        )}

        <div className={s.grid2}>
          {/* زيادة وقت التحضير */}
          <div className={s.card}>
            <b className={s.cardTitle}>زيادة وقت التحضير</b>
            <div className={s.chipRow}>
              {([10, 20, 30] as PrepDelta[]).map((d) => (
                <button
                  key={d}
                  type="button"
                  className={`${s.fchip} ${prepDelta === d ? s.fchipOn : ""}`}
                  aria-pressed={prepDelta === d}
                  data-testid={`busy-delta-${d}`}
                  onClick={() => setPrepDelta((cur) => (cur === d ? null : d))}
                >
                  +{d} د
                </button>
              ))}
            </div>
          </div>

          {/* إيقاف مؤقت */}
          <div className={s.card}>
            <div className={s.switchRow}>
              <div>
                <b className={s.cardTitle}>إيقاف مؤقت للطلبات</b>
                <div className={s.muted}>لا طلبات جديدة حتى الإلغاء</div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={pause}
                aria-label="إيقاف مؤقت للطلبات"
                className={`${s.switch} ${pause ? s.switchOn : ""}`}
                data-testid="busy-pause"
                onClick={() => setPause((v) => !v)}
              />
            </div>
          </div>

          {/* إغلاق الاستلام فقط */}
          <div className={s.card}>
            <div className={s.switchRow}>
              <div>
                <b className={s.cardTitle}>إغلاق الاستلام فقط</b>
                <div className={s.muted}>يستمر المجدول — يتوقف الفوري</div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={closePickup}
                aria-label="إغلاق الاستلام فقط"
                className={`${s.switch} ${closePickup ? s.switchOn : ""}`}
                data-testid="busy-close-pickup"
                onClick={() => setClosePickup((v) => !v)}
              />
            </div>
          </div>

          {/* رسالة العملاء */}
          <div className={s.card}>
            <b className={s.cardTitle}>رسالة تظهر للعملاء</b>
            <input
              className={s.msgInput}
              value={message}
              maxLength={140}
              data-testid="busy-message"
              onChange={(e) => setMessage(e.target.value)}
            />
          </div>
        </div>

        <div className={s.footRow}>
          <button
            className={`${s.bbtn} ${s.orange}`}
            data-testid="busy-apply"
            disabled={!hasAction || busy}
            onClick={applyBusy}
          >
            تفعيل وضع الازدحام الآن
          </button>
          <button
            className={`${s.bbtn} ${s.green}`}
            data-testid="busy-end"
            disabled={busy}
            onClick={endBusy}
          >
            إنهاء وضع الازدحام
          </button>
          <Link href="/board" className={`${s.bbtn} ${s.gray}`}>
            رجوع
          </Link>
        </div>
      </section>
    </main>
  );
}
