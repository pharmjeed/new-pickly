"use client";

/**
 * شاشة البداية — شارة القرطاس المبتسم مع الاسم الثنائي وشعار العلامة
 * «خلّك في سيارتك — طلبك يجيك.» ثم تتلاشى وتنكشف الرئيسية.
 * تظهر مرة واحدة لكل جلسة تبويب (sessionStorage) — تحديث الصفحة لا يعيدها.
 */
import { useEffect, useState } from "react";
import { QirtasBadge, Wordmark } from "./qirtas";
import s from "./splash.module.css";

const KEY = "pk_splash_seen";
const SHOW_MS = 1400;
const FADE_MS = 450;

// يُنفَّذ أثناء تحليل HTML قبل الترطيب: يقرر الإظهار قبل أول رسم — لا وميض للمحتوى تحتها
const boot = `try{if(!sessionStorage.getItem("${KEY}")){document.documentElement.setAttribute("data-pk-splash","1");sessionStorage.setItem("${KEY}","1")}}catch(e){}`;

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
          <div className={s.badge}>
            <QirtasBadge size={104} />
          </div>
          <Wordmark size={34} />
        </div>
        <p className={s.tagline}>خلّك في سيارتك — طلبك يجيك.</p>
      </div>
    </>
  );
}
