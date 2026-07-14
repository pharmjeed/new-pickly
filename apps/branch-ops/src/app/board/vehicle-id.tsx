/**
 * هوية السيارة على بطاقة الفرع (قرار المالك 2026-07-14):
 * لوحة سعودية مصغّرة (حروف + أرقام) + شعار ماركة SVG مبسّط + دائرة لون السيارة.
 * الشعارات تقريبية للتمييز البصري السريع لا طبق الأصل؛ ولمن لا شعار له: الاسم اللاتيني بخط شعاري.
 */
import type { ReactElement } from "react";
import s from "./board.module.css";

export interface CardVehicle {
  make_ar: string | null;
  model_ar: string | null;
  color_ar: string;
  color_hex: string | null;
  plate_letters_ar: string | null;
  plate_digits: string;
}

/** لوحة سعودية مصغّرة: أرقام | حروف | شريط أزرق SA — اتجاه ثابت LTR كاللوحة الحقيقية */
export function SaudiPlate({ letters, digits }: { letters: string | null; digits: string }) {
  return (
    <span className={s.plate} dir="ltr" data-testid="vehicle-plate">
      <span className={s.plateDigits}>{digits}</span>
      {letters && <span className={s.plateLetters}>{letters}</span>}
      <span className={s.plateBand}>
        <i>S</i>
        <i>A</i>
      </span>
    </span>
  );
}

/** أسماء لاتينية للماركات (كتالوج السوق السعودي) — للنص الشعاري حين لا SVG */
const MAKE_EN: Record<string, string> = {
  "تويوتا": "TOYOTA",
  "هيونداي": "HYUNDAI",
  "نيسان": "NISSAN",
  "كيا": "KIA",
  "فورد": "FORD",
  "شفروليه": "CHEVROLET",
  "جي إم سي": "GMC",
  "هوندا": "HONDA",
  "مازدا": "MAZDA",
  "ميتسوبيشي": "MITSUBISHI",
  "لكزس": "LEXUS",
  "مرسيدس": "MERCEDES",
  "بي إم دبليو": "BMW",
  "أودي": "AUDI",
  "جيلي": "GEELY",
  "شانجان": "CHANGAN",
  "إم جي": "MG",
  "هافال": "HAVAL",
  "تشيري": "CHERY",
  "دودج": "DODGE",
  "جيب": "JEEP",
  "لاند روفر": "LAND ROVER",
  "بورشه": "PORSCHE",
  "سوزوكي": "SUZUKI",
  "إيسوزو": "ISUZU"
};

const V = { fill: "none", stroke: "currentColor" } as const;

