# نظام OTP (One-Time Password) — Pickly

## نظرة عامة

تم تنفيذ نظام OTP شامل لتطبيق العميل مع 3 حالات استخدام:

1. **التسجيل** (Sign up) — OTP للتحقق من رقم الهاتف الجديد
2. **تغيير كلمة المرور** — OTP لتحديث كلمة المرور الموجودة
3. **استرجاع الحساب** (نسيان كلمة المرور) — OTP لإعادة تعيين الحساب

---

## الـ SMS Providers

### 1. Orbit SMS (الموصى به للسعودية)

**الإعدادات المطلوبة:**
```bash
SMS_PROVIDER=orbit
SMS_API_TOKEN=<your_api_token_from_app.mobile.net.sa>
SMS_SENDER_NAME=Pickly  # اسم المرسل (أقصى 11 حرف)
```

**الـ Endpoint:** `https://app.mobile.net.sa/api/v1/send`

**الحساب:** app.mobile.net.sa (تم فتحه بقرار المالك)

### 2. Unifonic (بديل)

**الإعدادات:**
```bash
SMS_PROVIDER=unifonic
SMS_API_KEY=<your_unifonic_api_key>
SMS_SENDER_NAME=Pickly
```

### 3. Mock (للتطوير)

**الإعدادات:**
```bash
SMS_PROVIDER=mock  # الافتراضي
```

أثناء التطوير، يتم طباعة الرموز في اللوجات و Mailhog (localhost:1025).

---

## الـ Database Schema

### جدول `otp_requests` (موجود)
```sql
id          UUID PRIMARY KEY
phone       VARCHAR
code_hash   VARCHAR (SHA256)
attempts    INT DEFAULT 0
max_attempts INT DEFAULT 5
expires_at  TIMESTAMPTZ
consumed_at TIMESTAMPTZ? (NULL = لم يستخدم بعد)
request_ip  VARCHAR?
created_at  TIMESTAMPTZ
```

### تعديلات على جدول `users` (جديد)
```sql
password_hash       VARCHAR? (NULL عند OTP signup)
password_changed_at TIMESTAMPTZ? (متى آخر تغيير)
```

---

## الـ API Endpoints

### 1. التسجيل (Signup)

#### طلب OTP
```http
POST /otp/request
Content-Type: application/json

{
  "phone": "+966501234567"
}
```

**الرد:**
```json
{
  "request_id": "550e8400-e29b-41d4-a716-446655440000",
  "retry_after_seconds": 60
}
```

#### التحقق و الدخول
```http
POST /otp/verify
Content-Type: application/json

{
  "phone": "+966501234567",
  "code": "1234"
}
```

**الرد:**
```json
{
  "access_token": "eyJ...",
  "refresh_token": "...",
  "is_new_user": true
}
```

---

### 2. تغيير كلمة المرور (Change Password)

**المتطلب:** المستخدم يجب أن يكون مسجل دخول بالفعل (Bearer token)

#### طلب OTP
```http
POST /password/change-request
Content-Type: application/json

{
  "phone": "+966501234567"
}
```

**الرد:**
```json
{
  "request_id": "...",
  "retry_after_seconds": 60
}
```

#### التحقق و التحديث
```http
POST /password/change-verify
Content-Type: application/json

{
  "phone": "+966501234567",
  "code": "1234",
  "new_password": "SecurePassword123!"
}
```

**الرد:**
```json
{
  "success": true
}
```

---

### 3. استرجاع الحساب (Password Reset)

**المتطلب:** لا يحتاج تسجيل دخول (لنسيان كلمة المرور)

#### طلب OTP
```http
POST /password/reset-request
Content-Type: application/json

{
  "phone": "+966501234567"
}
```

**الرد:**
```json
{
  "request_id": "...",
  "retry_after_seconds": 60
}
```

#### التحقق و الدخول
```http
POST /password/reset-verify
Content-Type: application/json

{
  "phone": "+966501234567",
  "code": "1234",
  "new_password": "NewPassword123!"
}
```

**الرد:** (مثل OTP/verify)
```json
{
  "access_token": "eyJ...",
  "refresh_token": "...",
  "is_new_user": false
}
```

---

## معلومات الأمان (Security)

