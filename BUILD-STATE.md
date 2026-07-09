# BUILD-STATE.md — حالة بناء Pickly

> نقطة الاستئناف لأي جلسة جديدة. حدِّث هذا الملف قبل كل commit.
> آخر تحديث: 2026-07-09

## الحالة العامة

| المرحلة | الحالة |
|---------|--------|
| 1. التأسيس (Monorepo، Docker، CI، contracts، database، Auth، Seed) | 🔨 جارية |
| 2. Vertical Slice (رحلة J1 كاملة E2E) | ⬜ |
| 3. توسيع العميل (Expo P1–P8 + تتبع الويب) | ⬜ |
| 4. الفرع والتاجر | ⬜ |
| 5. المالية | ⬜ |
| 6. الموقع | ⬜ |
| 7. Super Admin + الموقع التعريفي | ⬜ |
| 8. الجودة | ⬜ |
| 9. البنية للنشر | ⬜ |

## ما أُنجز

- [x] فك حزمة الوثائق `docs/` (00–21) + `CLAUDE.md` في الجذر.
- [x] فك حزمة الواجهات في `design/` (62 صفحة HTML + tokens.css + COMPLIANCE.md + `_frag/` بكل الشاشات المنطقية).
- [x] ملفات الهوية الأربعة في `design/identity/`.
- [x] `git init` + فحص الأدوات: Node v25.9.0، pnpm 10.0.0، Docker 25.0.3.

## ما يجري الآن

- المرحلة 1: كتابة أساس الـMonorepo (root configs → tsconfig/eslint → contracts → database/Prisma → observability → adapters → apps/api auth+health → worker → CI → seed).

## التالي

- إنهاء بوابة المرحلة 1: `pnpm i && pnpm dev` يعمل، lint/typecheck/tests خضراء.
- ثم المرحلة 2 (Vertical Slice): P2 ← P4 ← P5 ← P6 ← P7 ← B-03 مع Playwright.

## قرارات محسومة (سجل تراكمي)

| # | القرار | المرجع |
|---|--------|--------|
| D1 | حزم المرحلة 1: contracts، database، auth، payments، geo، notifications، observability، tsconfig، eslint-config. حزمتا ui/mobile-ui تُنشآن في مرحلتي 3–4 | docs/09§5 |
| D2 | نموذج الأموال: (ب) Split/Marketplace وفق ترجيح docs/13§1 — يُبنى خلف PaymentAdapter بوضعي mock/production | docs/13§1 |
| D3 | كل اعتماد خارجي (دفع، SMS، خرائط/Routes، FCM) خلف Adapter Interface بتنفيذين mock وproduction؛ التبديل بمتغير بيئة | برومبت البناء §1 |
| D4 | جداول المؤجل (wallet، loyalty، مجدول...) تُنشأ في Prisma دون واجهات | docs/21§3 |
| D5 | Outbox يُنفَّذ عبر جدول background_jobs (job_type='domain_event') — قائمة جداول docs/10 مغلقة ولا تتضمن جدول outbox مستقلاً | docs/12§3 + docs/10 |
| D6 | عنوان docs/05 يقول «24 حالة» لكن التعداد الحرفي 25 (يشمل PARTIALLY_REFUNDED). القائمة الحرفية هي الحاكمة — اعتُمدت 25 حالة في contracts وPrisma enum | docs/05§1 |

## ملاحظات تشغيلية

- منصة التطوير الحالية: Windows 10 — docker-compose يشغّل postgres+postgis وredis وmailhog محلياً.
- المؤقت: لا remote للمستودع بعد؛ يُضاف عند إنشاء حساب GitHub (انظر HUMAN-ACTIONS.md).
