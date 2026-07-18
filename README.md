# Pickly — بيكلي

سوق طلبات واستلام من السيارة متكامل: العميل يطلب ويدفع ويقود، والفرع يجهّز موقوتاً بوصوله ويسلّم لسيارته برمز تحقق — **بلا مناديب**.

> الوثائق الحاكمة في `docs/` (00–21) · دستور التنفيذ في `CLAUDE.md` · حالة البناء في `BUILD-STATE.md` · ما يتطلب فعلاً بشرياً في `HUMAN-ACTIONS.md`.

## التشغيل المحلي (كل شيء بالمحاكيات — لا مفاتيح مطلوبة)

```bash
# المتطلبات: Node ≥20، pnpm ≥9، Docker
cp .env.example .env        # القيم الافتراضية تعمل كما هي
pnpm i
docker compose up -d        # postgres+postgis · redis · mailhog
pnpm db:migrate             # هجرات Prisma
pnpm db:seed                # 3 مطاعم سعودية × فروع × قوائم + حسابات demo
pnpm dev                    # api (4000) + worker
```

- **OTP في التطوير:** الرمز الثابت `1234` (OTP_DEV_FIXED_CODE)، أو راقب Mailhog على http://localhost:8025.
- **الدفع:** بوابة mock داخلية تحاكي Auth/Capture/Refund/Webhooks الموقعة — تفشل حتمياً للمبالغ المنتهية بـ99 هللة.
- **ETA:** محاكي رحلة يتحرك بسرعة واقعية نحو الفرع.

## حسابات الـdemo (بعد الـseed)

| الدور | الدخول |
|-------|--------|
| عميل (سلطان — كامري 8241) | جوال `0500000001` · OTP `1234` |
| عميل (نورة — يوكن 3319) | جوال `0500000002` · OTP `1234` |
| مالك بيست برجر | جوال `0520000001` |
| فريق الفرع | كود فرع `101` · مستخدم `cashier101` (أو kitchen101/handoff101/manager101) · PIN `1234` |
| Super Admin | جوال `0510000001` |

## الهيكل

```
apps/      api · worker · (customer-mobile · customer-web · merchant-web · branch-ops · admin-web — مراحل قادمة)
packages/  contracts · database · auth · payments · geo · notifications · observability · tsconfig · eslint-config
docs/      الوثائق الحاكمة 00–21
design/    حزمة الواجهات HTML المعتمدة (المرجع البصري الحرفي) + identity/
infra/     terraform · docker · monitoring (مرحلة 9)
```

## أوامر

```bash
pnpm lint && pnpm typecheck && pnpm test   # بوابة الجودة
pnpm openapi:gen                            # توليد openapi.json من العقود
pnpm db:reset                               # إعادة تهيئة قاعدة البيانات
```
