"use client";

/**
 * M-06: الاستلام المجدول — BR-5 «فترات بسعة يحددها الفرع»:
 * التاجر يحدد دوام الأسبوع (أيام العمل وساعاتها) والفترات تتولّد منه تلقائياً
 * للأيام السبعة القادمة وتتجدد دورياً — لا إدخال يدوي ليوم يوم.
 * الحجز من العميل يمر بسباق سعة ذرّي خادمياً — هنا الإدارة فقط.
 */
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Shell from "@/components/Shell";
import { Qirtas } from "@/components/qirtas";
import { ApiError, apiDelete, apiGet, apiPost, clearToken } from "@/lib/api";

type Branch = { id: string; name_ar: string };
type Settings = { branch_id: string; scheduled_enabled: boolean };
type Slot = { id: string; slot_start: string; slot_end: string; capacity: number; booked: number };
type Week = {
  branch_id: string;
  days: { day_of_week: number; opens_at: string; closes_at: string }[];
  slot_minutes: number;
  capacity: number;
};
type DayForm = { enabled: boolean; opens: string; closes: string };

const DAY_NAMES = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"]; // 0=الأحد كما في الخادم

const emptyWeek = (): DayForm[] =>
  Array.from({ length: 7 }, () => ({ enabled: false, opens: "11:00", closes: "23:00" }));

const dt = (iso: string): string =>
  new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export default function ScheduledPage() {
  const router = useRouter();
  const [branches, setBranches] = useState<Branch[] | null>(null);
  const [branchId, setBranchId] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [week, setWeek] = useState<DayForm[]>(emptyWeek());
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
      apiGet<Slot[]>(`/api/v1/merchant/scheduled/slots?branch_id=${branchId}`),
      apiGet<Week>(`/api/v1/merchant/scheduled/week?branch_id=${branchId}`)
    ])
      .then(([st, sl, wk]) => {
        setEnabled(st.scheduled_enabled);
        setSlots(sl);
        setSlotMinutes(wk.slot_minutes === 60 ? "60" : "30");
        setCapacity(String(wk.capacity));
        const days = emptyWeek();
        for (const d of wk.days) {
          if (d.day_of_week >= 0 && d.day_of_week <= 6) {
            days[d.day_of_week] = { enabled: true, opens: d.opens_at, closes: d.closes_at };
          }
        }
        setWeek(days);
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

  const setDay = (i: number, patch: Partial<DayForm>) =>
    setWeek((w) => w.map((d, idx) => (idx === i ? { ...d, ...patch } : d)));

  const saveWeek = async () => {
    if (!branchId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiPost<{ days: number; slots: number }>("/api/v1/merchant/scheduled/week", {
        branch_id: branchId,
        slot_minutes: Number(slotMinutes),
        capacity: Number(capacity),
        days: week
          .map((d, day_of_week) => ({ day_of_week, opens_at: d.opens, closes_at: d.closes, enabled: d.enabled }))
          .filter((d) => d.enabled)
          .map(({ day_of_week, opens_at, closes_at }) => ({ day_of_week, opens_at, closes_at }))
      });
      setNotice(`حُفظ دوام الأسبوع (${res.days} ${res.days === 1 ? "يوم" : "أيام"}) — تولّدت/حُدّثت ${res.slots} فترة للأيام السبعة القادمة`);
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

  const openDays = week.filter((d) => d.enabled);
  const validForm =
    Number(capacity) >= 1 &&
    openDays.every((d) => /^\d{2}:\d{2}$/.test(d.opens) && /^\d{2}:\d{2}$/.test(d.closes) && d.opens !== d.closes);

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
        <div className="pcardx" style={{ marginTop: 14 }} data-testid="week-form">
          <h3>دوام الأسبوع — الفترات تتولّد تلقائياً من أيام وساعات العمل</h3>

          <div className="tblwrap">
            <table className="tbl" data-testid="week-table">
              <thead>
                <tr>
                  <th style={{ width: 120 }}>اليوم</th>
                  <th style={{ width: 90 }}>يعمل؟</th>
                  <th>يفتح</th>
                  <th>يغلق</th>
                </tr>
              </thead>
              <tbody>
                {week.map((d, i) => (
                  <tr key={DAY_NAMES[i]} data-testid="week-day-row" style={{ opacity: d.enabled ? 1 : 0.55 }}>
                    <td><b>{DAY_NAMES[i]}</b></td>
                    <td>
                      <label style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                        <input
                          type="checkbox"
                          checked={d.enabled}
                          onChange={(e) => setDay(i, { enabled: e.target.checked })}
                          data-testid={`week-day-enabled-${i}`}
                        />
                        <span className={`badge ${d.enabled ? "b-lime" : "b-soft"}`}>{d.enabled ? "يعمل" : "مغلق"}</span>
                      </label>
                    </td>
                    <td>
                      <input className="inp" type="time" value={d.opens} disabled={!d.enabled} onChange={(e) => setDay(i, { opens: e.target.value })} style={{ maxWidth: 140 }} />
                    </td>
                    <td>
                      <input className="inp" type="time" value={d.closes} disabled={!d.enabled} onChange={(e) => setDay(i, { closes: e.target.value })} style={{ maxWidth: 140 }} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginTop: 12 }}>
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

          <button type="button" className="btn sm" style={{ marginTop: 12 }} disabled={busy || !validForm || !branchId} onClick={saveWeek} data-testid="week-save">
            حفظ الدوام وتوليد الفترات
          </button>
          <div className="note soft" style={{ marginTop: 10 }}>
            الفترات تتولّد للأيام السبعة القادمة وتتجدد تلقائياً كل ساعة. عند الحفظ تُعاد مواءمة الفترات
            المستقبلية غير المحجوزة مع الدوام الجديد — والمحجوزة لا تُمس. إن كان وقت الإغلاق قبل الفتح
            (مثل 18:00 → 02:00) فيُعد دواماً يمتد لما بعد منتصف الليل.
          </div>
        </div>
      )}

      {slots && slots.length === 0 && (
        <div className="empty">
          <Qirtas mood="sleepy" size={96} />
          <b>لا فترات قادمة</b>
          <p>حدد أيام دوامك أعلاه واحفظ لتتولد الفترات ويتمكن العملاء من الحجز</p>
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
