"use client";

/**
 * M-06: الاستلام المجدول — BR-5 «فترات بسعة يحددها الفرع»:
 * تفعيل الجدولة للفرع + إنشاء فترات يوم دفعة واحدة + جدول الإشغال + حذف الفارغة.
 * الحجز من العميل يمر بسباق سعة ذرّي خادمياً — هنا الإدارة فقط.
 */
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Shell from "@/components/Shell";
import { ApiError, apiDelete, apiGet, apiPost, clearToken } from "@/lib/api";

type Branch = { id: string; name_ar: string };
type Settings = { branch_id: string; scheduled_enabled: boolean };
type Slot = { id: string; slot_start: string; slot_end: string; capacity: number; booked: number };

const dt = (iso: string): string =>
  new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

const todayISO = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export default function ScheduledPage() {
  const router = useRouter();
  const [branches, setBranches] = useState<Branch[] | null>(null);
  const [branchId, setBranchId] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [date, setDate] = useState(todayISO());
  const [fromHour, setFromHour] = useState("11");
  const [toHour, setToHour] = useState("23");
  const [slotMinutes, setSlotMinutes] = useState<"30" | "60">("30");
  const [capacity, setCapacity] = useState("6");

  const authGuard = useCallback(
    (e: unknown) => {
      if (e instanceof ApiError && e.status === 401) {
        clearToken();
        router.replace("/");
        return true;
      }
      return false;
    },
    [router]
  );

  useEffect(() => {
    apiGet<Branch[]>("/api/v1/merchant/branches")
      .then((bs) => {
        setBranches(bs);
        if (bs[0]) setBranchId(bs[0].id);
      })
      .catch((e: unknown) => {
        if (!authGuard(e)) setError((e as Error).message);
      });
  }, [authGuard]);

  const loadBranch = useCallback(() => {
    if (!branchId) return;
    Promise.all([
      apiGet<Settings>(`/api/v1/merchant/scheduled/settings?branch_id=${branchId}`),
      apiGet<Slot[]>(`/api/v1/merchant/scheduled/slots?branch_id=${branchId}`)
    ])
      .then(([st, sl]) => {
        setEnabled(st.scheduled_enabled);
        setSlots(sl);
      })
      .catch((e: unknown) => {
        if (!authGuard(e)) setError((e as Error).message);
      });
  }, [branchId, authGuard]);

  useEffect(loadBranch, [loadBranch]);

  const toggle = async () => {
    if (!branchId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiPost<{ scheduled_enabled: boolean }>("/api/v1/merchant/scheduled/settings", {
        branch_id: branchId,
        scheduled_enabled: !enabled
      });
      setEnabled(res.scheduled_enabled);
      setNotice(res.scheduled_enabled ? "فُعّلت الجدولة — العملاء يرون فتراتك المتاحة" : "أُطفئت الجدولة لهذا الفرع");
    } catch (e) {
      if (!authGuard(e)) setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const createSlots = async () => {
    if (!branchId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiPost<{ slots: number }>("/api/v1/merchant/scheduled/slots", {
        branch_id: branchId,
        date,
        from_hour: Number(fromHour),
        to_hour: Number(toHour),
        slot_minutes: Number(slotMinutes),
        capacity: Number(capacity)
      });
      setNotice(`أُنشئت/حُدّثت ${res.slots} فترة ليوم ${date}`);
      loadBranch();
    } catch (e) {
      if (!authGuard(e)) setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const removeSlot = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      await apiDelete(`/api/v1/merchant/scheduled/slots/${id}`);
      loadBranch();
    } catch (e) {
      if (!authGuard(e)) setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const validForm =
    Number(fromHour) >= 0 && Number(toHour) > Number(fromHour) && Number(toHour) <= 24 && Number(capacity) >= 1;

  return (
    <Shell title="الاستلام المجدول" crumb="فترات بسعة يحددها الفرع (BR-5) — الدفع يؤكد الحجز وآخر تعديل مجاني قبل ساعة">
      {error && <div className="note err" data-testid="scheduled-error">{error}</div>}
      {notice && <div className="note info" data-testid="scheduled-notice">{notice}</div>}

      {!branches && !error && <div className="skl" style={{ height: 220 }} />}

      {branches && (
        <div className="pcardx" data-testid="scheduled-settings">
          <h3>
            إعداد الفرع
            <span className="sp">
              <button type="button" className={`btn sm${enabled ? " sec2" : ""}`} disabled={busy || !branchId} onClick={toggle} data-testid="scheduled-toggle">
                {enabled ? "إيقاف الجدولة" : "تفعيل الجدولة"}
              </button>
            </span>
          </h3>
          <div style={{ display: "flex", gap: 10, alignItems: "end", flexWrap: "wrap" }}>
            <div className="fld" style={{ minWidth: 220 }}>
              <label>الفرع</label>
              <select className="inp" value={branchId ?? ""} onChange={(e) => setBranchId(e.target.value)} data-testid="scheduled-branch">
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>{b.name_ar}</option>
                ))}
              </select>
            </div>
            <span className={`badge ${enabled ? "b-lime" : "b-soft"}`} style={{ marginBottom: 12 }}>
              {enabled ? "الجدولة مفعلة" : "الجدولة مطفأة"}
            </span>
          </div>
        </div>
      )}

      {branches && (
        <div className="pcardx" style={{ marginTop: 14 }} data-testid="slots-form">
          <h3>إنشاء فترات يوم — فترات متساوية بسعة موحدة</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10 }}>
            <div className="fld">
              <label>اليوم</label>
              <input className="inp" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="fld">
              <label>من الساعة</label>
              <input className="inp" inputMode="numeric" value={fromHour} onChange={(e) => setFromHour(e.target.value)} />
            </div>
            <div className="fld">
              <label>إلى الساعة</label>
              <input className="inp" inputMode="numeric" value={toHour} onChange={(e) => setToHour(e.target.value)} />
            </div>
            <div className="fld">
              <label>طول الفترة</label>
              <select className="inp" value={slotMinutes} onChange={(e) => setSlotMinutes(e.target.value as "30" | "60")}>
                <option value="30">30 دقيقة</option>
                <option value="60">60 دقيقة</option>
              </select>
            </div>
            <div className="fld">
              <label>السعة لكل فترة</label>
              <input className="inp" inputMode="numeric" value={capacity} onChange={(e) => setCapacity(e.target.value)} />
            </div>
          </div>
          <button type="button" className="btn sm" style={{ marginTop: 12 }} disabled={busy || !validForm || !branchId} onClick={createSlots} data-testid="slots-create">
            إنشاء الفترات
          </button>
          <div className="note soft" style={{ marginTop: 10 }}>
            الفترات القائمة تُحدَّث سعتها دون المساس بالحجوزات — والفترة المحجوزة لا تُحذف.
          </div>
        </div>
      )}

      {slots && slots.length === 0 && (
        <div className="empty">
          <div className="ic">🗓</div>
          <b>لا فترات قادمة</b>
          <p>أنشئ فترات يومك من النموذج أعلاه ليتمكن العملاء من الحجز</p>
        </div>
      )}

      {slots && slots.length > 0 && (
        <div className="tblwrap" style={{ marginTop: 14 }}>
          <table className="tbl" data-testid="slots-table">
            <thead>
              <tr>
                <th>الفترة</th>
                <th>السعة</th>
                <th>المحجوز</th>
                <th>الإشغال</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {slots.map((s) => (
                <tr key={s.id} data-testid="slot-row">
                  <td className="mono">{dt(s.slot_start)} → {dt(s.slot_end).slice(-5)}</td>
                  <td className="mono">{s.capacity}</td>
                  <td className="mono">{s.booked}</td>
                  <td>
                    <span className={`badge ${s.booked >= s.capacity ? "b-warn" : "b-lime"}`}>
                      {Math.round((s.booked / s.capacity) * 100)}٪
                    </span>
                  </td>
                  <td>
                    {s.booked === 0 ? (
                      <button type="button" className="btn sm sec2" disabled={busy} onClick={() => removeSlot(s.id)} data-testid="slot-delete">
                        حذف
                      </button>
                    ) : (
                      <span style={{ color: "var(--pk-text-2)", fontSize: 12 }}>عليها حجوزات</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Shell>
  );
}
