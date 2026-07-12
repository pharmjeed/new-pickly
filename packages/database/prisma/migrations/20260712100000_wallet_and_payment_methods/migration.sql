-- محفظة بيكلي وطرق الدفع المدارة (قرار المالك 2026-07-12 — docs/01§1):
-- المصروف من المحفظة على كل intent + نوع قيد wallet_redemption في الـLedger.
-- عمود بـdefault — آمنة على البيانات القائمة.

ALTER TABLE "payment_intents" ADD COLUMN "wallet_applied_halalas" INTEGER NOT NULL DEFAULT 0;

ALTER TYPE "TransactionType" ADD VALUE 'wallet_redemption';
