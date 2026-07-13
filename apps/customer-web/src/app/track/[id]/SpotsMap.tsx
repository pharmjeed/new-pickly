"use client";

/**
 * خريطة نقطة الالتقاء للعميل (Leaflet + OpenStreetMap) — تفاعلية داخل التطبيق:
 * تعرض نقطة الموقف التي ثبتها المطعم (🏁) وموقع العميل الحيّ (نقطة زرقاء) معاً،
 * فيرى نفسه ونقطته دون مغادرة التطبيق. تؤطّر الاثنين تلقائياً حتى يلمس العميل
 * الخريطة، ثم تتركه يستكشف بحرية (سحب + تكبير باللمس/الأزرار).
 */
import { useEffect, useRef } from "react";
import type { LayerGroup, Map as LeafletMap, Marker } from "leaflet";
import "leaflet/dist/leaflet.css";

export type CustomerSpot = { id: string; label: string; lat: number | null; lng: number | null };

/** دبوس نقطة المطعم بنمط الهوية — divIcon بلا أصول صور */
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

export default function SpotsMap({
  spots,
  chosenId,
  me
}: {
  spots: CustomerSpot[];
  chosenId: string | null;
  me: { lat: number; lng: number } | null;
}) {
  const holder = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const layerRef = useRef<LayerGroup | null>(null);
  const meRef = useRef<Marker | null>(null);
  // بمجرد أن يسحب العميل الخريطة أو يكبّرها نتوقف عن إعادة التأطير — لا نعاند حركته
  const userMovedRef = useRef(false);
  // توقيع مجموعة النقاط المؤطَّرة — نُعيد التأطير فقط عند تغيّر النقطة المختارة أو ظهور موقع العميل
  const sigRef = useRef<string>("");

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
        // scrollWheelZoom مطفأ كي لا يبتلع تمرير الصفحة؛ السحب واللمس والأزرار تبقى فعّالة
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

      // نقاط المطعم — النقطة المختارة مميزة 🏁
      layer.clearLayers();
      for (const p of pts) {
        L.marker([p.lat, p.lng], {
          icon: L.divIcon({ html: pinHtml(p.label, p.id === chosenId), className: "", iconSize: [0, 0] })
        }).addTo(layer);
      }

      // علامة العميل الحيّة — تُحرَّك في مكانها دون إعادة تأطير مزعج عند كل نبضة موقع
      if (me) {
        if (meRef.current) {
          meRef.current.setLatLng([me.lat, me.lng]);
        } else {
          meRef.current = L.marker([me.lat, me.lng], {
            icon: L.divIcon({ html: meHtml(), className: "", iconSize: [0, 0] }),
            interactive: false,
            zIndexOffset: 1000
          }).addTo(map);
        }
      } else if (meRef.current) {
        meRef.current.remove();
        meRef.current = null;
      }

      // تأطير الاثنين — مرة عند ظهور النقطة/الموقع، ونحترم سحب العميل بعدها
      const sig = `${chosenId ?? ""}|${me ? "me" : "no"}`;
      if (!userMovedRef.current && sig !== sigRef.current) {
        sigRef.current = sig;
        const framePts: Array<[number, number]> = pts.map((p) => [p.lat, p.lng]);
        if (me) framePts.push([me.lat, me.lng]);
        const chosen = pts.find((p) => p.id === chosenId);
        if (framePts.length === 1) {
          map.setView(framePts[0]!, 18);
        } else {
          map.fitBounds(L.latLngBounds(framePts).pad(0.3), { maxZoom: chosen && !me ? 18 : 17 });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [spots, chosenId, me]);

  useEffect(
    () => () => {
      mapRef.current?.remove();
      mapRef.current = null;
      layerRef.current = null;
      meRef.current = null;
    },
    []
  );

  if (!spots.some((s) => s.lat !== null && s.lng !== null)) return null;
  return (
    <div
      ref={holder}
      data-testid="customer-spots-map"
      style={{ height: 240, borderRadius: 16, overflow: "hidden", marginBottom: 12, border: "1px solid var(--pk-border)" }}
    />
  );
}
