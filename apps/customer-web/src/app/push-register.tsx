"use client";

/**
 * تسجيل توكن Push من غلاف التطبيق (mobile-apps/customer) — يصل عبر حدث
 * pickly:push-token أو window.__picklyPush إن سبق الحقنُ التركيب. تسجيله عبر
 * POST /v1/customers/me/push-token يمكّن إشعارات تقدّم الطلب النظامية التي
 * تصل وترن حتى والتطبيق مقفل. في المتصفح العادي لا توكن — المكوّن صامت.
 */
import { useEffect } from "react";
import { api, getToken } from "@/lib/api";

interface PushDetail {
  token?: string;
  platform?: string;
}

/** sub من حمولة JWT (base64url) — مفتاح dedupe لكل مستخدم كي ينتقل التوكن لصاحب الجلسة الجديد */
function subOf(jwt: string): string | null {
  try {
    const b64 = (jwt.split(".")[1] ?? "").replace(/-/g, "+").replace(/_/g, "/");
    return (JSON.parse(atob(b64)) as { sub?: string }).sub ?? null;
  } catch {
    return null;
  }
}

export default function PushRegister() {
  useEffect(() => {
    let stopped = false;
    let inflight = false;

    const tryRegister = () => {
      if (stopped || inflight) return;
      const detail = (window as unknown as { __picklyPush?: PushDetail }).__picklyPush;
      const token = detail?.token;
      const jwt = getToken();
      if (!token || !jwt) return;
      const sub = subOf(jwt);
      if (!sub) return;
      const dedupeKey = `pk_push_${sub}`;
      if (localStorage.getItem(dedupeKey) === token) return; // مسجّل سلفاً لهذا الحساب
      inflight = true;
      void api("POST", "/v1/customers/me/push-token", {
        token,
        platform: detail?.platform === "ios" ? "ios" : "android"
      })
        .then(() => localStorage.setItem(dedupeKey, token))
        .catch(() => {
          /* تحسين — يُعاد في الفحص التالي */
        })
        .finally(() => {
          inflight = false;
        });
    };

    tryRegister();
    const onToken = () => tryRegister();
    document.addEventListener("pickly:push-token", onToken);
    // تسجيل الدخول يتم بتنقل SPA لا يعيد حقن الغلاف — فحص دوري خفيف يلتقطه بعده
    const t = setInterval(tryRegister, 20_000);
    return () => {
      stopped = true;
      document.removeEventListener("pickly:push-token", onToken);
      clearInterval(t);
    };
  }, []);
  return null;
}
