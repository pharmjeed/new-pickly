"use client";

/**
 * حاجز الخطأ الجذري — بدل شاشة Next الافتراضية «Application error».
 * أشيع سبب: إعادة نشر تُبدّل أسماء chunks بينما التبويب يحمل نسخة قديمة.
 * رسائل الإنتاج مصغّرة فلا يُعتمد على نصّ الخطأ — نحدّث تلقائياً مرة واحدة
 * لأي خطأ، فإن تكرر خلال ٣٠ ثانية فالعطل مستمر وتظهر هذه الشاشة.
 * الشكل: الهوية الفنكية v2.0 — القرطاس المتأسف + زر أزرق بظل صلب.
 */
import { useEffect } from "react";
import { Qirtas } from "@/components/qirtas";
import "./globals.css";

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
          fontFamily: "var(--pk-font-body)",
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
          <Qirtas mood="sad" size={96} />
          <h1 style={{ fontFamily: "var(--pk-font-display)", fontWeight: 800, fontSize: 22, margin: "10px 0 8px" }}>
            حدث خطأ غير متوقع
          </h1>
          <p style={{ lineHeight: 1.8, marginBottom: 20, color: "var(--pk-text-2)" }}>
            غالباً لأن نسخة الصفحة أقدم من آخر تحديث للنظام — حدّث الصفحة للمتابعة، وإن تكرر
            الخطأ فبلّغ الدعم الفني.
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              minHeight: 48,
              padding: "12px 28px",
              borderRadius: 14,
              border: "var(--pk-b2)",
              background: "var(--pk-blue-500)",
              color: "var(--pk-white)",
              boxShadow: "var(--pk-pop-sm)",
              fontSize: 16,
              fontWeight: 700,
              cursor: "pointer",
              fontFamily: "var(--pk-font-display)"
            }}
          >
            تحديث الصفحة
          </button>
        </main>
      </body>
    </html>
  );
}
