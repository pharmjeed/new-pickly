"use client";
/**
 * تبديل اللغة — سياق خفيف بلا مكتبات: العربية (الافتراضي) / English.
 * الاختيار محفوظ في localStorage ويقلب lang/dir على <html> فوراً.
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { DICT, type Dict, type Lang } from "./dict";

const STORAGE_KEY = "pickly-lang";

const Ctx = createContext<{ lang: Lang; toggle: () => void }>({ lang: "ar", toggle: () => {} });

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>("ar");

  useEffect(() => {
    if (window.localStorage.getItem(STORAGE_KEY) === "en") setLang("en");
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
  }, [lang]);

  const toggle = () => {
    const next: Lang = lang === "ar" ? "en" : "ar";
    window.localStorage.setItem(STORAGE_KEY, next);
    setLang(next);
  };

  return <Ctx.Provider value={{ lang, toggle }}>{children}</Ctx.Provider>;
}

export function useLang() {
  return useContext(Ctx);
}

/** قاموس اللغة الحالية */
export function useT(): Dict {
  return DICT[useContext(Ctx).lang];
}

/** زر تبديل اللغة — حبة فنكية بأيقونة كوكب، يحل محل زر الطلب المحذوف في النافبار */
export function LangToggle() {
  const { lang, toggle } = useLang();
  const t = DICT[lang];
  return (
    <button type="button" className="lang-btn" onClick={toggle} aria-label={t.nav.switchLabel} title={t.nav.switchLabel}>
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18" />
        <path d="M12 3a14.5 14.5 0 0 1 0 18a14.5 14.5 0 0 1 0-18" />
      </svg>
      <span>{lang === "ar" ? "EN" : "عربي"}</span>
    </button>
  );
}
