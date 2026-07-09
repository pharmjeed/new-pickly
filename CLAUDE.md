# CLAUDE.md — تعليمات مشروع Pickly

> يوضع في جذر المستودع. كل جلسة Claude Code تقرأه أولاً.

## التعريف
Pickly: سوق طلبات واستلام من السيارة متكامل — تجربة تطبيقات التوصيل كاملة **بلا مناديب**. العميل يطلب ويدفع ويقود، والفرع يجهّز موقوتاً بوصوله ويسلّم لسيارته برمز تحقق.

## ما يدخل وما لا يدخل
- النطاق الكامل: `docs/01-product-scope.md`. 
- **ممنوع بناء:** أي شيء متعلق بمناديب/توصيل، طلب من الطاولة، حجوزات، ولاء ضخم، محفظة، ALPR، Microservices، Kubernetes، تعدد دول/عملات.
- أي خاصية غير موجودة في `docs/` = خارج النطاق؛ عدّل الوثيقة أولاً ثم ابنِ.

## المعمارية والـStack (مقفولان — docs/09)
Modular Monolith + Event-Driven Jobs · RN/Expo (Dev Build) للعميل · Next.js لكل الويب · Fastify + TS + Zod + Prisma + OpenAPI · PostgreSQL + PostGIS · Redis + BullMQ · GCP (Cloud Run/SQL/Memorystore) مع Cloud Portability (Docker/Terraform/S3-abstraction) · pnpm monorepo بالهيكل المحدد في docs/09§5.

## قواعد تعدد التجار (غير قابلة للتفاوض)
1. كل استعلام تاجر عبر Tenant Scope (merchant_id/branch_id) في طبقة Repository.
2. لا استعلام خام يتجاوز العزل. Super Admin فقط، مع Audit Log.
3. اختبارات العزل إلزامية لكل وحدة تمس بيانات تاجر.

## قواعد الطلب والدفع
1. الحالات حصراً من `docs/05` (24 حالة) — أي حالة أخرى خطأ برمجي.
2. كل انتقال عبر خدمة State Machine + سجل append-only + حدث Outbox في نفس المعاملة.
3. التسعير خادمي فقط (pricing_quotes) — لا حساب سعر في أي واجهة.
4. Idempotency-Key على كل POST مالي/إنشائي. تحديث الصفحة لا ينشئ طلباً ثانياً.
5. لا تخزين بطاقات. Webhooks موقعة تُخزن خاماً. Ledger مستقل. Reconciliation يومي.
6. «وصل» لا يتم إلا بتأكيد العميل اليدوي (docs/14).

## قواعد الأمن
docs/17 كاملة. أبرزها: اللوحة مشفرة ومقنّعة خارج الطلب النشط؛ الموقع أثناء الطلب النشط فقط ويُحذف خامه بعد 30 يوماً؛ MFA للأدوار الحساسة؛ Secrets في Secret Manager فقط.

## أسلوب الكود
TypeScript strict في كل الحزم؛ ممنوع `any` بلا تعليق مبرر · Zod لكل DTO، والأنواع من `packages/contracts` فقط — لا أنواع مكررة · كل وحدة بالبنية: Domain/Service/Repository/Routes/DTO/Permissions/Events/Tests · أسماء الجداول والحقول كما في docs/10 حرفياً · رسائل الأخطاء ثنائية اللغة بأكواد docs/11§10 · RTL أولاً في كل واجهة.

## قواعد الاختبار
لا PR بدون اختبارات وحدته + suites الإلزامية (Isolation, Idempotency, State Machine) خضراء · E2E للـVertical Slice يبقى أخضر دائماً · تفاصيل docs/19.

## أوامر التشغيل
```bash
pnpm i                 # تثبيت
pnpm db:migrate        # هجرات Prisma
pnpm dev               # docker-compose (pg, redis) + api + worker
pnpm dev:customer      # Expo dev build
pnpm dev:web           # merchant/branch/admin حسب --filter
pnpm test              # كل الاختبارات
pnpm test:isolation    # عزل التجار
pnpm lint && pnpm typecheck
pnpm openapi:gen       # توليد العقود من contracts
```

## ملفات محظور تعديلها دون موافقة صريحة من المالك
`docs/**` (الوثائق الحاكمة) · `packages/database/migrations/**` المطبقة · `packages/contracts/**` (تغيير عقد = PR مستقل بمراجعة) · `infra/terraform/**` · هذا الملف.

## طريقة العمل بالوكلاء
16 وكيلاً (Product/PRD، UX Flows، Design System، Backend Architecture، Database، Customer Mobile، Merchant Portal، Branch Operations، Super Admin، Payment، Geo/ETA، Integrations، QA، Security، DevOps، Code Review). القاعدة: كل وكيل في Branch + Worktree مستقل، بـTicket واضح، ملفات مسموحة، Acceptance Criteria، اختبارات مطلوبة، PR، ومراجعة قبل الدمج — **لا عمل عشوائي على نفس الملفات.**

## Definition of Done
الكود مطابق للوثائق الحاكمة · اختبارات خضراء شاملة suites الإلزامية · لا أزرار غير مربوطة ولا APIs يتيمة · OpenAPI محدث · RTL سليم · Audit/Events مبثوثة للانتقالات · مراجعة Code Review Agent ثم موافقة بشرية · يعمل على Staging المطابق للإنتاج.
