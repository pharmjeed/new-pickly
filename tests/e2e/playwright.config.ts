import { defineConfig } from "@playwright/test";

/**
 * بوابة الـVertical Slice (docs/20 مرحلة 6) — تشغّل الخوادم الثلاثة وتقود
 * رحلة J1 في المتصفح: واجهة العميل + لوحة الفرع معاً.
 * المتطلب المسبق: docker compose up -d && pnpm db:migrate && pnpm db:seed
 */
export default defineConfig({
  testDir: ".",
  timeout: 120_000,
  expect: { timeout: 20_000 },
  retries: process.env.CI ? 1 : 0,
  workers: 1, // رحلة واحدة متسلسلة عبر سياقين
  reporter: [["list"]],
  use: {
    locale: "ar-SA",
    trace: "retain-on-failure"
  },
  webServer: [
    {
      command: "pnpm --filter @pickly/api dev",
      url: "http://localhost:4000/health",
      reuseExistingServer: !process.env.CI,
      cwd: "../..",
      timeout: 60_000
    },
    {
      command: "pnpm --filter @pickly/customer-web dev",
      url: "http://localhost:3000",
      reuseExistingServer: !process.env.CI,
      cwd: "../..",
      timeout: 120_000
    },
    {
      command: "pnpm --filter @pickly/branch-ops dev",
      url: "http://localhost:3002",
      reuseExistingServer: !process.env.CI,
      cwd: "../..",
      timeout: 120_000
    }
  ]
});
