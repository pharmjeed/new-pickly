"use client";

/**
 * حاجز الخطأ الجذري — بدل شاشة Next الافتراضية «Application error».
 * أشيع سبب: إعادة نشر تُبدّل أسماء chunks بينما التبويب يحمل نسخة قديمة.
 * رسائل الإنتاج مصغّرة فلا يُعتمد على نصّ الخطأ — نحدّث تلقائياً مرة واحدة
 * لأي خطأ، فإن تكرر خلال ٣٠ ثانية فالعطل مستمر وتظهر هذه الشاشة.
 */
import { useEffect } from "react";

const RELOAD_MARK = "pk_error_reload_at";

export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    try {
      const last = Number(sessionStorage.getItem(RELOAD_MARK) ?? "0");
      if (Date.now() - last < 30_000) return; // الفشل مستمر رغم التحديث — لا حلقة إعادة تحميل
      sessionStorage.setItem(RELOAD_MARK, String(Date.now()));
      window.location.reload();
    } catch {
      /* sessionStorage محجوبة — تبقى الشاشة وزر التحديث اليدوي */
    }
  }, [error]);

  return (
    <html lang="ar" dir="rtl">
      {/* صفحة مستقلة عن أوراق الأنماط — قيم tokens.css مع fallback حرفي لنفس الرموز */}
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          background: "var(--pk-cloud, #F7F3E9)",
          color: "var(--pk-ink-900, #0E1B3D)",
          fontFamily: "'IBM Plex Sans Arabic', system-ui, sans-serif",
          textAlign: "center"
        }}
      >
        <main style={{ padding: 24, maxWidth: 480 }}>
          <h1 style={{ fontSize: 22, marginBottom: 8 }}>حدث خطأ غير متوقع</h1>
          <p style={{ lineHeight: 1.8, marginBottom: 20 }}>
            غالباً لأن نسخة الصفحة أقدم من آخر تحديث للنظام — حدّث الصفحة للمتابعة، وإن تكرر
            الخطأ فبلّغ الدعم الفني.
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: "12px 28px",
              borderRadius: 12,
              border: "2px solid var(--pk-ink-900, #0E1B3D)",
              boxShadow: "4px 4px 0 var(--pk-ink-900, #0E1B3D)",
              background: "var(--pk-blue-500, #0B63CE)",
              color: "var(--pk-white, #FFFFFF)",
              fontSize: 16,
              fontWeight: 700,
              cursor: "pointer",
              fontFamily: "inherit"
            }}
          >
            تحديث الصفحة
          </button>
        </main>
      </body>
    </html>
  );
}
