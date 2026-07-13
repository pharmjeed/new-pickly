"use client";

/**
 * خريطة نقطة الالتقاء للعميل (Leaflet + OpenStreetMap) — ملاحة داخل التطبيق:
 * تعرض نقطة الفرع 🏁 وموقع العميل الحيّ (نقطة زرقاء)، وترسم **مسار الطريق الحقيقي**
 * بينهما (يتبع الشوارع عبر OSRM) مع المسافة والوقت المقدّر — فلا يحتاج العميل مغادرة
 * التطبيق. إن تعذّر جلب المسار نرجع لخط مستقيم + مسافة هوائية. تؤطّر تلقائياً حتى
 * يلمس الخريطة ثم تتركه يستكشف بحرية.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { LayerGroup, Map as LeafletMap, Marker, Polyline } from "leaflet";
import "leaflet/dist/leaflet.css";

export type CustomerSpot = { id: string; label: string; lat: number | null; lng: number | null };

/** مسافة القوس الكبير بالأمتار (haversine) — للبديل الهوائي وبوابة القرب */
function distMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6_371_000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const la1 = (aLat * Math.PI) / 180;
  const la2 = (bLat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

/** صياغة عربية مختصرة للمسافة — أمتار حتى الكيلومتر ثم كسر عشري */
function fmtDist(m: number): string {
  return m < 1000 ? `${m} م` : `${(m / 1000).toFixed(1)} كم`;
}
/** صياغة الزمن المقدّر — دقائق (دقيقة كحد أدنى) */
function fmtDur(s: number): string {
  return `~${Math.max(1, Math.round(s / 60))} د`;
}

/** دبوس نقطة الفرع بنمط الهوية — divIcon بلا أصول صور */
function pinHtml(label: string, chosen: boolean): string {
  const bg = chosen ? "#10241B" : "#C9F339";
  const fg = chosen ? "#C9F339" : "#10241B";
  const ring = chosen ? "box-shadow:0 0 0 3px #C9F339;" : "";
  return `<div style="transform:translate(-50%,-100%);display:flex;flex-direction:column;align-items:center;">
    <div style="background:${bg};color:${fg};${ring}border-radius:10px;padding:3px 9px;font-weight:800;font-size:12px;white-space:nowrap;font-family:inherit;">${chosen ? "🏁 " : ""}${label}</div>
    <div style="width:2px;height:8px;background:${bg};"></div>
    <div style="width:8px;height:8px;border-radius:50%;background:${bg};margin-top:-2px;"></div>
  </div>`;
}

/** نقطة موقع العميل الحيّة — قرص أزرق بهالة، كنمط خرائط الملاحة */
function meHtml(): string {
  return `<div style="transform:translate(-50%,-50%);position:relative;width:0;height:0;">
    <div style="position:absolute;left:0;top:0;transform:translate(-50%,-50%);width:34px;height:34px;border-radius:50%;background:rgba(37,99,235,.18);"></div>
    <div style="position:absolute;left:0;top:0;transform:translate(-50%,-50%);width:16px;height:16px;border-radius:50%;background:#2563EB;box-shadow:0 0 0 3px #fff,0 1px 4px rgba(0,0,0,.45);"></div>
  </div>`;
}

type RouteInfo = { distanceM: number; durationS: number };

export default function SpotsMap({
  spots,
  chosenId,
  me,
  radiusM
}: {
  spots: CustomerSpot[];
  chosenId: string | null;
  me: { lat: number; lng: number } | null;
  /** نصف قطر الوصول — عند دخوله تتحوّل الشارة إلى «وصلت إلى نقطة الالتقاء» */
  radiusM?: number;
}) {
  const holder = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const layerRef = useRef<LayerGroup | null>(null);
  const meRef = useRef<Marker | null>(null);
  const lineRef = useRef<Polyline | null>(null); // خط مستقيم بديل قبل وصول المسار
  const routeRef = useRef<Polyline | null>(null); // مسار الطريق الحقيقي (OSRM)
  // بمجرد أن يسحب العميل الخريطة أو يكبّرها نتوقف عن إعادة التأطير — لا نعاند حركته
  const userMovedRef = useRef(false);
  const sigRef = useRef<string>("");
  // ضبط إعادة جلب المسار: هدفه ونقطة انطلاقه — لا نعيد الجلب إلا عند تغيّر الهدف أو تحرّك >200م
  const routeMetaRef = useRef<{ targetId: string; oLat: number; oLng: number } | null>(null);
  const fetchingRef = useRef(false);
  const routeReqIdRef = useRef(0);
  const mountedRef = useRef(true);

  const [distM, setDistM] = useState<number | null>(null);
  const [route, setRoute] = useState<RouteInfo | null>(null);

  // نقطة الالتقاء الفعلية: المختارة إن وُجدت وإلا أول نقطة فرع بإحداثيات
  const targetPoint = useMemo(() => {
    const pts = spots.filter((s) => s.lat !== null && s.lng !== null) as Array<
      CustomerSpot & { lat: number; lng: number }
    >;
    return pts.find((p) => p.id === chosenId) ?? pts[0] ?? null;
  }, [spots, chosenId]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // الخريطة + دبابيس الفرع + علامة العميل + خط بديل مستقيم + المسافة الهوائية الحيّة
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const L = await import("leaflet");
      if (cancelled || !holder.current) return;
      const pts = spots.filter((s) => s.lat !== null && s.lng !== null) as Array<
        CustomerSpot & { lat: number; lng: number }
      >;
      if (pts.length === 0) return;

      if (!mapRef.current) {
        mapRef.current = L.map(holder.current, { zoomControl: true, scrollWheelZoom: false });
        L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        }).addTo(mapRef.current);
        layerRef.current = L.layerGroup().addTo(mapRef.current);
        mapRef.current.on("dragstart zoomstart", () => {
          userMovedRef.current = true;
        });
      }
      const map = mapRef.current;
      const layer = layerRef.current;
      if (!layer) return;

      layer.clearLayers();
      for (const p of pts) {
        L.marker([p.lat, p.lng], {
          icon: L.divIcon({ html: pinHtml(p.label, p.id === chosenId), className: "", iconSize: [0, 0] })
        }).addTo(layer);
      }

      if (me) {
        if (meRef.current) meRef.current.setLatLng([me.lat, me.lng]);
        else
          meRef.current = L.marker([me.lat, me.lng], {
            icon: L.divIcon({ html: meHtml(), className: "", iconSize: [0, 0] }),
            interactive: false,
            zIndexOffset: 1000
          }).addTo(map);
      } else if (meRef.current) {
        meRef.current.remove();
        meRef.current = null;
      }

      if (me && targetPoint) {
        setDistM(distMeters(me.lat, me.lng, targetPoint.lat, targetPoint.lng));
        // خط مستقيم فوري فقط ما دام مسار الطريق لم يصل بعد
        if (routeRef.current) {
          if (lineRef.current) {
            lineRef.current.remove();
            lineRef.current = null;
          }
        } else {
          const path: Array<[number, number]> = [
            [me.lat, me.lng],
            [targetPoint.lat, targetPoint.lng]
          ];
          if (lineRef.current) lineRef.current.setLatLngs(path);
          else
            lineRef.current = L.polyline(path, {
              color: "#10241B",
              weight: 3,
              opacity: 0.55,
              dashArray: "2 8",
              lineCap: "round"
            }).addTo(map);
        }
      } else {
        setDistM(null);
        setRoute(null);
        routeMetaRef.current = null;
        for (const r of [lineRef, routeRef]) {
          if (r.current) {
            r.current.remove();
            r.current = null;
          }
        }
      }

      // تأطير أولي للنقاط + الموقع — مرة عند ظهورها، ونحترم سحب العميل بعدها
      const sig = `${chosenId ?? ""}|${me ? "me" : "no"}`;
      if (!userMovedRef.current && sig !== sigRef.current) {
        sigRef.current = sig;
        const framePts: Array<[number, number]> = pts.map((p) => [p.lat, p.lng]);
        if (me) framePts.push([me.lat, me.lng]);
        if (framePts.length === 1) map.setView(framePts[0]!, 18);
        else map.fitBounds(L.latLngBounds(framePts).pad(0.3), { maxZoom: 17 });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [spots, chosenId, me, targetPoint]);

  // مسار الطريق الحقيقي عبر OSRM — يتبع الشوارع، مع المسافة والزمن المقدّر (داخل التطبيق)
  useEffect(() => {
    if (!me || !targetPoint || !mapRef.current) return;
    const meta = routeMetaRef.current;
    // لدينا مسار حديث لنفس الهدف من قريب (<200م) → لا نعيد الجلب
    if (meta && meta.targetId === targetPoint.id && routeRef.current && distMeters(me.lat, me.lng, meta.oLat, meta.oLng) < 200) return;
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    const reqId = ++routeReqIdRef.current;
    const oLat = me.lat;
    const oLng = me.lng;
    const t = targetPoint;
    void (async () => {
      try {
        const L = await import("leaflet");
        const url = `https://router.project-osrm.org/route/v1/driving/${oLng},${oLat};${t.lng},${t.lat}?overview=full&geometries=geojson`;
        const j = (await fetch(url).then((r) => r.json())) as {
          routes?: Array<{ distance: number; duration: number; geometry: { coordinates: [number, number][] } }>;
        };
        if (!mountedRef.current || reqId !== routeReqIdRef.current || !mapRef.current) return;
        const rt = j.routes?.[0];
        if (!rt) return;
        const latlngs = rt.geometry.coordinates.map(([lng, lat]) => [lat, lng] as [number, number]);
        const firstDraw = !routeRef.current;
        if (routeRef.current) routeRef.current.setLatLngs(latlngs);
        else
          routeRef.current = L.polyline(latlngs, {
            color: "#10241B",
            weight: 5,
            opacity: 0.85,
            lineCap: "round",
            lineJoin: "round"
          }).addTo(mapRef.current);
        if (lineRef.current) {
          lineRef.current.remove();
          lineRef.current = null;
        }
        routeMetaRef.current = { targetId: t.id, oLat, oLng };
        setRoute({ distanceM: Math.round(rt.distance), durationS: Math.round(rt.duration) });
        // نؤطّر على المسار مرة واحدة عند أول رسم لهذا الهدف — لا نلاحق العميل بعدها
        if (firstDraw && !userMovedRef.current) {
          mapRef.current.fitBounds(routeRef.current.getBounds().pad(0.2), { maxZoom: 17 });
        }
      } catch {
        /* تعذّر المسار — يبقى الخط المستقيم + المسافة الهوائية */
      } finally {
        fetchingRef.current = false;
      }
    })();
  }, [me, targetPoint]);

  useEffect(
    () => () => {
      mapRef.current?.remove();
      mapRef.current = null;
      layerRef.current = null;
      meRef.current = null;
      lineRef.current = null;
      routeRef.current = null;
    },
    []
  );

  if (!spots.some((s) => s.lat !== null && s.lng !== null)) return null;

  const atPoint = distM !== null && radiusM != null && distM <= radiusM;
  const badge = atPoint
    ? "✓ وصلت إلى نقطة الالتقاء"
    : route
      ? `الطريق ${fmtDist(route.distanceM)} · ${fmtDur(route.durationS)}`
      : distM !== null
        ? `تبعد ${fmtDist(distM)} عن نقطة الالتقاء`
        : null;

  return (
    <div style={{ position: "relative", marginBottom: 12 }}>
      <div
        ref={holder}
        data-testid="customer-spots-map"
        style={{ height: 240, borderRadius: 16, overflow: "hidden", border: "1px solid var(--pk-border)" }}
      />
      {badge && (
        <div
          data-testid="map-distance"
          data-arrived={atPoint ? "1" : undefined}
          style={{
            position: "absolute",
            top: 10,
            insetInlineStart: 10,
            zIndex: 500,
            background: atPoint ? "#C9F339" : "#10241B",
            color: atPoint ? "#10241B" : "#C9F339",
            borderRadius: 999,
            padding: "5px 12px",
            fontSize: 13,
            fontWeight: 800,
            boxShadow: "0 2px 8px rgba(0,0,0,.25)",
            pointerEvents: "none"
          }}
        >
          {badge}
        </div>
      )}
    </div>
  );
}
