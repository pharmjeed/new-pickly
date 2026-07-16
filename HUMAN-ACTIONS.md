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

### ✅ منشور فعلياً على Oracle (2026-07-09)
- **بيكلي يعمل الآن على الإنترنت:** IP السيرفر `193.122.83.224` (Oracle Ampere A1 · 4 أنوية · 24GB · جدة).
- الروابط: العميل `:3000` · التاجر `:3001` · الفرع `:3002` · الأدمن `:3003` · الموقع `:3004`.
- systemd يعيد تشغيل الحزمة تلقائياً بعد أي reboot. المفاتيح في `~/.oci/` على جهازك.
- **🔒 تنظيف أمني موصى به:** بما أني رأيت مفتاح API الخاص، احذفه من Oracle (My profile ← API keys ← احذف بصمة `0b:e4...`) وأنشئ غيره وقت تشغيل أوامر OCI مستقبلاً. مفتاح SSH للسيرفر (`~/.oci/pickly_vm_ssh`) يبقى — لا تشاركه.
- **الثبات:** IP قد يتغير لو أوقفت السيرفر؛ لتثبيته اجعله Reserved IP من لوحة Oracle، أو اربط دومينك عليه لاحقاً.

### A2-بديل مؤقت (مجاني): سيرفر Oracle Always Free لبيئة التطوير/العرض
> يغني عن GCP **أثناء التطوير فقط** — الإنتاج الحقيقي يبقى A2 أدناه.
- **الرابط:** https://signup.oraclecloud.com — اختر Home Region: **Saudi Arabia West (Jeddah)** (لا يمكن تغييرها لاحقاً). البطاقة للتحقق فقط.
- **أنشئ السيرفر:** Compute → Create Instance → Image: **Ubuntu 22.04** → Shape: **Ampere A1 Flex** بـ**4 OCPU / 24GB** (ضمن Always Free) → نزّل مفتاح SSH.
  - لو ظهر «Out of capacity»: جرّب Availability Domain آخر أو أعد المحاولة لاحقاً — شائع في المجاني.
- **افتح المنافذ:** Networking → VCN → Security List → Add Ingress Rules: TCP للمنافذ `3000-3004` و`4000` من `0.0.0.0/0`.
- **شغّل كل شيء بأمر واحد** (من داخل السيرفر عبر SSH):
  ```bash
  curl -fsSL https://raw.githubusercontent.com/pharmjeed/new-pickly/main/infra/vm/setup-vm.sh | bash
  ```
- **الناتج:** الروابط الخمسة على IP السيرفر تعمل بالمحاكيات (OTP=1234، دفع تجريبي) — شاركها مع من تريد.

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

### B8. إشعارات تطبيق الفرع (Push والجهاز مقفول) — عبر Expo
> الكود جاهز بالكامل (الغلاف + الخادم). الإشعار يُفعَّل بمجرد بناء التطبيق بمعرّف EAS.
- **الأساس (مرة واحدة):** `eas login` ثم من `mobile-apps/branch`: `eas init` (يكتب `projectId` في app.json) ثم أعد البناء — بدون `projectId` لا يصدر توكن Push.
- **آيباد/آيفون:** لا شيء إضافي — `eas build -p ios` يهيئ مفتاح APNs تلقائياً مع حساب Apple Developer (نفس متطلب B5 للتثبيت أصلاً).
- **أندرويد:** مشروع Firebase (نفس B3) → Project Settings → Service accounts → نزّل مفتاح الخدمة، ثم من `mobile-apps/branch`: `eas credentials -p android` → Google Service Account → ارفع الملف. وضَع `google-services.json` في `mobile-apps/branch/` وأضف `"googleServicesFile": "./google-services.json"` تحت `android` في app.json.
- **الناتج:** تابلت الفرع يرن بإشعار نظامي «طلب جديد وصل» حتى وشاشته مقفلة.

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
| B8 إشعارات تطبيق الفرع | ⬜ (الكود جاهز — ينقص `eas init` وإعادة البناء) |
