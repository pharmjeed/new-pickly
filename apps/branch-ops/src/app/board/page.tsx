"use client";

/**
 * B-03 (مصغرة): لوحة التشغيل الجامعة — التبويبات = الحالات،
 * القبول/الرفض/التسليم على البطاقة، الترتيب حسب زمن الوصول (docs/21§1).
 */
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

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
}

const TABS = [
  ["new", "جديدة"],
  ["preparing", "قيد التجهيز"],
  ["ready", "جاهزة"],
  ["arrived", "وصلوا"],
  ["completed", "المكتملة"]
] as const;

function cardState(status: string): string {
  if (status === "MERCHANT_PENDING") return "new";
  if (["MERCHANT_ACCEPTED", "PREPARING"].includes(status)) return "prep";
  if (["CUSTOMER_NEARBY", "CUSTOMER_ON_THE_WAY"].includes(status)) return "near";
  if (["CUSTOMER_ARRIVED", "HANDOFF_IN_PROGRESS"].includes(status)) return "arrived";
  if (status === "COMPLETED") return "done";
  return "prep";
}

export default function BoardPage() {
  const router = useRouter();
  const [branchId, setBranchId] = useState<string | null>(null);
  const [tab, setTab] = useState<string>("new");
  const [cards, setCards] = useState<Card[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [codeFor, setCodeFor] = useState<string | null>(null);
  const [codeVal, setCodeVal] = useState("");

  const token = typeof window !== "undefined" ? localStorage.getItem("bo_token") : null;

  const call = useCallback(
    async <T,>(method: string, path: string, body?: unknown, idem = false): Promise<T> => {
      const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
      if (body !== undefined) headers["Content-Type"] = "application/json";
      if (idem) headers["Idempotency-Key"] = crypto.randomUUID();
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

  const refresh = useCallback(async () => {
    if (!branchId) return;
    try {
      const list = await call<Card[]>("GET", `/v1/merchant/orders?branch_id=${branchId}&tab=${tab}`);
      setCards(list);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
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

  return (
    <main className="bo-wrap">
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1 style={{ fontFamily: "var(--pk-font-display)", fontWeight: 800, fontSize: "var(--pk-fs-32)" }}>
          لوحة التشغيل
        </h1>
        {error && <span style={{ color: "var(--pk-error)" }} data-testid="board-error">{error}</span>}
      </header>

      <div className="bo-tabs" role="tablist">
        {TABS.map(([key, label]) => (
          <button key={key} role="tab" className={`bo-tab ${tab === key ? "active" : ""}`} data-testid={`tab-${key}`} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </div>

      <div className="bo-grid">
        {cards.map((c) => (
          <div key={c.id} className="bo-card bo-order" data-state={cardState(c.order_status)} data-testid="order-card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <span className="bo-code">{c.display_code}</span>
              {c.eta_minutes !== null && <span className="bo-muted">{c.eta_minutes} د</span>}
            </div>

            {/* بطاقة السيارة أكبر عنصر — كتاب الهوية §11 */}
            {c.vehicle_summary && <p className="bo-vehicle">{c.vehicle_summary}</p>}
            <p className="bo-muted">
              {c.customer_first_name} · {c.customer_phone_masked} · {c.items_count} عناصر
              {c.parking_spot && <> · <strong style={{ color: "var(--pk-lime-900)" }}>موقف {c.parking_spot}</strong></>}
            </p>

            <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
              {c.order_status === "MERCHANT_PENDING" && (
                <>
                  <button className="bo-btn" data-testid="accept-order" onClick={() => act(`/v1/merchant/orders/${c.id}/accept`, {}, true)}>قبول</button>
                  <button className="bo-btn danger" data-testid="reject-order" onClick={() => act(`/v1/merchant/orders/${c.id}/reject`, { reason: "high_load" }, true)}>رفض</button>
                </>
              )}
              {c.order_status === "MERCHANT_ACCEPTED" && (
                <button className="bo-btn ghost" data-testid="start-preparing" onClick={() => act(`/v1/merchant/orders/${c.id}/preparing`)}>بدء التجهيز</button>
              )}
              {c.order_status === "PREPARING" && (
                <button className="bo-btn" data-testid="mark-ready" onClick={() => act(`/v1/merchant/orders/${c.id}/ready`, {})}>جاهز</button>
              )}
              {c.order_status === "CUSTOMER_ARRIVED" && (
                <button className="bo-btn" data-testid="handoff-start" onClick={() => act(`/v1/merchant/orders/${c.id}/handoff/start`)}>خرج الموظف</button>
              )}
              {c.order_status === "HANDOFF_IN_PROGRESS" && codeFor !== c.id && (
                <button className="bo-btn" data-testid="handoff-open-code" onClick={() => { setCodeFor(c.id); setCodeVal(""); }}>تحقق وسلّم</button>
              )}
              {codeFor === c.id && (
                <div style={{ display: "flex", gap: 8, width: "100%" }}>
                  <input
                    className="bo-input"
                    data-testid="handoff-code-input"
                    placeholder="رمز العميل"
                    inputMode="numeric"
                    maxLength={4}
                    value={codeVal}
                    onChange={(e) => setCodeVal(e.target.value)}
                    style={{ direction: "ltr", textAlign: "center", maxWidth: 160 }}
                  />
                  <button
                    className="bo-btn"
                    data-testid="handoff-complete"
                    disabled={codeVal.length !== 4}
                    onClick={() => act(`/v1/merchant/orders/${c.id}/handoff/complete`, { verification: { method: "code", code: codeVal } })}
                  >
                    سلّمت
                  </button>
                </div>
              )}
              {c.order_status === "COMPLETED" && <span className="bo-muted">تم التسليم ✓</span>}
            </div>
          </div>
        ))}
        {cards.length === 0 && <div className="bo-card bo-muted">لا طلبات في هذا التبويب</div>}
      </div>
    </main>
  );
}
