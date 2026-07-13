-- عروض على الأصناف (M-11): سعر مخفّض للصنف ضمن نافذة اختيارية.
-- السعر الأصلي يبقى price_halalas ويُشطب للعميل؛ السعر الفعّال يُحسب خادمياً (BR-6).
ALTER TABLE "products"
  ADD COLUMN "sale_price_halalas" INTEGER,
  ADD COLUMN "sale_starts_at" TIMESTAMPTZ(6),
  ADD COLUMN "sale_ends_at" TIMESTAMPTZ(6);
