import { defineConfig } from "vitest/config";

/**
 * الاختبارات التكاملية تتشارك قاعدة بيانات واحدة (وحساب أدمن واحد بحد OTP) —
 * تشغيل الملفات تسلسلياً يمنع تسابقها على الحالة المشتركة (CI وأي جهاز).
 */
export default defineConfig({
  test: {
    fileParallelism: false
  }
});