### تجزئة OTP
- الرموز لا تُخزن بشكل مباشر
- استخدام SHA256 مع salt (`pickly-otp:`)
- مقارنة timing-safe لمنع timing attacks

### تجزئة كلمات المرور
- استخدام Argon2id (قوي)
- معاملات قياسية: 3 iterations، 65MB memory

### حدود الأمان (BR-13)
- **OTP TTL:** 5 دقائق (300 ثانية)
- **محاولات OTP:** 5 محاولات قصوى
- **Rate limiting:** 5 طلبات كحد أقصى لكل ساعة لكل رقم

### Idempotency
- استخدام `Idempotency-Key` على جميع العمليات المالية (مستقبلاً)

---

## الـ Development Setup

### 1. تثبيت المتطلبات
```bash
pnpm install
```

### 2. الهجرة
```bash
pnpm db:migrate  # تطبيق migration جديد
```

### 3. البدء
```bash
pnpm dev  # يبدأ API + Worker + PostgreSQL + Redis
```

### 4. الاختبار
```bash
pnpm test  # تشغيل جميع الاختبارات
pnpm test auth  # فقط اختبارات المصادقة
```

---

## الـ Environment Variables

```bash
# SMS Provider
SMS_PROVIDER=orbit            # orbit | unifonic | mock
SMS_API_TOKEN=<token>         # للـ Orbit
SMS_API_KEY=<key>             # للـ Unifonic
SMS_SENDER_NAME=Pickly

# JWT
JWT_SECRET=your-secret-key

# Database
DATABASE_URL=postgresql://...

# Redis
REDIS_URL=redis://localhost:6379

# Mail (للتطوير)
SMTP_HOST=localhost
SMTP_PORT=1025
```

---

## الـ Code Structure

```
packages/
  auth/src/
    otp.ts                 # توليد OTP، hashing، passwords
    sms-adapter.ts         # SMS providers (Orbit, Unifonic, Mock)
    tokens.ts              # JWT signing/verification
  contracts/src/
    auth.ts                # DTOs للـ OTP والـ passwords
  database/
    prisma/
      schema.prisma        # User + OtpRequest models
      migrations/
        20260803010000_*   # Migration جديد للـ passwords

apps/api/src/
  modules/auth/
    routes.ts              # Endpoints الـ 6
    service.ts             # Business logic
    repository.ts          # Database queries
    service.test.ts        # اختبارات شاملة
```

---

## الـ Testing

### Unit Tests
```bash
pnpm test src/modules/auth/service.test.ts
```

### Test Cases المغطاة
- ✅ OTP generation و transmission
- ✅ Code verification و timing-safe comparison
- ✅ Rate limiting و rate windows
- ✅ Password hashing و verification
- ✅ Session management و token refresh
- ✅ Error handling (AUTH-1001 to AUTH-1008)

---

## الـ Error Codes

| Code | المعنى |
|------|--------|
| AUTH-1001 | المستخدم غير موجود (للـ change/reset) |
| AUTH-1002 | رمز OTP خاطئ |
| AUTH-1003 | لا يوجد OTP نشط أو انتهت صلاحيته |
| AUTH-1004 | تجاوز حد المحاولات أو Rate limiting |
| AUTH-1005 | Refresh token غير صالح |
| AUTH-1007 | الحساب محظور أو محذوف |
| AUTH-1008 | بيانات دخول فريق الفرع خاطئة |

---

## الخطوات التالية

### Phase 2 (ملخص من HUMAN-ACTIONS.md)
- [ ] تفعيل Orbit SMS بالـ live API token (بدلاً من mock)
- [ ] تجربة end-to-end على staging
- [ ] تسجيل الـ Sender ID مع أوبت
- [ ] مراقبة معدلات الإرسال و الأخطاء

### الـ Analytics & Monitoring
- [ ] تتبع نسب النجاح للـ OTP
- [ ] مراقبة حالات الفشل و الأسباب
- [ ] إنذارات للـ rate limiting و الإساءة

---

## الـ Documentation

- `docs/11` — Authentication & Authorization (الـ OTP، المصادقة)
- `docs/17` — Security & Encryption (كلمات المرور، Argon2)
- `CLAUDE.md` — قواعد المشروع الإلزامية
