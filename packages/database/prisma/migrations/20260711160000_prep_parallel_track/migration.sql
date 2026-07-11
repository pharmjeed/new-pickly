-- مسار التجهيز الموازي (docs/05§3): رحلة العميل يجوز أن تسبق READY،
-- فلا يجوز أن تُجمِّد حالةُ الرحلة (ON_THE_WAY/ARRIVED) تقدمَ التجهيز.
-- preparing_at يسجل بدء التحضير كحقيقة مستقلة عن order_status.
ALTER TABLE "orders" ADD COLUMN "preparing_at" TIMESTAMPTZ(6);
