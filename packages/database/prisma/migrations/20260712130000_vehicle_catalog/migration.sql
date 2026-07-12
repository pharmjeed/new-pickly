-- قاعدة بيانات السيارات: ماركات وموديلات السوق السعودي (شاشة «أضف سيارة جديدة»)
CREATE TABLE "vehicle_makes" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name_ar" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "vehicle_makes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "vehicle_makes_key_key" ON "vehicle_makes"("key");

CREATE TABLE "vehicle_models" (
    "id" UUID NOT NULL,
    "make_id" UUID NOT NULL,
    "name_ar" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "vehicle_models_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "vehicle_models_make_id_idx" ON "vehicle_models"("make_id");
CREATE UNIQUE INDEX "vehicle_models_make_id_name_ar_key" ON "vehicle_models"("make_id", "name_ar");

ALTER TABLE "vehicle_models" ADD CONSTRAINT "vehicle_models_make_id_fkey"
    FOREIGN KEY ("make_id") REFERENCES "vehicle_makes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
