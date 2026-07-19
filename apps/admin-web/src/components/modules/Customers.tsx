"use client";

/**
 * A-07: عملاء المنصة — جدول + النقر يفتح الملف الشامل (CustomerFile — قرار المالك 2026-07-19)
 * + حظر/رفع بنافذة سبب إلزامي + إعدادات المكافآت والدعوة (growth.rewards).
 */
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, apiGet, apiPost } from "@/lib/api";
import ReasonModal from "@/components/ReasonModal";
import CustomerFile from "@/components/modules/CustomerFile";
import { Qirtas, QirtasLoader } from "@/components/qirtas";

type Customer = {
  id: string;
  phone_masked: string;
  full_name: string | null;
  status: string;
  orders: number;
  no_show_count_30d: number;
  risk_flagged: boolean;
};

const STATUS_AR: Record<string, { label: string; cls: string }> = {
  active: { label: "نشط", cls: "b-lime" },
  blocked: { label: "محظور", cls: "b-err" },
  deleted: { label: "حذف قيد المعالجة", cls: "b-soft" }
};

type PendingBlock = { customer: Customer; action: "block" | "unblock" };

type Growth = { points_per_sar: number; referrer_reward_halalas: number; friend_reward_halalas: number };

/** بطاقة إعدادات النمو: نقاط لكل ريال + مبلغا مكافأة الدعوة — حفظ بسبب مُدقق */
function GrowthSettingsCard() {
  const [growth, setGrowth] = useState<Growth | null>(null);
  const [pointsPerSar, setPointsPerSar] = useState("");
  const [referrer, setReferrer] = useState("");
  const [friend, setFriend] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [msg, setMsg] = useState<{ err: boolean; text: string } | null>(null);

  useEffect(() => {
    apiGet<Growth>("/api/v1/admin/ops/growth")
      .then((g) => {
        setGrowth(g);
        setPointsPerSar(String(g.points_per_sar));
        setReferrer((g.referrer_reward_halalas / 100).toFixed(0));
        setFriend((g.friend_reward_halalas / 100).toFixed(0));
      })
      .catch((e: unknown) => setMsg({ err: true, text: (e as Error).message }));
  }, []);

  const save = async (reason: string) => {
    setSaving(true);
    setMsg(null);
    try {
      await apiPost("/api/v1/admin/ops/growth", {
        points_per_sar: Math.round(Number(pointsPerSar)),
        referrer_reward_halalas: Math.round(Number(referrer) * 100),
        friend_reward_halalas: Math.round(Number(friend) * 100),
        reason
      });
      setConfirm(false);
      setMsg({ err: false, text: "حُفظت إعدادات المكافآت والدعوة — تسري على الطلبات المكتملة بعد الآن" });
    } catch (e) {
      setMsg({ err: true, text: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  const valid =
    [pointsPerSar, referrer, friend].every((v) => v.trim() !== "" && Number.isFinite(Number(v)) && Number(v) >= 0);

  return (
    <div className="pcardx" style={{ marginTop: 14 }} data-testid="growth-settings">
      <h3>إعدادات المكافآت والدعوة</h3>
      {!growth && !msg && <p className="muted">جارٍ التحميل…</p>}
      {growth && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
            <div className="fld">
              <label htmlFor="g-points">نقاط لكل ريال مدفوع</label>
              <input id="g-points" data-testid="growth-points" type="number" min={0} value={pointsPerSar} onChange={(e) => setPointsPerSar(e.target.value)} />
              <span className="hint">0 = إيقاف كسب النقاط</span>
            </div>
            <div className="fld">
              <label htmlFor="g-ref">مكافأة الداعي (ر.س)</label>
              <input id="g-ref" data-testid="growth-referrer" type="number" min={0} value={referrer} onChange={(e) => setReferrer(e.target.value)} />
              <span className="hint">تُودع في محفظته بعد أول طلب مكتمل للمدعو</span>
            </div>
            <div className="fld">
              <label htmlFor="g-friend">مكافأة المدعو (ر.س)</label>
              <input id="g-friend" data-testid="growth-friend" type="number" min={0} value={friend} onChange={(e) => setFriend(e.target.value)} />
              <span className="hint">تُودع في محفظة الصديق الجديد</span>
            </div>
          </div>
          <button type="button" className="btn sm" style={{ marginTop: 10 }} disabled={!valid || saving} onClick={() => setConfirm(true)} data-testid="growth-save">
            حفظ الإعدادات
          </button>
          <p className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>
            إيقاف النقاط أو الدعوة بالكامل من Feature Flags: loyalty_points · referral_program.
          </p>
        </>
      )}
      {msg && <div className={`note ${msg.err ? "err" : "info"}`} style={{ marginTop: 10 }}>{msg.text}</div>}
      {confirm && (
        <ReasonModal
          title="حفظ إعدادات المكافآت والدعوة"
          confirmLabel="حفظ"
          busy={saving}
          onConfirm={(r) => void save(r)}
          onClose={() => setConfirm(false)}
        />
      )}
    </div>
  );
}

export default function Customers() {
  const router = useRouter();
  const [customers, setCustomers] = useState<Customer[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingBlock | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(() => {
    apiGet<Customer[]>("/api/v1/admin/customers")
      .then(setCustomers)
      .catch((e: unknown) => {
        if (e instanceof ApiError && e.status === 401) {
          router.replace("/");
          return;
        }
        setError((e as Error).message);
      });
  }, [router]);

  useEffect(load, [load]);

  const confirm = async (reason: string) => {
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      await apiPost(`/api/v1/admin/customers/${pending.customer.id}/block`, {
        action: pending.action,
        reason
      });
      setNotice(
        pending.action === "block"
          ? `حُظر العميل ${pending.customer.phone_masked} — السبب دخل سجل التدقيق`
          : `رُفع الحظر عن العميل ${pending.customer.phone_masked}`
      );
      setPending(null);
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (openId) {
    return <CustomerFile customerId={openId} onBack={() => setOpenId(null)} onChanged={load} />;
  }

  return (
    <>
      {error && (
        <div className="note err" data-testid="customers-error">
          {error}
        </div>
      )}
      {notice && (
        <div className="note info" data-testid="customers-notice">
          {notice}
        </div>
      )}

      {!customers && !error && <div className="loadwrap" style={{ minHeight: 260 }}><QirtasLoader /></div>}

      {customers && customers.length === 0 && (
        <div className="empty">
          <div className="qr"><Qirtas mood="sleepy" size={72} /></div>
          <b>لا عملاء بعد</b>
          <p>يظهر عملاء المنصة هنا فور تسجيلهم</p>
        </div>
      )}

      {customers && customers.length > 0 && (
        <div className="tblwrap">
          <table className="tbl" data-testid="customers-table">
            <thead>
              <tr>
                <th>العميل</th>
                <th>الجوال</th>
                <th>الطلبات</th>
                <th>No-show (30 يوماً)</th>
                <th>الحالة</th>
                <th>إجراء</th>
              </tr>
            </thead>
            <tbody>
              {customers.map((c) => {
                const badge = STATUS_AR[c.status] ?? { label: c.status, cls: "b-soft" };
                return (
                  <tr key={c.id} data-testid="customer-row">
                    <td>
                      <button
                        type="button"
                        className="linklike"
                        style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "inherit", font: "inherit" }}
                        onClick={() => setOpenId(c.id)}
                        data-testid="customer-open"
                      >
                        <b>{c.full_name ?? "بدون اسم"}</b>
                      </button>
                      {c.risk_flagged && (
                        <span
                          className="badge b-warn"
                          style={{ fontSize: "10px", marginInlineStart: 8 }}
                          data-testid="customer-risk-badge"
                        >
                          إشارة مخاطر
                        </span>
                      )}
                    </td>
                    <td className="mono">{c.phone_masked}</td>
                    <td className="mono">{c.orders.toLocaleString("en")}</td>
                    <td className="mono">{c.no_show_count_30d}</td>
                    <td>
                      <span className={`badge ${badge.cls}`} style={{ fontSize: "10.5px" }} data-testid="customer-status">
                        {badge.label}
                      </span>
                    </td>
                    <td>
                      {c.status === "blocked" ? (
                        <button
                          type="button"
                          className="btn sm sec2"
                          data-testid="customer-block"
                          data-action="unblock"
                          onClick={() => setPending({ customer: c, action: "unblock" })}
                        >
                          رفع الحظر
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="btn sm dgh"
                          data-testid="customer-block"
                          data-action="block"
                          onClick={() => setPending({ customer: c, action: "block" })}
                        >
                          حظر
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="note soft">
        البيانات مقنّعة افتراضياً — النقر على اسم العميل يفتح ملفه الشامل (محفظة، نقاط، دعوات، طلبات، سيارات، بطاقات، تذاكر) · 3 No-show في 30 يوماً = إشارة مخاطر تلقائية (BR-3).
      </div>

      <GrowthSettingsCard />

      {pending && (
        <ReasonModal
          title={
            pending.action === "block"
              ? `حظر العميل ${pending.customer.phone_masked}`
              : `رفع الحظر عن العميل ${pending.customer.phone_masked}`
          }
          confirmLabel={pending.action === "block" ? "حظر" : "رفع الحظر"}
          danger={pending.action === "block"}
          busy={busy}
          onConfirm={confirm}
          onClose={() => setPending(null)}
        />
      )}
    </>
  );
}
