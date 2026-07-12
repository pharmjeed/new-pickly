"use client";

/**
 * مراقب النشر — شاشات التشغيل تبقى مفتوحة ساعات بينما كل نشر يبدّل أسماء
 * chunks، فتنكسر النسخة القديمة عند أول جلب (شاشة «حدث خطأ غير متوقع»).
 * نستطلع نسخة البناء كل دقيقة وعند تغيّرها نحدّث الصفحة قبل وقوع الكسر.
 */
import { useEffect } from "react";

const POLL_MS = 60_000;

export default function VersionWatch() {
  useEffect(() => {
    let baseline: string | null = null;
    let stopped = false;
    const tick = async () => {
      try {
        const res = await fetch("/build-id", { cache: "no-store" });
        if (!res.ok) return;
        const { build_id } = (await res.json()) as { build_id?: string };
        if (stopped || typeof build_id !== "string" || build_id === "") return;
        if (baseline === null) baseline = build_id;
        else if (build_id !== baseline) window.location.reload();
      } catch {
        /* النشر جارٍ أو الشبكة متقطعة — نعيد المحاولة في الدورة القادمة */
      }
    };
    void tick();
    const t = setInterval(tick, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(t);
    };
  }, []);
  return null;
}
