"use client";

/**
 * شاشة البداية — اللوقو مع «خليك في السيارة وطلبك يجيك» عند فتح التطبيق،
 * ثم تتلاشى وتنكشف الرئيسية (قائمة المطاعم).
 * تظهر مرة واحدة لكل جلسة تبويب (sessionStorage) — تحديث الصفحة لا يعيدها.
 */
import { useEffect, useState } from "react";
import s from "./splash.module.css";

const KEY = "pk_splash_seen";
const SHOW_MS = 1400;
const FADE_MS = 450;

// يُنفَّذ أثناء تحليل HTML قبل الترطيب: يقرر الإظهار قبل أول رسم — لا وميض للمحتوى تحتها
const boot = `try{if(!sessionStorage.getItem("${KEY}")){document.documentElement.setAttribute("data-pk-splash","1");sessionStorage.setItem("${KEY}","1")}}catch(e){}`;

function BadgeLogo() {
  return (
    <svg width="88" height="88" viewBox="0 0 100 100" aria-hidden="true">
      <rect width="100" height="100" rx="24" fill="var(--pk-ink-900)" />
      <g transform="skewX(-8) translate(4,0)" stroke="var(--pk-lime-500)" fill="none">
        <path d="M36,34 L62,34 L59,72 L39,72 Z" strokeWidth="4" strokeLinejoin="round" />
        <path d="M43,34 Q49,24 55,34" strokeWidth="3.5" strokeLinecap="round" />
        <path d="M70,40 H88" strokeWidth="5" strokeLinecap="round" />
        <path d="M74,52 H88" strokeWidth="5" strokeLinecap="round" opacity="0.55" />
        <path d="M70,64 H80" strokeWidth="5" strokeLinecap="round" opacity="0.3" />
      </g>
    </svg>
  );
}

export default function Splash() {
  const [phase, setPhase] = useState<"show" | "fade" | "gone">("show");

  useEffect(() => {
    if (document.documentElement.getAttribute("data-pk-splash") !== "1") {
      setPhase("gone");
      return;
    }
    const t1 = setTimeout(() => setPhase("fade"), SHOW_MS);
    const t2 = setTimeout(() => {
      document.documentElement.removeAttribute("data-pk-splash");
      setPhase("gone");
    }, SHOW_MS + FADE_MS);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);

  if (phase === "gone") return null;

  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: boot }} />
      <div
        className={phase === "fade" ? `${s.splash} ${s.out}` : s.splash}
        aria-hidden="true"
        data-testid="splash"
      >
        <div className={s.inner}>
          <BadgeLogo />
          <div dir="ltr" className={s.word}>
            <span className={s.wordLatin}>pickly</span>
            <span className={s.wordAr}>بيكلي</span>
          </div>
        </div>
        <p className={s.tagline}>خليك في السيارة وطلبك يجيك</p>
      </div>
    </>
  );
}
