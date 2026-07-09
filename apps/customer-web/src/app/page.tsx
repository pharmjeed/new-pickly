"use client";

/** P3 (مصغرة للشريحة): الفروع القريبة — الرياض افتراضياً مع محاولة تحديد الموقع */
import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";

interface BranchCard {
  id: string;
  brand_name_ar: string;
  status: string;
  distance_meters: number | null;
  eta_minutes: number | null;
  address_short: string;
  busy_message: string | null;
}

const RIYADH = { lat: 24.7, lng: 46.68 };

export default function HomePage() {
  const [branches, setBranches] = useState<BranchCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = (lat: number, lng: number) =>
      api<BranchCard[]>("GET", `/v1/branches/nearby?lat=${lat}&lng=${lng}&radius=30000`)
        .then(setBranches)
        .catch((e: Error) => setError(e.message));

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => load(pos.coords.latitude, pos.coords.longitude),
        () => load(RIYADH.lat, RIYADH.lng), // الموقع ميزة تحسين لا شرط (docs/14§8)
        { timeout: 3000 }
      );
    } else {
      void load(RIYADH.lat, RIYADH.lng);
    }
  }, []);

  return (
    <main className="pk-wrap">
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div>
          <h1 className="pk-display" style={{ fontSize: "var(--pk-fs-24)" }}>بيكلي</h1>
          <p className="pk-muted">خلّك في سيارتك — طلبك يجيك.</p>
        </div>
        <Link href="/auth" className="pk-chip" data-testid="nav-auth">حسابي</Link>
      </header>

      {error && <div className="pk-card" style={{ color: "var(--pk-error)" }}>{error}</div>}
      {!branches && !error && <div className="pk-loader" aria-label="جارٍ التحميل"><span /><span /><span /></div>}

      {branches?.map((b) => (
        <Link key={b.id} href={`/r/${b.id}`} style={{ textDecoration: "none", color: "inherit" }}>
          <div className="pk-card" data-testid="branch-card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <strong className="pk-display" style={{ fontSize: "var(--pk-fs-17)" }}>{b.brand_name_ar}</strong>
              {b.status === "open" ? (
                <span className="pk-badge ok">مفتوح</span>
              ) : b.status === "busy" ? (
                <span className="pk-badge warn">ازدحام</span>
              ) : (
                <span className="pk-badge err">مغلق</span>
              )}
            </div>
            <p className="pk-muted">{b.address_short}</p>
            <p className="pk-muted">
              {b.distance_meters !== null && <>يبعد {(b.distance_meters / 1000).toFixed(1)} كم · </>}
              {b.eta_minutes !== null && <>{b.eta_minutes} دقيقة بالسيارة</>}
            </p>
            {b.busy_message && <p style={{ color: "var(--pk-warn)", fontSize: "var(--pk-fs-13)" }}>{b.busy_message}</p>}
          </div>
        </Link>
      ))}
    </main>
  );
}
