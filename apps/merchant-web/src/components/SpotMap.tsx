"use client";

/**
 * خريطة تثبيت مواقف الاستلام (Leaflet + OpenStreetMap — بلا مفاتيح):
 * نقرة على الخريطة = نقطة موقف جديدة (draft) يسميها التاجر ثم يضيفها،
 * واختيار موقف موجود ثم نقرة = تحريك نقطته. العميل يتوجه لهذه النقطة مباشرة.
 */
import { useEffect, useRef } from "react";
import type { LayerGroup, Map as LeafletMap } from "leaflet";
import "leaflet/dist/leaflet.css";

export type MapSpot = {
  id: string;
  label: string;
  lat: number | null;
  lng: number | null;
  is_active: boolean;
};

type Props = {
  center: { lat: number; lng: number };
  spots: MapSpot[];
  /** موقف محدد للتحريك — نقرة الخريطة تنقله بدل إنشاء draft */
  selectedId: string | null;
  /** نقطة الموقف الجديد قبل الحفظ */
  draft: { lat: number; lng: number } | null;
  onMapClick: (lat: number, lng: number) => void;
};

/** دبوس ليموني بنمط الهوية — divIcon بلا أصول صور (مشكلة أيقونات Leaflet الافتراضية) */
function pinHtml(label: string, kind: "active" | "inactive" | "selected" | "draft"): string {
  const bg =
    kind === "draft" ? "#10241B" : kind === "inactive" ? "#9aa39e" : kind === "selected" ? "#10241B" : "#C9F339";
  const fg = kind === "active" ? "#10241B" : "#C9F339";
  const ring = kind === "selected" || kind === "draft" ? "box-shadow:0 0 0 3px #C9F339;" : "";
  return `<div style="transform:translate(-50%,-100%);display:flex;flex-direction:column;align-items:center;">
    <div style="background:${bg};color:${fg};${ring}border-radius:10px;padding:3px 9px;font-weight:800;font-size:12px;white-space:nowrap;font-family:inherit;">${label}</div>
    <div style="width:2px;height:8px;background:${bg};"></div>
    <div style="width:8px;height:8px;border-radius:50%;background:${bg};margin-top:-2px;"></div>
  </div>`;
}

export default function SpotMap({ center, spots, selectedId, draft, onMapClick }: Props) {
  const holder = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const layerRef = useRef<LayerGroup | null>(null);
  const clickRef = useRef(onMapClick);
  clickRef.current = onMapClick;

  // تهيئة الخريطة مرة واحدة
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const L = await import("leaflet");
      if (cancelled || !holder.current || mapRef.current) return;
      const map = L.map(holder.current, { zoomControl: true }).setView([center.lat, center.lng], 18);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
      }).addTo(map);
      map.on("click", (e) => clickRef.current(e.latlng.lat, e.latlng.lng));
      mapRef.current = map;
      layerRef.current = L.layerGroup().addTo(map);
    })();
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
    // مركز الفرع ثابت لعمر المكوّن — التهيئة مرة واحدة
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // إعادة رسم الدبابيس عند تغير المواقف/التحديد/الـdraft
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const L = await import("leaflet");
      if (cancelled || !layerRef.current) return;
      layerRef.current.clearLayers();
      for (const s of spots) {
        if (s.lat === null || s.lng === null) continue;
        const kind = s.id === selectedId ? "selected" : s.is_active ? "active" : "inactive";
        L.marker([s.lat, s.lng], {
          icon: L.divIcon({ html: pinHtml(s.label, kind), className: "", iconSize: [0, 0] })
        }).addTo(layerRef.current);
      }
      if (draft) {
        L.marker([draft.lat, draft.lng], {
          icon: L.divIcon({ html: pinHtml("الموقف الجديد", "draft"), className: "", iconSize: [0, 0] })
        }).addTo(layerRef.current);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [spots, selectedId, draft]);

  return (
    <div
      ref={holder}
      data-testid="spot-map"
      style={{ height: 260, borderRadius: 12, overflow: "hidden", border: "1px solid var(--m-line, #e5e7e3)" }}
    />
  );
}
