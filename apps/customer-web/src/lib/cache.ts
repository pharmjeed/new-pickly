"use client";

/**
 * كاش جلسة خفيف بنمط SWR لطلبات GET: الصفحات تعرض آخر نسخة فوراً عند كل
 * انتقال (ذاكرة + sessionStorage فيبقى بعد تحديث مراقب النشر) ثم تجدّدها
 * بالخلفية — يزيل الهيكل العظمي المتكرر الذي كان يظهر مع كل تنقّل.
 * يُمسح كاملاً عند الخروج/تبديل المستخدم لأن مفاتيح me/* خاصة بصاحبها.
 */

const mem = new Map<string, unknown>();
const SS_PREFIX = "pk_c:";

export function cacheRead<T>(key: string): T | undefined {
  if (mem.has(key)) return mem.get(key) as T;
  try {
    const raw = sessionStorage.getItem(SS_PREFIX + key);
    if (raw !== null) {
      const val = JSON.parse(raw) as T;
      mem.set(key, val);
      return val;
    }
  } catch {
    /* خارج المتصفح أو قيمة تالفة — كأن لا كاش */
  }
  return undefined;
}

export function cacheWrite<T>(key: string, val: T): void {
  mem.set(key, val);
  try {
    sessionStorage.setItem(SS_PREFIX + key, JSON.stringify(val));
  } catch {
    /* تخزين ممتلئ أو خارج المتصفح — الذاكرة تكفي للجلسة الجارية */
  }
}

export function cacheClear(): void {
  mem.clear();
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const k = sessionStorage.key(i);
      if (k?.startsWith(SS_PREFIX)) sessionStorage.removeItem(k);
    }
  } catch {
    /* خارج المتصفح */
  }
}
