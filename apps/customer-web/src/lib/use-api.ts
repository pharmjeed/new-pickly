"use client";

/**
 * useApi — جلب GET بكاش الجلسة: النسخة المخبأة تُعرض قبل أول رسم بعد
 * التركيب (فالانتقال بين الصفحات لا يمر بهيكل عظمي) ويجري التجديد بالخلفية.
 * path = null يعني «لا تجلب الآن» (زائر غير مسجّل مثلاً).
 */
import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { api } from "./api";
import { cacheRead, cacheWrite } from "./cache";

// useLayoutEffect محظور أثناء عرض الخادم — نسقط لـuseEffect خارج المتصفح
export const useIsoLayout = typeof window === "undefined" ? useEffect : useLayoutEffect;

export function useApi<T>(path: string | null): {
  data: T | null;
  error: string | null;
  mutate: (updater: (prev: T | null) => T | null) => void;
} {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);

  // الكاش يُقرأ بعد الترطيب وقبل الرسم — لا فرق مع HTML الخادم ولا وميض هيكل
  useIsoLayout(() => {
    setData(path ? (cacheRead<T>(path) ?? null) : null);
    setError(null);
  }, [path]);

  useEffect(() => {
    if (!path) return;
    let alive = true;
    api<T>("GET", path)
      .then((val) => {
        cacheWrite(path, val);
        if (alive) {
          setData(val);
          setError(null);
        }
      })
      .catch((e: Error) => {
        // النسخة المخبأة تبقى معروضة عند فشل التجديد — الخطأ يظهر فقط حين لا بديل
        if (alive && cacheRead(path) === undefined) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [path]);

  const mutate = useCallback(
    (updater: (prev: T | null) => T | null) => {
      setData((prev) => {
        const next = updater(prev);
        if (path && next !== null) cacheWrite(path, next);
        return next;
      });
    },
    [path]
  );

  return { data, error, mutate };
}
