"use client";

/**
 * M-01: لوحة اليوم — أرقام تشغيلية حية من GET /api/v1/merchant/dashboard
 * الشكل: design/merchant/M-01.html + M-02.html (شبكة KPI + أداء الفروع)
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Shell from "@/components/Shell";
import SpotMap from "@/components/SpotMap";
import { clearToken, ApiError, apiDelete, apiGet, apiPatch, apiPost, minSec, sar } from "@/lib/api";
import s from "./dashboard.module.css";

type Dashboard = {
  today_orders: number;
  completed_orders: number;
  rejected_or_refunded: number;
  active_now: number;
  revenue_halalas: number;
  avg_service_seconds: number | null;
  branches: { id: string; name_ar: string; status: string }[];
};

/** M-03: الفرع بإعداداته — «متوسط وقت تجهيز الطلب» هو الوقت المتوقع المختوم على كل طلب مقبول */
type BranchSettings = {
  id: string;
  name_ar: string;
  branch_code: string;
  lat: number;
  lng: number;
  default_prep_minutes: number;
};

/** موقف استلام يخدمه الفرع — العميل يختار من هذه القائمة فقط ويتوجه لنقطته على الخريطة */
type ParkingSpot = { id: string; label: string; lat: number | null; lng: number | null; is_active: boolean };

const BRANCH_STATUS: Record<string, { label: string; cls: string }> = {
  open: { label: "مفتوح", cls: "b-ok" },
  busy: { label: "ازدحام", cls: "b-warn" },
  closed: { label: "مغلق", cls: "b-soft" }
};

