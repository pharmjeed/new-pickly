-- عتبة الدقيقة الواحدة (أُضيفت مع مسار أُلغي لاحقاً — تبقى لأن الهجرة طُبقت على قاعدة الإنتاج
-- وقيم enum في PostgreSQL لا تُحذف؛ القيمة غير مستخدمة في الكود الحالي وبلا أي أثر)
ALTER TYPE "ArrivalEventType" ADD VALUE IF NOT EXISTS 'eta_threshold_1';
