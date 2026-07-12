-- حدث «وصل لنقطة الموقف» — GPS العميل بلغ النقطة التي ثبتها المطعم على الخريطة
ALTER TYPE "ArrivalEventType" ADD VALUE IF NOT EXISTS 'reached_parking_spot';