/** شعارات SVG هندسية مبسّطة للماركات الشائعة — 28×28، بلون النص الحالي */
const MAKE_SVG: Record<string, ReactElement> = {
  "تويوتا": (
    <svg viewBox="0 0 48 32" width="30" height="20" aria-hidden="true">
      <ellipse cx="24" cy="16" rx="22" ry="14" {...V} strokeWidth="3" />
      <ellipse cx="24" cy="16" rx="9.5" ry="14" {...V} strokeWidth="3" />
      <ellipse cx="24" cy="10" rx="17" ry="5.5" {...V} strokeWidth="3" />
    </svg>
  ),
  "هيونداي": (
    <svg viewBox="0 0 48 32" width="30" height="20" aria-hidden="true">
      <ellipse cx="24" cy="16" rx="21" ry="13" {...V} strokeWidth="3" />
      <path d="M15 8 L18 24 M33 8 L30 24 M16.5 15 Q24 12 31.5 15" {...V} strokeWidth="3.4" strokeLinecap="round" />
    </svg>
  ),
  "نيسان": (
    <svg viewBox="0 0 48 32" width="30" height="20" aria-hidden="true">
      <circle cx="24" cy="16" r="13" {...V} strokeWidth="3" />
      <path d="M2 16 H46" {...V} strokeWidth="5" />
    </svg>
  ),
  "هوندا": (
    <svg viewBox="0 0 48 32" width="26" height="20" aria-hidden="true">
      <path d="M12 4 V28 M36 4 V28 M12 16 H36" {...V} strokeWidth="5" strokeLinecap="round" />
    </svg>
  ),
  "لكزس": (
    <svg viewBox="0 0 48 32" width="30" height="20" aria-hidden="true">
      <ellipse cx="24" cy="16" rx="21" ry="13" {...V} strokeWidth="3" />
      <path d="M20 6 L14 24 H38" {...V} strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  "مرسيدس": (
    <svg viewBox="0 0 32 32" width="22" height="22" aria-hidden="true">
      <circle cx="16" cy="16" r="14" {...V} strokeWidth="2.6" />
      <path d="M16 2 V16 M16 16 L4.5 25 M16 16 L27.5 25" {...V} strokeWidth="2.8" strokeLinecap="round" />
    </svg>
  ),
  "بي إم دبليو": (
    <svg viewBox="0 0 32 32" width="22" height="22" aria-hidden="true">
      <circle cx="16" cy="16" r="14" {...V} strokeWidth="2.6" />
      <path d="M16 2 V30 M2 16 H30" {...V} strokeWidth="2.4" />
      <path d="M16 6 A10 10 0 0 1 26 16 H16 Z M16 26 A10 10 0 0 1 6 16 H16 Z" fill="currentColor" opacity="0.5" />
    </svg>
  ),
  "أودي": (
    <svg viewBox="0 0 60 24" width="36" height="16" aria-hidden="true">
      <circle cx="10" cy="12" r="8" {...V} strokeWidth="2.6" />
      <circle cx="23" cy="12" r="8" {...V} strokeWidth="2.6" />
      <circle cx="36" cy="12" r="8" {...V} strokeWidth="2.6" />
      <circle cx="49" cy="12" r="8" {...V} strokeWidth="2.6" />
    </svg>
  ),
  "ميتسوبيشي": (
    <svg viewBox="0 0 32 32" width="22" height="22" aria-hidden="true">
      <path d="M16 2 L21 11 L16 20 L11 11 Z" fill="currentColor" />
      <path d="M16 20 L21 11 L30 28 H20 Z M16 20 L11 11 L2 28 H12 Z" fill="currentColor" opacity="0.75" />
    </svg>
  ),
  "شفروليه": (
    <svg viewBox="0 0 48 24" width="30" height="16" aria-hidden="true">
      <path d="M18 4 H30 V9 H46 V15 H30 V20 H18 V15 H2 V9 H18 Z" {...V} strokeWidth="3" strokeLinejoin="round" />
    </svg>
  ),
  "مازدا": (
    <svg viewBox="0 0 48 32" width="30" height="20" aria-hidden="true">
      <ellipse cx="24" cy="16" rx="21" ry="13" {...V} strokeWidth="3" />
      <path d="M8 22 Q16 4 24 13 Q32 4 40 22" {...V} strokeWidth="3.2" strokeLinecap="round" />
    </svg>
  ),
  "فورد": (
    <svg viewBox="0 0 56 28" width="34" height="18" aria-hidden="true">
      <ellipse cx="28" cy="14" rx="26" ry="12" {...V} strokeWidth="2.8" />
      <text
        x="28"
        y="19"
        textAnchor="middle"
        fontSize="13"
        fontStyle="italic"
        fontWeight="700"
        fill="currentColor"
        stroke="none"
      >
        Ford
      </text>
    </svg>
  )
};

/**
 * علامة الماركة: SVG مبسّط للشائعة، وإلا الاسم اللاتيني بخط شعاري عريض،
 * وإلا (ماركة حرة غير مفهرسة) الاسم العربي كما أدخله العميل.
 */
export function MakeMark({ make_ar }: { make_ar: string | null }) {
  if (!make_ar) return null;
  const svg = MAKE_SVG[make_ar];
  return (
    <span className={s.makeMark} title={make_ar} data-testid="vehicle-make">
      {svg ?? <b className={s.makeTxt}>{MAKE_EN[make_ar] ?? make_ar}</b>}
    </span>
  );
}

/** سطر هوية السيارة: الشعار + الموديل + دائرة اللون + اللوحة المصغّرة */
export function VehicleId({ v }: { v: CardVehicle }) {
  return (
    <div className={s.vehId} data-testid="vehicle-id">
      <MakeMark make_ar={v.make_ar} />
      <span className={s.vehModel}>{v.model_ar ?? v.make_ar}</span>
      <span className={s.colorChip} title={v.color_ar}>
        <i className={s.colorDot} style={{ background: v.color_hex ?? "var(--pk-gray)" }} />
        {v.color_ar}
      </span>
      <SaudiPlate letters={v.plate_letters_ar} digits={v.plate_digits} />
    </div>
  );
}
