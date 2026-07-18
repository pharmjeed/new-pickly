"use client";

/**
 * شاشة البداية الحية — القرطاس المبتسم يدخل ماشياً حاملاً كيس بيكلي
 * بخطوط سرعته الوردية، فوق فقاعة ليمونية، ثم الاسم الثنائي والشعار
 * «خلّك في سيارتك — طلبك يجيك.» وتتلاشى لتنكشف الرئيسية.
 * تظهر مرة واحدة لكل جلسة تبويب (sessionStorage) — تحديث الصفحة لا يعيدها.
 */
import { useEffect, useState } from "react";
import { Wordmark } from "./qirtas";
import { QirtasLive } from "./qirtas-motion";
import s from "./splash.module.css";

const KEY = "pk_splash_seen";
const SHOW_MS = 1750;
const FADE_MS = 450;
const LOAD_WAIT_CAP_MS = 4000; // سقف انتظار حدث load داخل الغلاف — لا نعلّق السبلاش على مورد بطيء

// يُنفَّذ أثناء تحليل HTML قبل الترطيب: يقرر الإظهار قبل أول رسم — لا وميض للمحتوى تحتها.
// __picklyHasNativeSplash يحقنه الغلاف الحديث (شاشة إقلاع أصلية) — فلا نكرر السبلاش بعدها.
const boot = `try{if(!window.__picklyHasNativeSplash&&!sessionStorage.getItem("${KEY}")){document.documentElement.setAttribute("data-pk-splash","1");sessionStorage.setItem("${KEY}","1")}}catch(e){}`;

export default function Splash() {
  const [phase, setPhase] = useState<"show" | "fade" | "gone">("show");

  useEffect(() => {
    if (document.documentElement.getAttribute("data-pk-splash") !== "1") {
      setPhase("gone");
      return;
    }
    let t1: ReturnType<typeof setTimeout> | undefined;
    let t2: ReturnType<typeof setTimeout> | undefined;
    let cap: ReturnType<typeof setTimeout> | undefined;
    let started = false;
    const start = () => {
      if (started) return;
      started = true;
      t1 = setTimeout(() => setPhase("fade"), SHOW_MS);
      t2 = setTimeout(() => {
        document.documentElement.removeAttribute("data-pk-splash");
        setPhase("gone");
      }, SHOW_MS + FADE_MS);
    };
    // داخل غلاف التطبيق (WebView) تغطي طبقةُ التحميل الأصلية الصفحةَ حتى حدث load —
    // نرسو المؤقّت عليه كي يُرى المشي كاملاً بعد انزياحها، لا أن يحترق وقته خلفها.
    const inWrapper = /PicklyApp|; wv\)/.test(navigator.userAgent || "");
    if (inWrapper && document.readyState !== "complete") {
      window.addEventListener("load", start, { once: true });
      cap = setTimeout(start, LOAD_WAIT_CAP_MS);
    } else {
      start();
    }
    return () => {
      window.removeEventListener("load", start);
      if (t1) clearTimeout(t1);
      if (t2) clearTimeout(t2);
      if (cap) clearTimeout(cap);
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
        <span className={s.blob} />
        <span className={s.blobTop} />
        <div className={s.walker}>
          <QirtasLive pose="walk" carrying lines size={132} />
        </div>
        <div className={s.brand}>
          <Wordmark size={36} />
        </div>
        <p className={s.tagline}>خلّك في سيارتك — طلبك يجيك.</p>
      </div>
    </>
  );
}
