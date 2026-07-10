"use client";

/**
 * حاجز الخطأ الجذري — بدل شاشة Next الافتراضية «Application error».
 * أشيع سبب: إعادة نشر تُبدّل أسماء chunks بينما التبويب يحمل نسخة قديمة
 * (ChunkLoadError عند أي تنقل) — نحدّث الصفحة تلقائياً مرة لجلب النسخة الجديدة.
 */
import { useEffect } from "react";

const STALE_CHUNK = /ChunkLoadError|Loading chunk|dynamically imported module/i;
const RELOAD_MARK = "pk_chunk_reload_at";

export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    if (!STALE_CHUNK.test(`${error.name} ${error.message}`)) return;
    const last = Number(sessionStorage.getItem(RELOAD_MARK) ?? "0");
    if (Date.now() - last < 30_000) return; // الفشل مستمر رغم التحديث — لا حلقة إعادة تحميل
    sessionStorage.setItem(RELOAD_MARK, String(Date.now()));
    window.location.reload();
  }, [error]);

  return (
    <html lang="ar" dir="rtl">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          background: "#f6f7f4",
          color: "#161a14",
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
              border: "none",
              background: "#c8f051",
              color: "#161a14",
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
