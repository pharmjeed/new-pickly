-- بطاقات العميل المحفوظة (قرار المالك 2026-07-12) — Tokenization فقط (docs/17):
-- لا يُخزن رقم البطاقة ولا CVV أبداً؛ token البوابة + brand/last4/expiry للعرض.

CREATE TABLE "customer_cards" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "last4" TEXT NOT NULL,
    "exp_month" INTEGER NOT NULL,
    "exp_year" INTEGER NOT NULL,
    "holder_name" TEXT,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_cards_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "customer_cards_token_key" ON "customer_cards"("token");
CREATE INDEX "customer_cards_user_id_idx" ON "customer_cards"("user_id");

ALTER TABLE "customer_cards" ADD CONSTRAINT "customer_cards_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
