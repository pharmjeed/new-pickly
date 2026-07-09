# 12 — أحداث النطاق (Domain Events)

المصدر السابق: 05، 09، 11

---

## 1. الأحداث (قائمة مغلقة)

```text
order.created
payment.authorized
payment.failed
merchant.order_received
merchant.order_accepted
merchant.order_rejected
order.preparing
order.ready
pickup.trip_started
pickup.eta_updated
pickup.customer_nearby
pickup.customer_arrived
handoff.started
handoff.completed
order.completed
order.cancelled
refund.requested
refund.completed
settlement.generated
notification.failed
webhook.failed
```

(امتدادات مسموحة ضمن نفس الأسماء العائلية عند الحاجة: `order.no_show`, `order.change_requested`, `order.change_resolved`, `subscription.renewed`, `risk.alert_raised` — تُضاف هنا قبل استخدامها.)

## 2. مغلف الحدث (إلزامي)

```json
{
  "event_id": "uuid",
  "name": "pickup.customer_arrived",
  "version": 1,
  "timestamp": "ISO-8601",
  "aggregate_type": "order",
  "aggregate_id": "uuid",
  "merchant_id": "uuid|null",
  "branch_id": "uuid|null",
  "payload": {},
  "idempotency_key": "..."
}
```

## 3. قواعد النشر والمعالجة

1. **Outbox Pattern:** الحدث يُكتب في نفس معاملة DB مع التغيير، وWorker ينشره — لا حدث بلا سجل ولا سجل بلا حدث.
2. كل مستهلك idempotent (يفحص event_id قبل التنفيذ).
3. Retry policy أسّي (حد 5) ثم **Dead Letter Queue** (`dead_letter_jobs`) بتنبيه للأدمن (A-24).
4. version يرتفع عند أي تغيير في payload — المستهلكون يدعمون الإصدار السابق خلال فترة انتقال.
5. الأحداث تغذي: الإشعارات (15)، التحليلات (18)، تكاملات POS/Webhooks الصادرة، طابور الوصول، والتسويات.

## 4. خريطة حدث ← أثر

| الحدث | المستهلكون الرئيسيون |
|-------|----------------------|
| order.created / merchant.order_received | إشعار الفرع + عداد القبول |
| merchant.order_accepted | Capture (إن Auth) + إشعار العميل + KDS |
| merchant.order_rejected / payment.failed | مسار الاسترجاع + إشعار |
| order.ready | إشعار العميل «جاهز/تحرك» + طابور الوصول |
| pickup.trip_started / eta_updated | لوحة الفرع (ETA) + عتبات 10/5/3 |
| pickup.customer_nearby / arrived | صوت الفرع + الطابور + مؤقت زمن الخدمة |
| handoff.started | «الموظف متجه إليك» |
| handoff.completed / order.completed | فاتورة + تقييم + تحليلات + سطر تسوية |
| refund.* | ledger + إشعار + تذكرة |
| settlement.generated | تقرير التاجر + payout |
| notification.failed / webhook.failed | إعادة + مراقبة A-26 |
