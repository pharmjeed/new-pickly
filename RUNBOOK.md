# RUNBOOK.md — تشغيل Pickly

> دليل التشغيل اليومي والحوادث. البيئة السحابية تُفعَّل بعد HUMAN-ACTIONS A2/A3.

## 1. التشغيل اليومي

### محلياً
```bash
docker compose up -d && pnpm dev           # api:4000 + worker
pnpm --filter @pickly/customer-web dev     # 3000 — واجهة العميل
pnpm --filter @pickly/merchant-web dev     # 3001 — بوابة التاجر
pnpm --filter @pickly/branch-ops dev       # 3002 — لوحة الفرع (/board /kds /shift /busy)
pnpm --filter @pickly/admin-web dev        # 3003 — لوحة الأدمن
pnpm --filter @pickly/site dev             # 3004 — الموقع التعريفي
```

### السحابة (بعد terraform apply)
- النشر: `pnpm deploy:staging` / `pnpm deploy:production` (يبني الصور، يدفعها، ينشر Cloud Run).
- الهجرات: تُنفَّذ قبل النشر: `DATABASE_URL=<prod> pnpm db:deploy` (عبر Cloud SQL Proxy).
- Staging مطابق للإنتاج بياناتٍ وإعداداً (بوابة docs/20 مرحلة 14).

## 2. المراقبة

| ماذا تراقب | أين |
|------------|-----|
| 5xx للـAPI وCPU قاعدة البيانات | تنبيهات Monitoring (Terraform ينشئها) |
| Jobs معلقة/فاشلة وDead Letters | لوحة الأدمن ← الصحة (`/v1/admin/health-ops`) |
| فروق مالية | حدث `finance.reconciliation_run` في analytics + تنبيه `risk.alert_raised` |
| webhooks غير معالجة | نفس شاشة الصحة — `unprocessed_webhooks` |

## 3. الحوادث الشائعة

### الدفع لا يكتمل (الطلبات عالقة PAYMENT_PENDING)
1. تحقق من webhooks: شاشة الصحة ← `unprocessed_webhooks`.
2. راجع `payment_webhook_events.process_error` لآخر الأحداث.
3. توقيع فاسد؟ تحقق من `PAYMENT_WEBHOOK_SECRET` في Secret Manager يطابق لوحة المزود.
4. البوابة نفسها معطلة؟ راجع status page للمزود — الطلبات القائمة تُستأنف تلقائياً عند وصول الـwebhook (idempotent).

### الفرع لا يستقبل الطلبات
1. حالة الفرع `paused/closed`؟ (وضع الازدحام أو وردية مغلقة) — لوحة الفرع ← الوردية.
2. worker يعمل؟ عداد القبول والرفض الآلي يعتمدان عليه — Cloud Run ← pickly-worker (min instances = 1).

### تكدس dead_letter_jobs
1. لوحة الأدمن ← الصحة ← افحص `error` لكل عنصر.
2. بعد إصلاح السبب: أعد إدراج الحمولة يدوياً في background_jobs (pending) وعلّم dead letter بـ`resolved_at`.

### تسريب زمن الخدمة (بطاقات حمراء كثيرة في الطابور)
مؤشر تشغيل ميداني لا تقني — أبلغ نجاح التجار؛ راجع `service_target_seconds` للفرع (M-05).

## 4. النسخ الاحتياطي والاستعادة

- **آلي:** Cloud SQL نسخ يومي 02:00 + Point-in-time recovery (Terraform). احتفاظ 14 نسخة.
- **استعادة كاملة:**
  ```bash
  gcloud sql backups list --instance=pickly-pg-production
  gcloud sql backups restore <BACKUP_ID> --restore-instance=pickly-pg-production
  ```
- **استعادة لنقطة زمنية:** `gcloud sql instances clone pickly-pg-production pickly-pg-pitr --point-in-time <TIMESTAMP>` ثم بدّل DATABASE_URL في Secret وأعد نشر api/worker.
- **اختبار الاستعادة (يوثَّق كل ربع سنة):** استنسخ لنقطة زمنية ← صوّب staging عليها ← شغّل suites الإلزامية ← دوّن الزمن والنتيجة هنا:

| التاريخ | النسخة | المدة | النتيجة |
|---------|--------|-------|---------|
| (يُملأ عند أول اختبار على بيئة سحابية) | | | |

## 5. Rollback

- **Cloud Run يحفظ المراجعات:**
  ```bash
  gcloud run revisions list --service=pickly-api-production
  gcloud run services update-traffic pickly-api-production --to-revisions=<REV>=100
  ```
- **الهجرات:** لا rollback تلقائياً للهجرات المطبقة (append-only) — الإصلاح بهجرة جديدة تصحيحية.
- **الويب:** نفس آلية Cloud Run لكل تطبيق ويب.

## 6. الأسرار

كلها في Secret Manager حصراً (`pickly-<env>-<NAME>`). التدوير: أضف إصداراً جديداً للسر ثم أعد نشر الخدمة (Cloud Run يقرأ `latest`). لا سر في git إطلاقاً — `.env` محلي فقط.

## 7. جهات الاتصال عند حادث

| الدور | من |
|-------|-----|
| المالك التشغيلي | (يُملأ) |
| بوابة الدفع — دعم | (من عقد B1) |
| مزود SMS — دعم | (من حساب B2) |
