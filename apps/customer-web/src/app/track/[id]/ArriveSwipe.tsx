"use client";

/**
 * عنصر تأكيد الوصول بالسحب (يسار ← يمين) — نمط «تمرير للإجابة».
 * يبقى مقفلاً حتى يقترب العميل نصف القطر الذي يضبطه Super Admin من المطعم (docs/14):
 * «وصل» لا يتم إلا بتأكيد العميل اليدوي، والقفل يمنع التأكيد المبكر عن بُعد.
 */
import { useRef, useState } from "react";
import s from "./track.module.css";

export type GeoState = "locating" | "denied" | "unavailable" | "ok";

interface Props {
  /** العميل داخل نصف القطر — العنصر قابل للسحب */
  enabled: boolean;
  distanceM: number | null;
  radiusM: number;
  geoState: GeoState;
  onConfirm: () => void | Promise<void>;
}

const KNOB = 58; // قطر المقبض + هامش

export default function ArriveSwipe({ enabled, distanceM, radiusM, geoState, onConfirm }: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const startX = useRef(0);
  const maxX = useRef(0);
  const [x, setX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [done, setDone] = useState(false);

  const active = enabled && !done;

  const onPointerDown = (e: React.PointerEvent) => {
    if (!active) return;
    const track = trackRef.current;
    if (!track) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    maxX.current = Math.max(0, track.clientWidth - KNOB - 6);
    startX.current = e.clientX - x;
    setDragging(true);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging) return;
    const nx = Math.max(0, Math.min(e.clientX - startX.current, maxX.current));
    setX(nx);
  };

  const onPointerUp = async () => {
    if (!dragging) return;
    setDragging(false);
    if (x >= maxX.current * 0.9 && maxX.current > 0) {
      setX(maxX.current);
      setDone(true);
      await onConfirm();
    } else {
      setX(0);
    }
  };

  const distanceLabel = (): string => {
    // تعذّر تحديد الموقع → سماح احتياطي صامت: يُفتح السحب يدوياً بلا رسالة (قرار المالك 2026-07-15)
    if (geoState === "denied" || geoState === "unavailable") return "";
    if (geoState === "locating" && distanceM === null) return "نحدد موقعك…";
    if (distanceM === null) return `يتفعّل عند اقترابك ~${radiusM} م من المطعم`;
    if (enabled) return "أنت في نطاق الاستلام — اسحب لتأكيد وصولك";
    const km = distanceM >= 1000 ? `${(distanceM / 1000).toFixed(1)} كم` : `${distanceM} م`;
    return `تبقّى ~${km} — يتفعّل عند اقترابك ~${radiusM} م من المطعم`;
  };

  const label = done
    ? "تم تأكيد وصولك ✓"
    : active
      ? "اسحب لتأكيد وصولك"
      : `مقفل حتى تقترب ~${radiusM} م`;

  return (
    <div className={s.swipeWrap} data-testid="arrive-swipe">
      <div
        ref={trackRef}
        className={`${s.swipe} ${active ? s.swipeOn : s.swipeLocked} ${done ? s.swipeDone : ""}`}
        dir="ltr"
        role="button"
        aria-disabled={!active}
        aria-label={active ? "اسحب لتأكيد وصولك" : `مقفل حتى تقترب ${radiusM} متر من المطعم`}
      >
        <div className={s.swipeFill} style={{ width: x + KNOB }} />
        <span className={s.swipeLabel}>{label}</span>
        <div
          className={s.swipeKnob}
          data-testid="arrive-swipe-knob"
          style={{
            transform: `translateX(${x}px)`,
            transition: dragging ? "none" : "transform .28s var(--pk-ease)"
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          {active ? (
            <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : (
            /* قفل — العنصر غير قابل للسحب بعد */
            <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
              <rect x="5" y="10" width="14" height="10" rx="2.4" fill="none" stroke="currentColor" strokeWidth="2" />
              <path d="M8 10V7a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          )}
        </div>
      </div>
      {distanceLabel() !== "" && (
        <p className={s.swipeHint} data-testid="arrive-swipe-hint">{distanceLabel()}</p>
      )}
    </div>
  );
}
