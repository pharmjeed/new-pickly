-- قواعد append-only — docs/10§4:
-- order_status_history · audit_logs · payment_webhook_events «بلا UPDATE/DELETE صلاحيةً».
-- تُنفَّذ بـtriggers لأن مالك الجدول (مستخدم التطبيق) لا تقيده REVOKE.

CREATE OR REPLACE FUNCTION pickly_forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'الجدول % append-only — لا UPDATE/DELETE (docs/10§4)', TG_TABLE_NAME
    USING ERRCODE = 'raise_exception';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER order_status_history_append_only
  BEFORE UPDATE OR DELETE ON order_status_history
  FOR EACH ROW EXECUTE FUNCTION pickly_forbid_mutation();

CREATE TRIGGER audit_logs_append_only
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION pickly_forbid_mutation();

-- payment_webhook_events: الإدراج خام append-only، لكن processed_at/process_error
-- حقلا معالجة يحدّثهما الـworker — نمنع تعديل الحمولة الخام والحذف فقط.
CREATE OR REPLACE FUNCTION pickly_forbid_webhook_mutation() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'payment_webhook_events append-only — لا DELETE (docs/13§4-3)';
  END IF;
  IF NEW.payload IS DISTINCT FROM OLD.payload
     OR NEW.provider IS DISTINCT FROM OLD.provider
     OR NEW.event_ref IS DISTINCT FROM OLD.event_ref
     OR NEW.signature IS DISTINCT FROM OLD.signature
     OR NEW.received_at IS DISTINCT FROM OLD.received_at THEN
    RAISE EXCEPTION 'payment_webhook_events: الحمولة الخام غير قابلة للتعديل (docs/13§4-3)';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER payment_webhook_events_append_only
  BEFORE UPDATE OR DELETE ON payment_webhook_events
  FOR EACH ROW EXECUTE FUNCTION pickly_forbid_webhook_mutation();
