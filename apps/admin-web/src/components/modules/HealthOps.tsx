"use client";

/**
 * A-26: صحة النظام — GET /api/v1/admin/health-ops:
 * jobs_pending/failed، dead_letters بأخطائها، recent_events.
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, apiGet, shortDateTime } from "@/lib/api";

type HealthData = {
  jobs_pending: number;
  jobs_failed: number;
  dead_letters: { id: string; job_type: string; error: string; moved_at: string }[];
  recent_events: { name: string; at: string }[];
};

export default function HealthOps() {
  const router = useRouter();
  const [data, setData] = useState<HealthData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<HealthData>("/api/v1/admin/health-ops")
      .then(setData)
      .catch((e: unknown) => {
        if (e instanceof ApiError && e.status === 401) {
          router.replace("/");
          return;
        }
        setError((e as Error).message);
      });
  }, [router]);

  if (error) {
    return (
      <div className="note err" data-testid="health-error">
        {error}
      </div>
    );
  }
  if (!data) return <div className="skl" style={{ height: 260 }} />;

  return (
    <>
      <div className="kpis" data-testid="health-tiles">
        <div className="kpi" data-testid="admin-stat" data-stat="jobs_pending">
          <div className="k">وظائف بالانتظار</div>
          <div className="v">{data.jobs_pending}</div>
        </div>
        <div className="kpi" data-testid="admin-stat" data-stat="jobs_failed">
          <div className="k">وظائف فاشلة</div>
          <div className="v">{data.jobs_failed}</div>
          <div className={`d ${data.jobs_failed > 0 ? "dn" : "up"}`}>
            {data.jobs_failed > 0 ? "تُعاد المحاولة آلياً" : "لا فشل ✓"}
          </div>
        </div>
        <div className="kpi" data-testid="admin-stat" data-stat="dead_letters">
          <div className="k">Dead Letters</div>
          <div className="v">{data.dead_letters.length}</div>
          <div className={`d ${data.dead_letters.length > 0 ? "dn" : "up"}`}>
            {data.dead_letters.length > 0 ? "يحتاج معالجة يدوية" : "الطابور نظيف ✓"}
          </div>
        </div>
      </div>

      <div className="pcardx" data-testid="dead-letters-card">
        <h3>Dead Letters — رسائل خرجت من إعادة المحاولة</h3>
        {data.dead_letters.length === 0 && <p className="muted">لا رسائل عالقة.</p>}
        {data.dead_letters.map((d) => (
          <div key={d.id} className="kv" data-testid="dead-letter-row">
            <span className="k">
              <span className="mono">{d.job_type}</span> · {shortDateTime(d.moved_at)}
            </span>
            <span className="v mono" style={{ color: "var(--pk-error)", fontSize: 11 }}>
              {d.error}
            </span>
          </div>
        ))}
      </div>

      <div className="pcardx" data-testid="recent-events-card">
        <h3>آخر الأحداث المعالجة</h3>
        {data.recent_events.length === 0 && <p className="muted">لا أحداث بعد.</p>}
        {data.recent_events.length > 0 && (
          <div className="tline">
            {data.recent_events.map((ev, i) => (
              <div key={i} className="ev ok" data-testid="recent-event">
                <div className="t">
                  <span className="mono">{ev.name}</span>
                </div>
                <div className="m">{shortDateTime(ev.at)}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
