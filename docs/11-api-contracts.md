# 11 — عقود API (API Contracts)

المصدر السابق: 05، 07، 10 · REST `/v1` موثق OpenAPI · Zod في `packages/contracts`

---

## 0. قواعد عامة

Bearer JWT (جلسات قابلة للإلغاء) · غلاف خطأ موحد `{error: {code, message_ar, message_en, details?}}` · المبالغ هللات · ترقيم cursor · **Idempotency-Key إلزامي على كل POST مالي/إنشائي** · إصدار الحقول إضافي فقط (backward compatible).

## 1. المصادقة
```text
POST /v1/auth/otp/request      {phone}
POST /v1/auth/otp/verify       {phone, code} → tokens
POST /v1/auth/refresh
POST /v1/auth/logout
```
(+ دخول فريق الفرع: كود فرع + حساب/PIN — ضمن نفس الوحدة، أجهزة مسماة.)

## 2. الاكتشاف
```text
GET /v1/discovery/home         ?lat&lng          # أقسام الرئيسية المركبة
GET /v1/branches/nearby        ?lat&lng&radius
GET /v1/restaurants            ?filters...        # فلاتر C-16
GET /v1/restaurants/:id
GET /v1/branches/:id/menu
GET /v1/search                 ?q&lat&lng
```

## 3. السلة
```text
POST   /v1/carts
GET    /v1/carts/:id
POST   /v1/carts/:id/items
PATCH  /v1/carts/:id/items/:itemId
DELETE /v1/carts/:id/items/:itemId
POST   /v1/carts/:id/coupon
POST   /v1/carts/:id/quote     # تسعير خادمي — المصدر الوحيد للسعر النهائي
```

## 4. الطلب والدفع
```text
POST /v1/orders                        {cart_id, quote_id, vehicle_id, pickup_time|slot, parking_pref}
GET  /v1/orders/:id
POST /v1/orders/:id/payment-intent
POST /v1/orders/:id/cancel
POST /v1/orders/:id/change-response    # رد العميل على تعديل الفرع (BR-4): accept_substitute|remove_item|cancel
```

## 5. الاستلام (Pickup Session)
```text
POST /v1/orders/:id/trip/start         # «أنا في الطريق» → pickup_session
POST /v1/orders/:id/trip/location      {lat,lng,speed,heading,accuracy}   # تردد متكيف
POST /v1/orders/:id/trip/stop
POST /v1/orders/:id/arrival            # تأكيد «وصلت» اليدوي (الحصري للتحول ARRIVED)
POST /v1/orders/:id/parking-spot       {spot_id|free_text|photo?}
POST /v1/orders/:id/handoff/confirm    {method: code|qr|button, code?}
```

## 6. واجهات الفرع/التاجر
```text
GET  /v1/merchant/orders               ?branch_id&status&tab
POST /v1/merchant/orders/:id/accept    {prep_time_override?}
POST /v1/merchant/orders/:id/reject    {reason}
POST /v1/merchant/orders/:id/preparing
POST /v1/merchant/orders/:id/ready     {shelf?}
POST /v1/merchant/orders/:id/handoff/start      # خرج الموظف
POST /v1/merchant/orders/:id/handoff/complete   {verification}
POST /v1/merchant/orders/:id/item-issue         # نقص منتج → طلب موافقة العميل
GET  /v1/merchant/arrival-queue        ?branch_id
POST /v1/merchant/branches/:id/busy-mode        {prep_delta|pause|cap|message}
+ CRUD: brands, branches, pickup-settings, parking-spots, menu(categories/products/modifiers), availability, staff, promotions, reports, settlements, invoices, integrations, shifts(open/close)
```

## 7. الأدمن
`/v1/admin/...` مرايا لأقسام A-01–A-27: merchants(+approve/suspend/plan/trial/credit/support-mode) · onboarding · branches(+geofence-test/resend-config) · orders(timeline) · customers(+block) · payments · refunds(decision) · settlements(run/retry) · plans-and-fees · promotions · cms · support(tickets) · risk(alerts/decision) · users-and-roles · audit-logs · feature-flags · jobs · webhooks · health.

## 8. Webhooks واردة
```text
POST /v1/webhooks/payments/:provider    # توقيع إلزامي + تخزين خام + idempotent
POST /v1/webhooks/pos/:provider         # foodics|salla|zid|...
```

## 9. Realtime (WebSocket/SSE)

| القناة | المشترك | الحمولة |
|--------|---------|---------|
| `order:{id}` | العميل | تغيرات الحالة + ETA للفرع |
| `branch:{id}:board` | شاشة الفرع | طلبات، طابور، اقترابات (10/5/3د)، تجاوزات |
| `merchant:{id}:alerts` | بوابة التاجر | تنبيهات M-02 |
| `admin:live-ops` | الأدمن | تنبيهات A-02 |

القاعدة: القنوات نشر فقط؛ إعادة الاتصال تعيد الجلب من REST.

## 10. أكواد الأخطاء

نطاقات: `AUTH-1xxx` · `CATALOG-2xxx` · `CART-3xxx` · `ORDER-4xxx` · `PAY-5xxx` · `PICKUP-6xxx` · `MERCHANT-7xxx` · `ADMIN-8xxx` · `SYS-9xxx`. كل كود برسالتين ar/en، والقائمة التفصيلية تُولَّد من `packages/contracts` وتُعد جزءاً من هذا العقد.

**قاعدة مغلقة:** لا endpoint خارج هذه الوثيقة؛ أي إضافة = تحديثها + OpenAPI معاً في نفس الـPR.
