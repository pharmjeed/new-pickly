-- نقطة الموقف على الخريطة: يثبتها التاجر بالنقر ويتوجه إليها العميل مباشرة (نمط أوبر)
ALTER TABLE "parking_spots" ADD COLUMN "lat" DOUBLE PRECISION;
ALTER TABLE "parking_spots" ADD COLUMN "lng" DOUBLE PRECISION;
