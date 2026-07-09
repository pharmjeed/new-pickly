# BUILD-STATE.md — حالة بناء Pickly

> نقطة الاستئناف لأي جلسة جديدة. حدِّث هذا الملف قبل كل commit.
> آخر تحديث: 2026-07-09

## الحالة العامة

| المرحلة | الحالة |
|---------|--------|
| 1. التأسيس (Monorepo، Docker، CI، contracts، database، Auth، Seed) | ✅ بوابة خضراء |
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
- [x] **المرحلة 1 كاملة — بوابتها خضراء (تحقق فعلي):**
  - Monorepo pnpm بهيكل docs/09§5 + docker-compose (postgres+postgis على 5433، redis، mailhog) — الحاويات تعمل.
  - `packages/contracts`: حالات الطلب الـ25 + جدول الانتقالات + إسقاط العرض السبع + أكواد أخطاء ar/en + أحداث النطاق + Zod DTOs + `openapi.json` (34 مساراً).
  - `packages/database`: Prisma schema كامل (~98 جدولاً حرفياً من docs/10، شاملاً جداول المؤجل) + هجرتان مطبقتان (init + append_only_guards بـtriggers) + seed سعودي (3 تجار، 6 فروع، 33 منتجاً، 12 مستخدماً، أدوار كاملة، قوالب إشعارات، أعلام).
  - Adapters بوضعي mock/production: SMS (Mock+Unifonic)، Payment (sandbox داخلي بAuth/Capture/Refund وWebhooks موقعة HMAC)، Geo (MockRoutes+GoogleRoutes+محاكي رحلة)، Push (Mock+هيكل FCM).
  - `apps/api` Fastify: غلاف الخطأ الموحد، auth OTP كامل (rate limit، حد محاولات، جلسات قابلة للإلغاء بتدوير refresh)، health/ready، feature-flags. **مُختبر فعلياً:** OTP request→verify→JWT على قاعدة حقيقية.
  - `apps/worker`: Outbox publisher (التقاط بقفل، retry أسّي، dead letter) — يعمل.
  - CI GitHub Actions (يُفعَّل عند إنشاء remote — HUMAN-ACTIONS A1) + Dockerfiles إنتاج + deploy.sh.
  - lint ✅ typecheck ✅ tests ✅ (14 اختباراً: آلة الحالات + AuthService).

## ما يجري الآن

- **backend الـVertical Slice مكتمل وأخضر**: اختبار تكاملي J1 (11 اختباراً) يغطي:
  تسجيل OTP ← nearby (PostGIS) ← منيو ← سلة+تسعير خادمي ← طلب idempotent ←
  intent ← بوابة sandbox ← webhook موقع (توقيع/مبلغ/تكرار) ← قبول+Capture+ledger ←
  تجهيز ← جاهز ← رحلة بمحاكي GPS ← NEARBY بجيوفنس ← «وصلت» يدوي ← موقف ← طابور ←
  خرج الموظف ← تسليم برمز HMAC ← COMPLETED. سجل الحالات = 14 انتقالاً حرفياً.
  + عزل الفروع (403) + معالج accept_timeout في الـworker.
  الملف: `apps/api/src/slice-j1.integration.test.ts` (يتخطى نفسه بلا DATABASE_URL).

## التالي (لإغلاق بوابة المرحلة 2 بالكامل)

- واجهة الشريحة: `apps/customer-web` (Next.js) بصفحات P2/P4/P5/P6/P7 المصغرة من design/ بنفس tokens.css + لوحة فرع مبسطة B-03، ثم Playwright يقود الرحلة في المتصفح (بوابة docs/20 مرحلة 6).
- ملاحظة قرار: mock gateway في الذاكرة داخل عملية الـAPI — رفض الفرع يحرّر/يسترجع فوراً، أما timeout في الـworker فيكتفي بإنشاء refund pending (يعالجه processor المرحلة 5).

## قرارات محسومة (سجل تراكمي)

| # | القرار | المرجع |
|---|--------|--------|
| D1 | حزم المرحلة 1: contracts، database، auth، payments، geo، notifications، observability، tsconfig، eslint-config. حزمتا ui/mobile-ui تُنشآن في مرحلتي 3–4 | docs/09§5 |
| D2 | نموذج الأموال: (ب) Split/Marketplace وفق ترجيح docs/13§1 — يُبنى خلف PaymentAdapter بوضعي mock/production | docs/13§1 |
| D3 | كل اعتماد خارجي (دفع، SMS، خرائط/Routes، FCM) خلف Adapter Interface بتنفيذين mock وproduction؛ التبديل بمتغير بيئة | برومبت البناء §1 |
| D4 | جداول المؤجل (wallet، loyalty، مجدول...) تُنشأ في Prisma دون واجهات | docs/21§3 |
| D5 | Outbox يُنفَّذ عبر جدول background_jobs (job_type='domain_event') — قائمة جداول docs/10 مغلقة ولا تتضمن جدول outbox مستقلاً | docs/12§3 + docs/10 |
| D6 | عنوان docs/05 يقول «24 حالة» لكن التعداد الحرفي 25 (يشمل PARTIALLY_REFUNDED). القائمة الحرفية هي الحاكمة — اعتُمدت 25 حالة في contracts وPrisma enum | docs/05§1 |
| D7 | منفذ Postgres المحلي 5433 (لا 5432) — جهاز التطوير عليه PostgreSQL أصلي يحتل 5432 | بيئة محلية |
| D8 | أُوقفت عملية node قديمة (خادم pickly من محاولة سابقة كان يحتل 4000). يوجد أيضاً Supabase stack قديم على منافذ 54321-54324 لم نمسّه — يمكن إيقافه يدوياً لتحرير موارد | بيئة محلية |

## ملاحظات تشغيلية

- منصة التطوير الحالية: Windows 10 — docker-compose يشغّل postgres+postgis وredis وmailhog محلياً.
- المؤقت: لا remote للمستودع بعد؛ يُضاف عند إنشاء حساب GitHub (انظر HUMAN-ACTIONS.md).
