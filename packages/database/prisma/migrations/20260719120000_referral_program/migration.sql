-- برنامج دعوة الأصدقاء + تفعيل نقاط المكافآت (قرار المالك 2026-07-19):
-- كود دعوة دائم لكل عميل، ومرجع الداعي، وختم صرف المكافأة (مرة واحدة عند أول طلب مكتمل).
-- أعمدة nullable — آمنة على البيانات القائمة.

ALTER TABLE "customer_profiles" ADD COLUMN "referral_code" TEXT;
ALTER TABLE "customer_profiles" ADD COLUMN "referred_by_user_id" UUID;
ALTER TABLE "customer_profiles" ADD COLUMN "referral_rewarded_at" TIMESTAMPTZ(6);

CREATE UNIQUE INDEX "customer_profiles_referral_code_key" ON "customer_profiles"("referral_code");

ALTER TABLE "customer_profiles" ADD CONSTRAINT "customer_profiles_referred_by_user_id_fkey"
  FOREIGN KEY ("referred_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- علما النقاط والإحالة يظهران مفعّلين فور النشر — الإيقاف من لوحة الأدمن (A-23)
INSERT INTO "feature_flags" ("id", "key", "enabled", "updated_at")
VALUES
  ('a1b2c3d4-0001-4000-8000-000000000001', 'loyalty_points', true, now()),
  ('a1b2c3d4-0001-4000-8000-000000000002', 'referral_program', true, now())
ON CONFLICT ("key") DO NOTHING;
