-- دعم كلمات المرور: تغيير و استرجاع الحساب
-- password_hash: nullable عند OTP signup، يُعيّن عند أول تغيير كلمة مرور
-- password_changed_at: لـtracking تاريخ آخر تغيير

ALTER TABLE "users" ADD COLUMN "password_hash" TEXT;
ALTER TABLE "users" ADD COLUMN "password_changed_at" TIMESTAMPTZ(6);
