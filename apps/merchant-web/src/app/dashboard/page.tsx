"use client";

/**
 * M-01: لوحة اليوم — أرقام تشغيلية حية من GET /api/v1/merchant/dashboard
 * الشكل: design/merchant/M-01.html + M-02.html (شبكة KPI + أداء الفروع)
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Shell from "@/components/Shell";
import {clearToken,  ApiError, apiGet, minSec, sar } from "@/lib/api";
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

const BRANCH_STATUS: Record<string, { label: string; cls: string }> = {
  open: { label: "مفتوح", cls: "b-ok" },
  busy: { label: "ازدحام", cls: "b-warn" },
  closed: { label: "مغلق", cls: "b-soft" }
};

export default function DashboardPage() {
  const router = useRouter();
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

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
