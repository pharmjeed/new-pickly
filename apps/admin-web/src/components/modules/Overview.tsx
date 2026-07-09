"use client";

/**
 * A-01: نظرة عامة — GET /api/v1/admin/overview → بلاطات KPI (design/admin/panel.html A-01)
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, apiGet } from "@/lib/api";

type OverviewData = {
  merchants: number;
  pending_merchants: number;
  orders_today: number;
  active_orders: number;
  refunds_pending: number;
  dead_letters: number;
  unprocessed_webhooks: number;
};

const TILES: readonly { key: keyof OverviewData; label: string; alert?: boolean }[] = [
  { key: "merchants", label: "تجار نشطون" },
  { key: "pending_merchants", label: "بانتظار الاعتماد" },
  { key: "orders_today", label: "طلبات اليوم" },
  { key: "active_orders", label: "طلبات نشطة الآن" },
  { key: "refunds_pending", label: "استرجاعات بانتظار قرار", alert: true },
  { key: "dead_letters", label: "Dead Letters", alert: true },
  { key: "unprocessed_webhooks", label: "Webhooks غير معالجة", alert: true }
];

export default function Overview() {
  const router = useRouter();
  const [data, setData] = useState<OverviewData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<OverviewData>("/api/v1/admin/overview")
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
      <div className="note err" data-testid="overview-error">
        {error}
      </div>
    );
  }
  if (!data) return <div className="skl" style={{ height: 180 }} />;

  return (
    <>
      <div className="kpis" data-testid="overview-tiles">
        {TILES.map((t) => {
          const v = data[t.key];
          return (
            <div key={t.key} className="kpi" data-testid="admin-stat" data-stat={t.key}>
              <div className="k">{t.label}</div>
              <div className="v">{v.toLocaleString("en")}</div>
              {t.alert && (
                <div className={`d ${v > 0 ? "dn" : "up"}`}>{v > 0 ? "يحتاج انتباه" : "لا شيء عالق ✓"}</div>
              )}
            </div>
          );
        })}
      </div>
      <div className="note soft">
        بلاطات النظرة العامة تُقرأ مباشرة من قاعدة التشغيل — التفاصيل داخل وحدات اللوحة (الاسترجاعات، الصحة…).
      </div>
    </>
  );
}
