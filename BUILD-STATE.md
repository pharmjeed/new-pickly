# BUILD-STATE.md — حالة بناء Pickly

> نقطة الاستئناف لأي جلسة جديدة. حدِّث هذا الملف قبل كل commit.
> آخر تحديث: 2026-07-09

## الحالة العامة

| المرحلة | الحالة |
|---------|--------|
| 1. التأسيس (Monorepo، Docker، CI، contracts، database، Auth، Seed) | ✅ بوابة خضراء |
| 2. Vertical Slice (رحلة J1 كاملة E2E) | ✅ بوابة خضراء |
| 3. توسيع العميل (الويب مكتمل حرفياً · Expo متبقٍ) | 🔶 جزئية |
| 4. الفرع والتاجر (board+KDS+وردية+ازدحام ✅ · merchant-web قيد وكيل) | 🔶 جارية |
| 5. المالية (intent/ledger/refunds processor/settlements/reconciliation) | ✅ |
| 6. الموقع (rحلة/ETA/geofence/dwell/طابور/بدائل يدوية/retention — الميداني بالطيار) | ✅ |
| 7. Super Admin API ✅ · واجهة الأدمن والموقع قيد وكيلين | 🔶 جارية |
| 8. الجودة (suites إلزامية ✅ · Playwright ✅ بالـCI · k6 كتب ولم يُشغَّل) | 🔶 جزئية |
| 9. البنية للنشر (Terraform + Dockerfiles + deploy.sh + RUNBOOK) | ✅ كود جاهز — التفعيل بعد A2 |

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

## ما أُنجز في المرحلة 2 (بوابتها خضراء — تحقق مزدوج)

1. **Backend كامل للرحلة J1** — اختبار تكاملي (11 اختباراً، `apps/api/src/slice-j1.integration.test.ts`):
   تسجيل OTP ← nearby (PostGIS) ← منيو ← سلة+تسعير خادمي ← طلب idempotent ←
   intent ← بوابة sandbox ← webhook موقع (توقيع/مبلغ/تكرار) ← قبول+Capture+ledger ←
   رحلة بمحاكي GPS ← NEARBY بجيوفنس ← «وصلت» يدوي ← طابور ← تسليم برمز HMAC ← COMPLETED.
   سجل الحالات = 14 انتقالاً حرفياً + عزل الفروع + accept_timeout في الـworker.
2. **واجهات الشريحة**: `apps/customer-web` (Next.js — P2/P3/P4/P5/P6/P7 مصغرة بـtokens.css حرفياً،
   وضع قيادة داكن، مؤشر الخطوط الثلاثة، بنك النصوص) + `apps/branch-ops` (B-01 دخول + B-03 لوحة
   بألوان أولوية البطاقات وبطاقة السيارة الكبيرة).
3. **بوابة Playwright** (`tests/e2e/j1-happy-path.spec.ts`): الرحلة كاملة في المتصفح بسياقين
   (عميل + فرع) — خضراء مرتين: بخوادم مُعادة الاستخدام (33s) وبتشغيل بارد كامل (36s).

## ما أُنجز في المرحلة 3 (الويب) + بداية المرحلة 5

- **التحويل الحرفي للتصميم (7 وكلاء متوازون، بوابة Playwright بقيت خضراء 33s بعده):**
  - customer-web: P2 (C-05→C-07 بخانات OTP الست وعداد إعادة الإرسال)، P3 (C-09 برأس
    الموقع والبحث المعطل «قريباً» وskeletons وtabbar)، P4 (C-19→C-25 بغلاف المطعم وشرائح
    التصنيفات وSheet التخصيص الكامل min/max + كمية + ملاحظة)، P5 (C-26 بحذف العناصر
    والحالة الفارغة)، P6 (C-28→C-37 بالصفحة الموحدة وSheet السيارة وحالة النجاح الختامية)،
    P7 (C-38→C-51: كل الحالات + نبضة الرصد + Sheet الموقف + شريط الخطوات السبع بعناوينه).
  - branch-ops: B-01 (numpad + جهاز مسمى) وB-03 (ترويسة داكنة بساعة حية، تبويبات بعدادات،
    عداد BR-1 تنازلي MM:SS بشريط نسبة، طابور الوصول بتجاوز المستهدف الأحمر، بطاقة السيارة 28px).
  - كل الصفحات: tokens.css حصراً، pkmeta لم يُنقل، data-testids محفوظة.
- **API**: وحدة Reviews (BR-11: 5 أبعاد، نافذة 7 أيام، idempotent) على /v1/orders/:id/review.
- **Worker (أساس المرحلة 5)**: refund-processor (تحرير/استرجاع عند البوابة + ledger + REFUNDED/PARTIALLY)
  · no-show (BR-3: تذكير 15د، عتبة 45د، استرجاع بلا رسم الخدمة، إشارة مخاطر عند 3/30يوم)
  · settlements (docs/13§6: دورة أسبوعية، سطور، payout، حدث settlement.generated) — تُجدول عند READY.

## التالي (حسب الأولوية)

1. انتظار/مراجعة وكلاء: merchant-web (بوابة التاجر) · admin-web (لوحة الأدمن) · site (التعريفي) —
   بعدها: pnpm install + typecheck شامل + Playwright ثم commit.
2. تطبيق Expo/RN للعميل (P1 التهيئة + الشاشات native) — أكبر متبقٍ. الويب يغطي J4 كاملة الآن.
3. **Realtime Gateway (docs/11§9)**: قنوات WS (order/branch/merchant/admin) عبر Redis pub/sub —
   الواجهات كلها polling حالياً (يعمل، لكنه بند عقد معلق) + هدف k6: 2000 اتصال WS.
4. تقييم P8 UI (Sheet فوق /track بعد الاكتمال) — endpoint جاهز.
5. تشغيل k6 فعلياً وتوثيق النتائج · التقرير النهائي (التغطية مقابل الوثائق + قائمة الـmocks).

## بنود معلقة موثقة

- WS Realtime (أعلاه) · اختبارات ميدانية للجيوفنس (تتم في الطيار — docs/19§4) ·
  order_cap وPIN المدير في شاشة الازدحام (المخطط يدعم order_cap) ·
  فاتورة ZATCA فعلية (تنتظر B6) · تكامل Foodics (مرحلة 12 — جداول integrations جاهزة).

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
