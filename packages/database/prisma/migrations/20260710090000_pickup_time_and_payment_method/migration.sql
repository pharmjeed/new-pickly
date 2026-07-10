-- تفعيل مرحلة 2: وقت الاستلام (asap|later|scheduled — FR-C06) ووسيلة الدفع (card|wallet — C-33)
ALTER TABLE "orders" ADD COLUMN "pickup_time" TEXT NOT NULL DEFAULT 'asap';
ALTER TABLE "payment_intents" ADD COLUMN "method" TEXT NOT NULL DEFAULT 'card';