export default function DashboardPage() {
  const router = useRouter();
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  // «متوسط وقت تجهيز الطلب» لكل فرع — تحرير مباشر (قرار المالك 2026-07-12)
  const [prepBranches, setPrepBranches] = useState<BranchSettings[] | null>(null);
  const [prepDraft, setPrepDraft] = useState<Record<string, number>>({});
  const [prepSaving, setPrepSaving] = useState<string | null>(null);
  const [prepSaved, setPrepSaved] = useState<string | null>(null);

  // مواقف الاستلام لكل فرع — العميل لا يرى إلا ما يُدار هنا
  const [spots, setSpots] = useState<Record<string, ParkingSpot[]>>({});
  const [spotDraft, setSpotDraft] = useState<Record<string, string>>({});
  const [spotBusy, setSpotBusy] = useState<string | null>(null);
  // نقطة الموقف الجديد على الخريطة (نقرة) + موقف محدد لتحريك نقطته
  const [pinDraft, setPinDraft] = useState<Record<string, { lat: number; lng: number } | null>>({});
  const [spotSelected, setSpotSelected] = useState<Record<string, string | null>>({});

  /** نقرة الخريطة: موقف محدد → تحريك نقطته؛ وإلا → نقطة الموقف الجديد */
  const onMapClick = async (branch_id: string, lat: number, lng: number) => {
    const sel = spotSelected[branch_id];
    if (sel) {
      setSpotBusy(sel);
      try {
        await apiPatch(`/api/v1/merchant/parking-spots/${sel}`, { lat, lng });
        setSpots((s) => ({
          ...s,
          [branch_id]: (s[branch_id] ?? []).map((p) => (p.id === sel ? { ...p, lat, lng } : p))
        }));
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setSpotBusy(null);
      }
      return;
    }
    setPinDraft((d) => ({ ...d, [branch_id]: { lat, lng } }));
  };

  useEffect(() => {
    apiGet<BranchSettings[]>("/api/v1/merchant/branches")
      .then((bs) => {
        setPrepBranches(bs);
        setPrepDraft(Object.fromEntries(bs.map((b) => [b.id, b.default_prep_minutes])));
        for (const b of bs) {
          apiGet<ParkingSpot[]>(`/api/v1/merchant/branches/${b.id}/parking-spots`)
            .then((list) => setSpots((s) => ({ ...s, [b.id]: list })))
            .catch(() => setSpots((s) => ({ ...s, [b.id]: [] })));
        }
      })
      .catch(() => setPrepBranches([]));
  }, []);

  const addSpot = async (branch_id: string) => {
    const label = (spotDraft[branch_id] ?? "").trim();
    if (!label) return;
    setSpotBusy(branch_id);
    try {
      const pin = pinDraft[branch_id] ?? null;
      const created = await apiPost<ParkingSpot>(`/api/v1/merchant/branches/${branch_id}/parking-spots`, {
        label,
        ...(pin ? { lat: pin.lat, lng: pin.lng } : {})
      });
      setSpots((s) => ({ ...s, [branch_id]: [...(s[branch_id] ?? []), created] }));
      setSpotDraft((d) => ({ ...d, [branch_id]: "" }));
      setPinDraft((d) => ({ ...d, [branch_id]: null }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSpotBusy(null);
    }
  };

  const toggleSpot = async (branch_id: string, spot: ParkingSpot) => {
    setSpotBusy(spot.id);
    try {
      await apiPatch(`/api/v1/merchant/parking-spots/${spot.id}`, { is_active: !spot.is_active });
      setSpots((s) => ({
        ...s,
        [branch_id]: (s[branch_id] ?? []).map((p) => (p.id === spot.id ? { ...p, is_active: !spot.is_active } : p))
      }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSpotBusy(null);
    }
  };

  const deleteSpot = async (branch_id: string, spot: ParkingSpot) => {
    setSpotBusy(spot.id);
    try {
      await apiDelete(`/api/v1/merchant/parking-spots/${spot.id}`);
      setSpots((s) => ({ ...s, [branch_id]: (s[branch_id] ?? []).filter((p) => p.id !== spot.id) }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSpotBusy(null);
    }
  };

  const savePrep = async (branch_id: string) => {
    const minutes = prepDraft[branch_id];
    if (!minutes || minutes < 1) return;
    setPrepSaving(branch_id);
    setPrepSaved(null);
    try {
      await apiPost(`/api/v1/merchant/branches/${branch_id}/prep-minutes`, { prep_minutes: minutes });
      setPrepBranches((bs) => bs?.map((b) => (b.id === branch_id ? { ...b, default_prep_minutes: minutes } : b)) ?? null);
      setPrepSaved(branch_id);
      setTimeout(() => setPrepSaved(null), 2500);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPrepSaving(null);
    }
  };

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const d = await apiGet<Dashboard>("/api/v1/merchant/dashboard");
        if (alive) {
          setData(d);
          setError(null);
        }
      } catch (e) {
        if (!alive) return;
        if (e instanceof ApiError && e.status === 401) {
          clearToken();
          router.replace("/");
          return;
        }
        setError((e as Error).message);
      }
    };
    void load();
    const t = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [router]);

  return (
    <Shell title="الرئيسية" crumb="لوحة اليوم — أرقام حية تتحدث كل 30 ثانية">
      {error && (
        <div className="note err" data-testid="dashboard-error">
          {error}
        </div>
      )}

      {!data && !error && (
        <div className="kpis">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="skl" style={{ height: 84 }} />
          ))}
        </div>
      )}

      {data && (
        <>
          <div className="kpis" data-testid="dashboard-kpis">
            <div className="kpi" data-testid="dashboard-stat">
              <div className="k">طلبات اليوم</div>
              <div className="v">{data.today_orders}</div>
            </div>
            <div className="kpi" data-testid="dashboard-stat">
              <div className="k">مكتملة</div>
              <div className="v">{data.completed_orders}</div>
              <div className="d up">تم التسليم</div>
            </div>
            <div className="kpi" data-testid="dashboard-stat">
              <div className="k">نشطة الآن</div>
              <div className="v">{data.active_now}</div>
              <div className="d">قيد التنفيذ</div>
            </div>
            <div className="kpi" data-testid="dashboard-stat">
              <div className="k">رفض / استرجاع</div>
              <div className="v">{data.rejected_or_refunded}</div>
              <div className={data.rejected_or_refunded > 0 ? "d dn" : "d up"}>اليوم</div>
            </div>
            <div className="kpi" data-testid="dashboard-stat">
              <div className="k">الإيراد</div>
              <div className="v">
                {sar(data.revenue_halalas)} <small>SAR</small>
              </div>
              <div className="d">طلبات مكتملة</div>
            </div>
            <div className="kpi" data-testid="dashboard-stat">
              <div className="k">متوسط زمن الخدمة</div>
              <div className="v">
                {data.avg_service_seconds !== null ? minSec(data.avg_service_seconds) : "—"} <small>د</small>
              </div>
              <div className="d">من الوصول حتى التسليم</div>
            </div>
          </div>

          <div className={s.grid2}>
            <div className="pcardx" data-testid="dashboard-branches">
              <h3>
                أداء الفروع
                <span className="sp muted" style={{ fontSize: 11 }}>
                  {data.branches.length} فرع
                </span>
              </h3>
              {data.branches.length === 0 ? (
                <div className="empty">
                  <div className="ic">🏪</div>
                  <b>لا فروع بعد</b>
                  <p>تُضاف الفروع عبر فريق نجاح التجار في نطاق الطيار</p>
                </div>
              ) : (
                data.branches.map((b) => {
                  const st = BRANCH_STATUS[b.status] ?? { label: b.status, cls: "b-soft" };
                  return (
                    <div key={b.id} className={s.branchRow} data-testid="dashboard-branch-row">
                      <span className={s.branchName}>{b.name_ar}</span>
                      <span className={`badge ${st.cls}`} style={{ fontSize: "10.5px" }}>
                        {st.label}
                      </span>
                    </div>
                  );
                })
              )}
            </div>

            {/* «متوسط وقت تجهيز الطلب» — يُختم على كل طلب عند قبوله ويظهر للعميل كوقت متوقع */}
            <div className="pcardx" data-testid="prep-minutes-card">
              <h3>متوسط وقت تجهيز الطلب</h3>
              <p className="muted" style={{ fontSize: 12, margin: "0 0 10px" }}>
                هذا الرقم يظهر للعميل كوقت متوقع فور قبول طلبه — حدّثه بحسب واقع مطبخك.
              </p>
              {!prepBranches && <div className="skl" style={{ height: 44 }} />}
              {prepBranches?.map((b) => (
                <div key={b.id} className="kv" data-testid="prep-minutes-row">
                  <span className="k">{b.name_ar}</span>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                    <input
                      type="number"
                      min={1}
                      max={120}
                      value={prepDraft[b.id] ?? b.default_prep_minutes}
                      onChange={(e) =>
                        setPrepDraft((d) => ({ ...d, [b.id]: Number(e.target.value) }))
                      }
                      data-testid="prep-minutes-input"
                      style={{ width: 64, padding: "4px 8px", textAlign: "center" }}
                    />
                    <span className="muted" style={{ fontSize: 12 }}>دقيقة</span>
                    <button
                      className="btn"
                      data-testid="prep-minutes-save"
                      disabled={prepSaving === b.id || (prepDraft[b.id] ?? b.default_prep_minutes) === b.default_prep_minutes}
                      onClick={() => void savePrep(b.id)}
                    >
                      {prepSaving === b.id ? "…" : prepSaved === b.id ? "✓ حُفظ" : "حفظ"}
                    </button>
                  </span>
                </div>
              ))}
            </div>

            {/* مواقف الاستلام أمام كل فرع — يختار العميل موقفه من هذه القائمة فقط */}
            <div className="pcardx" data-testid="parking-spots-card">
              <h3>مواقف الاستلام</h3>
              <p className="muted" style={{ fontSize: 12, margin: "0 0 10px" }}>
                حدّد المواقف التي يخدمها فرعك — العميل يختار موقفه منها فقط، فلا يقف في مكان
                لا يعرفه فريقك.
              </p>
              {!prepBranches && <div className="skl" style={{ height: 44 }} />}
              {prepBranches?.map((b) => (
                <div key={b.id} style={{ marginBottom: 18 }} data-testid="parking-spots-branch">
                  <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>{b.name_ar}</div>

                  {/* الخريطة: نقرة = نقطة موقف جديد · اختر موقفاً ثم انقر = تحريك نقطته */}
                  <SpotMap
                    center={{ lat: b.lat, lng: b.lng }}
                    spots={spots[b.id] ?? []}
                    selectedId={spotSelected[b.id] ?? null}
                    draft={pinDraft[b.id] ?? null}
                    onMapClick={(lat, lng) => void onMapClick(b.id, lat, lng)}
                  />
                  <p className="muted" style={{ fontSize: 11.5, margin: "6px 0 8px" }}>
                    {spotSelected[b.id]
                      ? "انقر على الخريطة لنقل نقطة الموقف المحدد — أو اضغط الموقف مجدداً لإلغاء التحديد."
                      : "انقر على الخريطة لتثبيت نقطة الموقف الجديد ثم سمّه وأضفه — العميل يتوجه لهذه النقطة مباشرة."}
                  </p>

                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                    {(spots[b.id] ?? []).length === 0 && (
                      <span className="muted" style={{ fontSize: 12 }}>
                        لا مواقف بعد — العميل سيصف مكانه نصياً
                      </span>
                    )}
                    {(spots[b.id] ?? []).map((p) => (
                      <span
                        key={p.id}
                        className="badge"
                        data-testid="parking-spot-chip"
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                          opacity: p.is_active ? 1 : 0.45,
                          outline: spotSelected[b.id] === p.id ? "2px solid var(--m-ink, #10241B)" : "none"
                        }}
                      >
                        <button
                          type="button"
                          title={p.lat !== null ? "منقّط على الخريطة — اضغط للتحديد ثم انقر الخريطة لنقله" : "بلا نقطة — اضغط للتحديد ثم انقر الخريطة لتثبيته"}
                          onClick={() =>
                            setSpotSelected((s) => ({ ...s, [b.id]: s[b.id] === p.id ? null : p.id }))
                          }
                          style={{ background: "none", border: "none", cursor: "pointer", padding: 0, font: "inherit", fontWeight: 700 }}
                        >
                          {p.lat !== null ? "📍" : "○"} {p.label}
                        </button>
                        <button
                          type="button"
                          title={p.is_active ? "إيقاف الموقف مؤقتاً" : "إعادة تفعيل الموقف"}
                          disabled={spotBusy === p.id}
                          onClick={() => void toggleSpot(b.id, p)}
                          style={{ background: "none", border: "none", cursor: "pointer", padding: 0 }}
                        >
                          {p.is_active ? "⏸" : "▶"}
                        </button>
                        <button
                          type="button"
                          title="حذف الموقف"
                          disabled={spotBusy === p.id}
                          onClick={() => void deleteSpot(b.id, p)}
                          style={{ background: "none", border: "none", cursor: "pointer", padding: 0, color: "var(--m-danger, #c0392b)" }}
                        >
                          ✕
                        </button>
                      </span>
                    ))}
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <input
                      value={spotDraft[b.id] ?? ""}
                      placeholder={pinDraft[b.id] ? "سمّ النقطة المثبتة — مثال: 6 أو «أمام المدخل»" : "مثال: 6 أو «أمام المدخل»"}
                      maxLength={40}
                      data-testid="parking-spot-input"
                      onChange={(e) => setSpotDraft((d) => ({ ...d, [b.id]: e.target.value }))}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void addSpot(b.id);
                      }}
                      style={{ flex: 1, padding: "4px 8px" }}
                    />
                    <button
                      className="btn"
                      data-testid="parking-spot-add"
                      disabled={spotBusy === b.id || !(spotDraft[b.id] ?? "").trim()}
                      onClick={() => void addSpot(b.id)}
                    >
                      {spotBusy === b.id ? "…" : pinDraft[b.id] ? "إضافة النقطة 📍" : "إضافة"}
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="pcardx">
              <h3>ملخص اليوم</h3>
              <div className="kv">
                <span className="k">نسبة الإكمال</span>
                <span className="v mono">
                  {data.today_orders > 0
                    ? `${Math.round((data.completed_orders / data.today_orders) * 100)}%`
                    : "—"}
                </span>
              </div>
              <div className="kv">
                <span className="k">متوسط قيمة الطلب</span>
                <span className="v mono">
                  {data.completed_orders > 0
                    ? `${sar(Math.round(data.revenue_halalas / data.completed_orders))} SAR`
                    : "—"}
                </span>
              </div>
              <div className="kv">
                <span className="k">طلبات نشطة الآن</span>
                <span className="v mono">{data.active_now}</span>
              </div>
            </div>
          </div>
        </>
      )}
    </Shell>
  );
}
