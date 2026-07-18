-- PIN موظف الفرع مشفراً قابلاً للفك (AES-GCM بمفتاح الخادم) — لعرضه وتغييره
-- من لوحة السوبر أدمن بقرار المالك 2026-07-18. التحقق عند الدخول يبقى على pin_hash.
ALTER TABLE "merchant_staff" ADD COLUMN "pin_encrypted" TEXT;
