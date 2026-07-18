"use client";
/**
 * طبقة الحركة للموقع التعريفي — CSS/JS خفيف بلا مكتبات (نهج qirtas-motion نفسه).
 *  - <Reveal/>  كشف عند التمرير عبر IntersectionObserver (rv/rv-in في globals.css)،
 *               ومع className="rv-stagger" يتدرّج أبناؤه المباشرون.
 *  - <CountUp/> عدّاد أرقام يصعد عند دخوله الشاشة — بأرقام هندية في العربية.
 * كلاهما يظهر المحتوى فوراً عند غياب IntersectionObserver أو مع prefers-reduced-motion.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useLang } from "@/lib/i18n";

export function Reveal({
  children,
  className = "",
  delay = 0,
  id
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  id?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    // بيئات بلا IO أو بمنفذ عرض صفري (WebViews شاذة): أظهر فوراً بدل إخفاء دائم
    if (!el || typeof IntersectionObserver === "undefined" || window.innerHeight === 0) {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true);
          io.disconnect();
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -36px 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      id={id}
      className={`rv${inView ? " rv-in" : ""}${className ? ` ${className}` : ""}`}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </div>
  );
}

const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const toArabicDigits = (s: string) => s.replace(/\d/g, (d) => AR_DIGITS[Number(d)]);

export function CountUp({
  to,
  prefix = "",
  suffix = "",
  duration = 1300
}: {
  to: number;
  prefix?: string;
  suffix?: string;
  duration?: number;
}) {
  const { lang } = useLang();
  const ref = useRef<HTMLElement>(null);
  const [val, setVal] = useState(to); // يُقدَّم الهدف مباشرة (SSR/بلا JS) ثم يُحرَّك عند الظهور

  useEffect(() => {
    const el = ref.current;
    if (
      !el ||
      typeof IntersectionObserver === "undefined" ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;
    let raf = 0;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        const t0 = performance.now();
        const tick = (t: number) => {
          const p = Math.min(1, (t - t0) / duration);
          setVal(Math.round(to * (1 - Math.pow(1 - p, 3))));
          if (p < 1) raf = requestAnimationFrame(tick);
        };
        setVal(0);
        raf = requestAnimationFrame(tick);
      },
      { threshold: 0.4 }
    );
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [to, duration]);

  return (
    <b ref={ref}>
      {prefix}
      {lang === "ar" ? toArabicDigits(String(val)) : String(val)}
      {suffix}
    </b>
  );
}
