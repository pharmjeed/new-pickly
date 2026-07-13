"use client";

/**
 * خريطة نقطة الالتقاء للعميل (Leaflet + OpenStreetMap) — ملاحة داخل التطبيق:
 * تعرض نقطة الالتقاء 🏁 (موقف مثبّت من الفرع إن وُجد، وإلا موقع الفرع) وموقع العميل
 * الحيّ (نقطة زرقاء)، وترسم **مسار الطريق الحقيقي** بينهما (يتبع الشوارع عبر OSRM)
 * مع المسافة والوقت المقدّر — فلا يحتاج العميل مغادرة التطبيق. إن تعذّر جلب المسار
 * نرجع لخط مستقيم + مسافة هوائية. تؤطّر تلقائياً حتى يلمس الخريطة ثم تتركه يستكشف.
 */
import { useEffect, useRef, useState } from "react";
import type { Map as LeafletMap, Marker, Polyline } from "leaflet";
import "leaflet/dist/leaflet.css";

export type MeetingTarget = { lat: number; lng: number; label: string };

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

/** دبوس نقطة الالتقاء بنمط الهوية — divIcon بلا أصول صور */
function pinHtml(label: string): string {
  return `<div style="transform:translate(-50%,-100%);display:flex;flex-direction:column;align-items:center;">
    <div style="background:#10241B;color:#C9F339;box-shadow:0 0 0 3px #C9F339;border-radius:10px;padding:3px 9px;font-weight:800;font-size:12px;white-space:nowrap;font-family:inherit;">🏁 ${label}</div>
    <div style="width:2px;height:8px;background:#10241B;"></div>
    <div style="width:8px;height:8px;border-radius:50%;background:#10241B;margin-top:-2px;"></div>
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
  target,
  me,
  radiusM
}: {
  /** نقطة الالتقاء المضمونة — موقف مثبّت أو موقع الفرع */
  target: MeetingTarget;
  me: { lat: number; lng: number } | null;
  /** نصف قطر الوصول — عند دخوله تتحوّل الشارة إلى «وصلت إلى نقطة الالتقاء» */
  radiusM?: number;
}) {
  const holder = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const pinRef = useRef<Marker | null>(null);
  const meRef = useRef<Marker | null>(null);
  const lineRef = useRef<Polyline | null>(null); // خط مستقيم بديل قبل وصول المسار
  const routeRef = useRef<Polyline | null>(null); // مسار الطريق الحقيقي (OSRM)
  const userMovedRef = useRef(false);
  const sigRef = useRef<string>("");
  const routeMetaRef = useRef<{ key: string; oLat: number; oLng: number } | null>(null);
  const fetchingRef = useRef(false);
  const routeReqIdRef = useRef(0);
  const mountedRef = useRef(true);

  const [distM, setDistM] = useState<number | null>(null);
  const [route, setRoute] = useState<RouteInfo | null>(null);

  const tLat = target.lat;
  const tLng = target.lng;
  const tKey = `${tLat},${tLng}`;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // الخريطة + دبوس نقطة الالتقاء + علامة العميل + خط بديل مستقيم + المسافة الهوائية الحيّة
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const L = await import("leaflet");
      if (cancelled || !holder.current) return;

      if (!mapRef.current) {
        mapRef.current = L.map(holder.current, { zoomControl: true, scrollWheelZoom: false }).setView([tLat, tLng], 15);
        L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        }).addTo(mapRef.current);
      }
      const map = mapRef.current;

      // دبوس نقطة الالتقاء
      if (pinRef.current) pinRef.current.setLatLng([tLat, tLng]);
      else
        pinRef.current = L.marker([tLat, tLng], {
          icon: L.divIcon({ html: pinHtml(target.label), className: "", iconSize: [0, 0] })
        }).addTo(map);

      // علامة العميل الحيّة
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

      if (me) {
        setDistM(distMeters(me.lat, me.lng, tLat, tLng));
        // خط مستقيم فوري فقط ما دام مسار الطريق لم يصل بعد
        if (routeRef.current) {
          if (lineRef.current) {
            lineRef.current.remove();
            lineRef.current = null;
          }
        } else {
          const path: Array<[number, number]> = [
            [me.lat, me.lng],
            [tLat, tLng]
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
      }

      // تأطير أولي — الهدف وحده، أو الهدف + موقع العميل عند توفّره
      const sig = `${tKey}|${me ? "me" : "no"}`;
      if (!userMovedRef.current && sig !== sigRef.current) {
        sigRef.current = sig;
        if (me) {
          map.fitBounds(
            L.latLngBounds([
              [tLat, tLng],
              [me.lat, me.lng]
            ]).pad(0.3),
            { maxZoom: 17 }
          );
        } else {
          map.setView([tLat, tLng], 16);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tLat, tLng, tKey, target.label, me]);

  // مسار الطريق الحقيقي عبر OSRM — يتبع الشوارع، مع المسافة والزمن المقدّر (داخل التطبيق)
  useEffect(() => {
    if (!me || !mapRef.current) return;
    const meta = routeMetaRef.current;
    if (meta && meta.key === tKey && routeRef.current && distMeters(me.lat, me.lng, meta.oLat, meta.oLng) < 200) return;
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    const reqId = ++routeReqIdRef.current;
    const oLat = me.lat;
    const oLng = me.lng;
    void (async () => {
      try {
        const L = await import("leaflet");
        // محرك المسارات الذاتي (OSRM على السيرفر) عبر بروكسي /osrm — نفس الأصل
        const url = `/osrm/route/v1/driving/${oLng},${oLat};${tLng},${tLat}?overview=full&geometries=geojson`;
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
        routeMetaRef.current = { key: tKey, oLat, oLng };
        setRoute({ distanceM: Math.round(rt.distance), durationS: Math.round(rt.duration) });
        if (firstDraw && !userMovedRef.current) {
          mapRef.current.fitBounds(routeRef.current.getBounds().pad(0.2), { maxZoom: 17 });
        }
      } catch {
        /* تعذّر المسار — يبقى الخط المستقيم + المسافة الهوائية */
      } finally {
        fetchingRef.current = false;
      }
    })();
  }, [me, tKey, tLat, tLng]);

  useEffect(
    () => () => {
      mapRef.current?.remove();
      mapRef.current = null;
      pinRef.current = null;
      meRef.current = null;
      lineRef.current = null;
      routeRef.current = null;
    },
    []
  );

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
