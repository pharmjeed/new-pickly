"use client";

/**
 * حاجز الخطأ الجذري — بدل شاشة Next الافتراضية «Application error».
 * أشيع سبب: إعادة نشر تُبدّل أسماء chunks بينما التبويب يحمل نسخة قديمة.
 * رسائل الإنتاج مصغّرة فلا يُعتمد على نصّ الخطأ — نحدّث تلقائياً مرة واحدة
 * لأي خطأ، فإن تكرر خلال ٣٠ ثانية فالعطل مستمر وتظهر هذه الشاشة.
 * الهوية الفنكية v2.0: القرطاس المتأسف + التوكنز (globals.css تحمل tokens).
 */
import { useEffect } from "react";
import "./globals.css";
import { Qirtas } from "./qirtas";

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
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          backgroundColor: "var(--pk-bg)",
          backgroundImage: "var(--pk-dots)",
          backgroundSize: "var(--pk-dots-size)",
          color: "var(--pk-text)",
          fontFamily: "var(--pk-font-body), 'IBM Plex Sans Arabic', system-ui, sans-serif",
          textAlign: "center"
        }}
      >
        <main
          style={{
            padding: 28,
            maxWidth: 480,
            background: "var(--pk-surface)",
            border: "var(--pk-b3)",
            borderRadius: "var(--pk-radius-lg)",
            boxShadow: "var(--pk-pop)"
          }}
        >
          {/* القرطاس المتأسف — الأخطاء بلا لوم للمستخدم */}
          <Qirtas mood="sad" size={96} />
          <h1 style={{ fontSize: 22, margin: "12px 0 8px", fontFamily: "var(--pk-font-display)", fontWeight: 800 }}>
            حدث خطأ غير متوقع
          </h1>
          <p style={{ lineHeight: 1.8, marginBottom: 20 }}>
            غالباً لأن نسخة الصفحة أقدم من آخر تحديث للنظام — حدّث الصفحة للمتابعة، وإن تكرر
            الخطأ فبلّغ الدعم الفني.
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: "12px 28px",
              borderRadius: 14,
              border: "var(--pk-b2)",
              background: "var(--pk-blue-500)",
              color: "var(--pk-white)",
              boxShadow: "var(--pk-pop-sm)",
              fontSize: 16,
              fontWeight: 700,
              cursor: "pointer",
              fontFamily: "var(--pk-font-display), inherit",
              minHeight: 48
            }}
          >
            تحديث الصفحة
          </button>
        </main>
      </body>
    </html>
  );
}
