"use client";

/**
 * وضع الملاحة الحيّة داخل التطبيق (نمط أوبر/كريم) — بلا مغادرة بيكلي:
 * خريطة ملء الشاشة تتبع العميل، شريط مناورة أعلى («انعطف يميناً بعد ٢٠٠م»)،
 * شريط سفلي بالوقت والمسافة المتبقية، توجيه صوتي عربي، وإعادة توجيه تلقائية
 * عند الخروج عن المسار. المسار والمناورات من OSRM (steps=true).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { Map as LeafletMap, Marker, Polyline } from "leaflet";
import "leaflet/dist/leaflet.css";

export type NavTarget = { lat: number; lng: number; label: string };

/** مسافة القوس الكبير بالأمتار (haversine) */
function hav(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6_371_000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const la1 = (aLat * Math.PI) / 180;
  const la2 = (bLat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const fmtDist = (m: number) => (m < 1000 ? `${Math.round(m / 10) * 10} م` : `${(m / 1000).toFixed(1)} كم`);
const fmtMin = (s: number) => `${Math.max(1, Math.round(s / 60))} د`;

type OsrmStep = {
  maneuver: { location: [number, number]; type: string; modifier?: string };
  name?: string;
  distance: number;
};

/** نص المناورة بالعربية من نوع/اتجاه OSRM + اسم الطريق */
function maneuverText(type: string, modifier: string | undefined, name: string | undefined): string {
  const road = name ? ` نحو ${name}` : "";
  const byMod: Record<string, string> = {
    left: "انعطف يساراً",
    right: "انعطف يميناً",
    "slight left": "مِل يساراً",
    "slight right": "مِل يميناً",
    "sharp left": "انعطف يساراً بحدّة",
    "sharp right": "انعطف يميناً بحدّة",
    straight: "استمر مستقيماً",
    uturn: "انعطف عائداً"
  };
  switch (type) {
    case "depart":
      return "انطلق";
    case "arrive":
      return "وصلت إلى نقطة الالتقاء";
    case "roundabout":
    case "rotary":
    case "roundabout turn":
      return `ادخل الدوار${road}`;
    case "merge":
      return `اندمج${road}`;
    case "on ramp":
      return `اسلك المدخل${road}`;
    case "off ramp":
      return `اسلك المخرج${road}`;
    case "fork":
      return `${modifier?.includes("left") ? "خذ التفرّع يساراً" : "خذ التفرّع يميناً"}${road}`;
    case "end of road":
      return `في نهاية الطريق ${modifier?.includes("left") ? "انعطف يساراً" : "انعطف يميناً"}${road}`;
    case "turn":
      return `${(modifier && byMod[modifier]) ?? "انعطف"}${road}`;
    case "new name":
    case "continue":
    default:
      return `${(modifier && byMod[modifier]) ?? "استمر"}${road}`;
  }
}

/** رمز سهم للمناورة في الشريط العلوي */
function maneuverArrow(type: string, modifier?: string): string {
  if (type === "arrive") return "🏁";
  if (type === "roundabout" || type === "rotary") return "⟳";
  if (type === "depart") return "↑";
  if (!modifier) return "↑";
  if (modifier.includes("uturn")) return "↩";
  if (modifier.includes("sharp left")) return "⬅";
  if (modifier.includes("sharp right")) return "➡";
  if (modifier.includes("slight left")) return "↖";
  if (modifier.includes("slight right")) return "↗";
  if (modifier.includes("left")) return "↰";
  if (modifier.includes("right")) return "↱";
  return "↑";
}

/** سهم موقع العميل موجّهاً لاتجاه سيره (heading) */
function meArrowHtml(heading: number): string {
  return `<div style="transform:translate(-50%,-50%) rotate(${heading}deg);">
    <svg width="34" height="34" viewBox="0 0 34 34">
      <circle cx="17" cy="17" r="16" fill="rgba(37,99,235,.18)"/>
      <path d="M17 4 L26 27 L17 21 L8 27 Z" fill="#2563EB" stroke="#fff" stroke-width="2" stroke-linejoin="round"/>
    </svg>
  </div>`;
}
function destPinHtml(label: string): string {
  return `<div style="transform:translate(-50%,-100%);display:flex;flex-direction:column;align-items:center;">
    <div style="background:#10241B;color:#C9F339;box-shadow:0 0 0 3px #C9F339;border-radius:10px;padding:3px 9px;font-weight:800;font-size:12px;white-space:nowrap;">🏁 ${label}</div>
    <div style="width:2px;height:8px;background:#10241B;"></div>
    <div style="width:9px;height:9px;border-radius:50%;background:#10241B;margin-top:-2px;"></div>
  </div>`;
}

type Pos = { lat: number; lng: number; heading: number | null };

export default function LiveNav({ target, onClose }: { target: NavTarget; onClose: () => void }) {
  const holder = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const meRef = useRef<Marker | null>(null);
  const routeRef = useRef<Polyline | null>(null);
  const geomRef = useRef<Array<[number, number]>>([]); // [lat,lng]
  const stepsRef = useRef<Array<{ loc: [number, number]; text: string; arrow: string }>>([]);
  const totalRef = useRef<{ m: number; s: number }>({ m: 0, s: 0 });
  const stepIdxRef = useRef(1);
  const followRef = useRef(true);
  const fetchingRef = useRef(false);
  const mountedRef = useRef(true);
  const spokenRef = useRef<Set<string>>(new Set());

  const [pos, setPos] = useState<Pos | null>(null);
  const [banner, setBanner] = useState<{ text: string; arrow: string; dist: number } | null>(null);
  const [remaining, setRemaining] = useState<{ m: number; s: number } | null>(null);
  const [follow, setFollow] = useState(true);
  const [muted, setMuted] = useState(false);
  const [arrived, setArrived] = useState(false);
  const [status, setStatus] = useState<"locating" | "routing" | "go" | "error">("locating");

  const mutedRef = useRef(false);
  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  const speak = useCallback((text: string) => {
    if (mutedRef.current || typeof window === "undefined" || !window.speechSynthesis) return;
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "ar-SA";
      u.rate = 1;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    } catch {
      /* لا صوت — لا نُفشل الملاحة */
    }
  }, []);

  // جلب المسار (OSRM بخطوات) من نقطة انطلاق للوجهة
  const fetchRoute = useCallback(
    async (fromLat: number, fromLng: number) => {
      if (fetchingRef.current) return;
      fetchingRef.current = true;
      try {
        const L = await import("leaflet");
        const url = `https://router.project-osrm.org/route/v1/driving/${fromLng},${fromLat};${target.lng},${target.lat}?overview=full&geometries=geojson&steps=true`;
        const j = (await fetch(url).then((r) => r.json())) as {
          routes?: Array<{
            distance: number;
            duration: number;
            geometry: { coordinates: [number, number][] };
            legs: Array<{ steps: OsrmStep[] }>;
          }>;
        };
        if (!mountedRef.current || !mapRef.current) return;
        const rt = j.routes?.[0];
        if (!rt) {
          setStatus("error");
          return;
        }
        const geom = rt.geometry.coordinates.map(([lng, lat]) => [lat, lng] as [number, number]);
        geomRef.current = geom;
        totalRef.current = { m: rt.distance, s: rt.duration };
        stepsRef.current = (rt.legs?.[0]?.steps ?? []).map((st) => ({
          loc: [st.maneuver.location[1], st.maneuver.location[0]] as [number, number],
          text: maneuverText(st.maneuver.type, st.maneuver.modifier, st.name),
          arrow: maneuverArrow(st.maneuver.type, st.maneuver.modifier)
        }));
        stepIdxRef.current = Math.min(1, stepsRef.current.length - 1);
        spokenRef.current.clear();
        if (routeRef.current) routeRef.current.setLatLngs(geom);
        else
          routeRef.current = L.polyline(geom, {
            color: "#2563EB",
            weight: 7,
            opacity: 0.9,
            lineCap: "round",
            lineJoin: "round"
          }).addTo(mapRef.current);
        setStatus("go");
        speak("ابدأ الملاحة");
      } catch {
        setStatus("error");
      } finally {
        fetchingRef.current = false;
      }
    },
    [target.lat, target.lng, speak]
  );

  // تهيئة الخريطة مرة واحدة + دبوس الوجهة
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const L = await import("leaflet");
      if (cancelled || !holder.current || mapRef.current) return;
      const map = L.map(holder.current, { zoomControl: false, attributionControl: false }).setView([target.lat, target.lng], 16);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(map);
      L.control.attribution({ prefix: false, position: "bottomleft" }).addAttribution("© OpenStreetMap").addTo(map);
      L.marker([target.lat, target.lng], {
        icon: L.divIcon({ html: destPinHtml(target.label), className: "", iconSize: [0, 0] })
      }).addTo(map);
      map.on("dragstart", () => {
        followRef.current = false;
        setFollow(false);
      });
      mapRef.current = map;
    })();
    return () => {
      cancelled = true;
    };
  }, [target.lat, target.lng, target.label]);

  // مراقبة الموقع الحيّة عالية الدقة
  useEffect(() => {
    mountedRef.current = true;
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setStatus("error");
      return;
    }
    const wid = navigator.geolocation.watchPosition(
      (p) => setPos({ lat: p.coords.latitude, lng: p.coords.longitude, heading: p.coords.heading ?? null }),
      () => setStatus((s) => (s === "locating" ? "error" : s)),
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 20_000 }
    );
    return () => {
      mountedRef.current = false;
      navigator.geolocation.clearWatch(wid);
      try {
        window.speechSynthesis?.cancel();
      } catch {
        /* تجاهل */
      }
    };
  }, []);

  // أول موقع → اجلب المسار
  useEffect(() => {
    if (pos && geomRef.current.length === 0 && status !== "routing") {
      setStatus("routing");
      void fetchRoute(pos.lat, pos.lng);
    }
  }, [pos, status, fetchRoute]);

  // كل تحديث موقع: حرّك السهم، اتبع الكاميرا، حدّث المتبقّي والمناورة والصوت وإعادة التوجيه
  useEffect(() => {
    if (!pos || !mapRef.current) return;
    void (async () => {
      const L = await import("leaflet");
      const map = mapRef.current;
      if (!map) return;

      // سهم العميل موجّهاً لاتجاه السير
      const heading = pos.heading ?? 0;
      const icon = L.divIcon({ html: meArrowHtml(heading), className: "", iconSize: [0, 0] });
      if (meRef.current) {
        meRef.current.setLatLng([pos.lat, pos.lng]);
        meRef.current.setIcon(icon);
      } else {
        meRef.current = L.marker([pos.lat, pos.lng], { icon, interactive: false, zIndexOffset: 1000 }).addTo(map);
      }
      if (followRef.current) map.setView([pos.lat, pos.lng], 17, { animate: true });

      const geom = geomRef.current;
      if (geom.length === 0) return;

      // أقرب رأس على المسار + المسافة المتبقية
      let nearIdx = 0;
      let nearD = Infinity;
      for (let i = 0; i < geom.length; i++) {
        const d = hav(pos.lat, pos.lng, geom[i]![0], geom[i]![1]);
        if (d < nearD) {
          nearD = d;
          nearIdx = i;
        }
      }
      let remM = hav(pos.lat, pos.lng, geom[nearIdx]![0], geom[nearIdx]![1]);
      for (let i = nearIdx; i < geom.length - 1; i++) remM += hav(geom[i]![0], geom[i]![1], geom[i + 1]![0], geom[i + 1]![1]);
      const total = totalRef.current;
      const remS = total.m > 0 ? (remM / total.m) * total.s : 0;
      setRemaining({ m: remM, s: remS });

      // الوصول
      if (remM < 30 || hav(pos.lat, pos.lng, target.lat, target.lng) < 25) {
        if (!arrived) {
          setArrived(true);
          setBanner({ text: "وصلت إلى نقطة الالتقاء", arrow: "🏁", dist: 0 });
          speak("وصلت إلى نقطة الالتقاء");
        }
        return;
      }

      // إعادة التوجيه إن ابتعد عن المسار
      if (nearD > 60 && !fetchingRef.current) {
        speak("جارٍ إعادة التوجيه");
        void fetchRoute(pos.lat, pos.lng);
        return;
      }

      // المناورة القادمة + مسافتها
      const steps = stepsRef.current;
      let idx = stepIdxRef.current;
      while (idx < steps.length - 1 && hav(pos.lat, pos.lng, steps[idx]!.loc[0], steps[idx]!.loc[1]) < 18) idx++;
      stepIdxRef.current = idx;
      const step = steps[idx];
      if (step) {
        const dToMan = hav(pos.lat, pos.lng, step.loc[0], step.loc[1]);
        setBanner({ text: step.text, arrow: step.arrow, dist: dToMan });
        // نداءات صوتية: تنبيه مسبق ثم عند الاقتراب
        const k2 = `${idx}:pre`;
        const k1 = `${idx}:now`;
        if (dToMan < 250 && dToMan > 60 && !spokenRef.current.has(k2)) {
          spokenRef.current.add(k2);
          speak(`بعد ${fmtDist(dToMan)}، ${step.text}`);
        }
        if (dToMan <= 60 && !spokenRef.current.has(k1)) {
          spokenRef.current.add(k1);
          speak(step.text);
        }
      }
    })();
  }, [pos, arrived, fetchRoute, speak, target.lat, target.lng]);

  useEffect(
    () => () => {
      mapRef.current?.remove();
      mapRef.current = null;
      meRef.current = null;
      routeRef.current = null;
    },
    []
  );

  const recenter = () => {
    followRef.current = true;
    setFollow(true);
    if (pos && mapRef.current) mapRef.current.setView([pos.lat, pos.lng], 17, { animate: true });
  };

  const etaClock =
    remaining && typeof window !== "undefined"
      ? new Date(Date.now() + remaining.s * 1000).toLocaleTimeString("ar-SA", { hour: "2-digit", minute: "2-digit" })
      : null;

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 3000, background: "#0b1a13", display: "flex", flexDirection: "column" }}>
      {/* شريط المناورة العلوي */}
      <div style={{ background: "#10241B", color: "#fff", padding: "14px 16px", display: "flex", alignItems: "center", gap: 14, boxShadow: "0 2px 12px rgba(0,0,0,.4)" }}>
        <div style={{ fontSize: 34, lineHeight: 1, color: "#C9F339", minWidth: 40, textAlign: "center" }}>
          {banner ? banner.arrow : "🧭"}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 18, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {status === "locating" ? "جارٍ تحديد موقعك…" : status === "routing" ? "جارٍ حساب الطريق…" : status === "error" ? "تعذّر تحديد الموقع أو الطريق" : banner?.text ?? "ابدأ القيادة"}
          </div>
          {banner && banner.dist > 0 && status === "go" && (
            <div style={{ color: "#C9F339", fontWeight: 700, fontSize: 14, marginTop: 2 }}>بعد {fmtDist(banner.dist)}</div>
          )}
        </div>
        <button type="button" onClick={() => setMuted((m) => !m)} aria-label={muted ? "تشغيل الصوت" : "كتم الصوت"} style={{ background: "none", border: "none", color: "#fff", fontSize: 22, cursor: "pointer", padding: 4 }}>
          {muted ? "🔇" : "🔊"}
        </button>
      </div>

      {/* الخريطة */}
      <div style={{ position: "relative", flex: 1 }}>
        <div ref={holder} data-testid="live-nav-map" style={{ position: "absolute", inset: 0 }} />
        {!follow && status === "go" && !arrived && (
          <button
            type="button"
            onClick={recenter}
            style={{ position: "absolute", insetInlineEnd: 14, bottom: 96, zIndex: 10, background: "#10241B", color: "#C9F339", border: "2px solid #C9F339", borderRadius: 999, padding: "8px 14px", fontWeight: 800, boxShadow: "0 2px 10px rgba(0,0,0,.35)", cursor: "pointer" }}
          >
            ⌖ إعادة التوسيط
          </button>
        )}
      </div>

      {/* الشريط السفلي: الوصول/المتبقّي + إنهاء */}
      <div style={{ background: "#10241B", color: "#fff", padding: "12px 16px", display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ flex: 1 }}>
          {arrived ? (
            <div style={{ fontWeight: 800, fontSize: 18, color: "#C9F339" }}>✓ وصلت إلى نقطة الالتقاء</div>
          ) : remaining ? (
            <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
              <b style={{ fontSize: 22 }}>{fmtMin(remaining.s)}</b>
              <span style={{ opacity: 0.85 }}>{fmtDist(remaining.m)}</span>
              {etaClock && <span style={{ opacity: 0.7, fontSize: 13 }}>الوصول {etaClock}</span>}
            </div>
          ) : (
            <div style={{ opacity: 0.8 }}>تجهيز الملاحة…</div>
          )}
        </div>
        <button type="button" data-testid="live-nav-close" onClick={onClose} style={{ background: arrived ? "#C9F339" : "transparent", color: arrived ? "#10241B" : "#fff", border: arrived ? "none" : "1.5px solid rgba(255,255,255,.5)", borderRadius: 12, padding: "10px 18px", fontWeight: 800, cursor: "pointer" }}>
          {arrived ? "تم" : "إنهاء"}
        </button>
      </div>
    </div>
  );
}
