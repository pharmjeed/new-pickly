-- الاستلام المجدول من دوام الأسبوع (BR-5): طول الفترة والسعة الموحدة على مستوى الفرع —
-- الفترات تتولّد من branch_hours بدل الإدخال اليدوي ليوم واحد.
ALTER TABLE "branch_pickup_settings"
  ADD COLUMN "scheduled_slot_minutes" INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN "scheduled_capacity" INTEGER NOT NULL DEFAULT 6;
