# HUMAN-ACTIONS.md — ما يتطلب فعلاً بشرياً

> كل ما لا يستطيع الذكاء الاصطناعي فعله نيابة عنك، بالترتيب الذي ستحتاجه.
> الصيغة: الخطوة ← الرابط ← ماذا تُدخل بالضبط ← أين تلصق الناتج.
> **المشروع يعمل الآن بالكامل محلياً بالمحاكيات دون أي بند من هذه القائمة.**

## المجموعة أ — مطلوبة قبل Staging

### A1. مستودع GitHub (للـCI)
- **الرابط:** https://github.com/new
- **ماذا تفعل:** أنشئ مستودعاً خاصاً باسم `pickly`، ثم:
  ```bash
  git remote add origin git@github.com:<حسابك>/pickly.git
  git push -u origin main
  ```
- **الناتج:** workflows الـCI تعمل تلقائياً عند أول push.

### A2. مشروع GCP وربط الفوترة
- **الرابط:** https://console.cloud.google.com/projectcreate
- **ماذا تفعل:** مشروعان `pickly-staging` و`pickly-production`، فعّل الفوترة، ثم أنشئ Service Account بدور `Editor` + `Secret Manager Admin` ونزّل مفتاح JSON.
- **أين يُلصق:** GitHub → Settings → Secrets → `GCP_SA_KEY_STAGING` / `GCP_SA_KEY_PRODUCTION`، ومعرف المشروع في `infra/terraform/environments/*.tfvars`.

### A3. الدومين وDNS
- **ماذا تفعل:** اشترِ `pickly.sa` (أو البديل المتاح) من مسجل سعودي معتمد (مثل نطاقات السعودية للـ.sa).
- **أين يُلصق:** قيم DNS تُنشئها Terraform لاحقاً (مخرجات `terraform output dns_records`) تُنسخ إلى لوحة المسجل.

## المجموعة ب — مطلوبة قبل الإنتاج (كلٌّ منها يعمل الآن بـmock)

### B1. عقد بوابة الدفع (نموذج Marketplace/Split — docs/13§1)
- **المرشحون:** HyperPay / Moyasar / Tap (اشترط: Apple Pay + مدى + Split Settlements + Auth/Capture).
- **ماذا تفعل:** وقّع العقد، أنشئ حساب sandbox ثم production، واحصل على: `API Key`، `Webhook Secret`.
- **أين يُلصق:** `.env` → `PAYMENT_PROVIDER=<اسم المزود>`، `PAYMENT_API_KEY=...`، `PAYMENT_WEBHOOK_SECRET=...` (وفي Secret Manager للسحابة).

### B2. مزود SMS (OTP)
- **المرشحون:** Unifonic / Msegat (مسجلان لدى CITC لأسماء المرسِل).
- **ماذا تفعل:** حساب + اسم مرسِل `Pickly` + مفتاح API.
- **أين يُلصق:** `.env` → `SMS_PROVIDER=<المزود>`، `SMS_API_KEY=...`، `SMS_SENDER_NAME=Pickly`.

### B3. Firebase / FCM (الإشعارات)
- **الرابط:** https://console.firebase.google.com
- **ماذا تفعل:** مشروع Firebase مرتبط بمشروع GCP، فعّل Cloud Messaging، نزّل `service-account.json` وملفات `google-services.json` (Android) و`GoogleService-Info.plist` (iOS).
- **أين يُلصق:** `.env` → `FCM_SERVICE_ACCOUNT_JSON` (المحتوى base64)، والملفان في `apps/customer-mobile/`.

### B4. خرائط Google (Routes API)
- **الرابط:** https://console.cloud.google.com/apis/library/routes.googleapis.com
- **ماذا تفعل:** فعّل Routes API + Maps SDK وأنشئ API Key مقيداً.
- **أين يُلصق:** `.env` → `ROUTES_API_KEY=...`، `GEO_PROVIDER=google`.

### B5. حسابات المتاجر ورفع التطبيق
- **Apple Developer:** https://developer.apple.com/programs/enroll/ (99$/سنة، يتطلب سجلاً تجارياً للحساب المؤسسي) → ضع `APPLE_TEAM_ID` في `apps/customer-mobile/eas.json`.
- **Google Play Console:** https://play.google.com/console/signup (25$ مرة واحدة).
- **الرفع:** الأوامر جاهزة: `pnpm --filter customer-mobile eas:build:ios` / `eas:build:android` ثم `eas submit`.

### B6. البيانات الضريبية / ZATCA
- **ماذا تفعل:** سجل ضريبي + قرار مُصدر الفاتورة النظامي (يعتمد على نموذج الأموال ب — راجع docs/13§7) مع محاسب قانوني.
- **أين يُلصق:** `.env` → `ZATCA_VAT_NUMBER=...` وبيانات المنشأة في لوحة الأدمن → الإعدادات.

### B7. تكامل Foodics (اختياري للطيار)
- **الرابط:** https://developers.foodics.com
- **ماذا تفعل:** حساب شريك + OAuth credentials.
- **أين يُلصق:** `.env` → `FOODICS_CLIENT_ID/SECRET`.

## سجل الحالة

| البند | الحالة |
|-------|--------|
| A1 GitHub | ✅ https://github.com/pharmjeed/new-pickly (رُفع 2026-07-09) |
| A2 GCP | ⬜ |
| A3 الدومين | ⬜ |
| B1 بوابة الدفع | ⬜ (يعمل mock) |
| B2 SMS | ⬜ (يعمل mock — الرمز يُطبع في اللوج وMailhog) |
| B3 FCM | ⬜ (يعمل mock) |
| B4 Routes | ⬜ (يعمل محاكي رحلة) |
| B5 المتاجر | ⬜ |
| B6 ZATCA | ⬜ |
| B7 Foodics | ⬜ |
