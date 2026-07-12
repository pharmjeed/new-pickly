"use client";

/**
 * خريطة مواقف الفرع للعميل (Leaflet + OpenStreetMap):
 * تعرض النقاط التي ثبتها المطعم — والموقف المختار مميز ليتوجه العميل إليه
 * مباشرة (نمط أوبر: النقطة محددة سلفاً والمتوجه يقصدها).
 */
import { useEffect, useRef } from "react";
import type { LayerGroup, Map as LeafletMap } from "leaflet";
import "leaflet/dist/leaflet.css";

export type CustomerSpot = { id: string; label: string; lat: number | null; lng: number | null };

/** دبوس بنمط الهوية — divIcon بلا أصول صور */
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

export default function SpotsMap({ spots, chosenId }: { spots: CustomerSpot[]; chosenId: string | null }) {
  const holder = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const layerRef = useRef<LayerGroup | null>(null);

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
        mapRef.current = L.map(holder.current, { zoomControl: false });
        L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        }).addTo(mapRef.current);
        layerRef.current = L.layerGroup().addTo(mapRef.current);
      }
      const layer = layerRef.current;
      if (!layer) return;
      layer.clearLayers();
      for (const p of pts) {
        L.marker([p.lat, p.lng], {
          icon: L.divIcon({ html: pinHtml(p.label, p.id === chosenId), className: "", iconSize: [0, 0] })
        }).addTo(layer);
      }
      const chosen = pts.find((p) => p.id === chosenId);
      if (chosen) {
        mapRef.current.setView([chosen.lat, chosen.lng], 18);
      } else {
        mapRef.current.fitBounds(
          L.latLngBounds(pts.map((p) => [p.lat, p.lng] as [number, number])).pad(0.35),
          { maxZoom: 18 }
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [spots, chosenId]);

  useEffect(
    () => () => {
      mapRef.current?.remove();
      mapRef.current = null;
      layerRef.current = null;
    },
    []
  );

  if (!spots.some((s) => s.lat !== null && s.lng !== null)) return null;
  return (
    <div
      ref={holder}
      data-testid="customer-spots-map"
      style={{ height: 220, borderRadius: 16, overflow: "hidden", marginBottom: 12, border: "1px solid var(--pk-border)" }}
    />
  );
}
