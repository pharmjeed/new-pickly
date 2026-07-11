# 05 — آلة حالات الطلب (Order State Machine)

المصدر السابق: 03 · **القائمة مغلقة حرفياً — لا حالة خارجها في أي طبقة**

---

## 1. الحالات (24)

```text
DRAFT                    سلة لم تكتمل
CART_ACTIVE              سلة نشطة مسعّرة
CHECKOUT_PENDING         في شاشات الإتمام
PAYMENT_PENDING          دفع قيد التنفيذ (3DS...)
PAYMENT_AUTHORIZED       مبلغ محجوز (إن دعمت البوابة Auth/Capture)
PAYMENT_FAILED           فشل الدفع
ORDER_SUBMITTED          أُنشئ الطلب وأُرسل
MERCHANT_PENDING         بانتظار قبول الفرع (عداد)
MERCHANT_ACCEPTED        قبل الفرع (+Capture إن وجد)
MERCHANT_REJECTED        رفض الفرع → مسار الاسترجاع
PREPARING                قيد التحضير
READY                    جاهز
CUSTOMER_NOTIFIED        أُشعر العميل بالجاهزية
CUSTOMER_ON_THE_WAY      «أنا في الطريق» (Pickup Session نشطة)
CUSTOMER_NEARBY          اقتراب (ETA/Geofence)
CUSTOMER_ARRIVED         وصول مؤكد من العميل
HANDOFF_IN_PROGRESS      خرج الموظف للتسليم
COMPLETED                تم التسليم والتحقق
CANCELLATION_REQUESTED   طلب إلغاء قيد المعالجة
CANCELLED                ملغي
NO_SHOW                  لم يحضر وفق السياسة
EXPIRED                  انتهت صلاحيته (مثل مجدول لم يُدفع/مهلة)
REFUND_PENDING           استرجاع قيد التنفيذ
PARTIALLY_REFUNDED       استرجاع جزئي
REFUNDED                 استرجاع كامل
```

## 2. المخطط الرئيسي

> **قرار المالك (2026-07-11): الدفع بعد القبول.** الطلب يُرسل للفرع **بلا دفع**؛ الفرع يقبل محدداً وقت التجهيز (10/15/20/25 د)؛ العميل يوافق على الوقت خلال **5 دقائق**؛ ثم يدفع خلال **5 دقائق**؛ ونجاح الدفع هو ما يبدأ التحضير (PREPARING) وعداد دقائق التجهيز معاً. رفض الفرع أو انتهاء أي مهلة قبل الدفع = إنهاء **بلا استرجاع** لأن لا مال قُبض.

```mermaid
flowchart LR
    D(DRAFT) --> CA(CART_ACTIVE) --> CP(CHECKOUT_PENDING) --> OS(ORDER_SUBMITTED)
    OS --> MP(MERCHANT_PENDING)
    MP --> MA(MERCHANT_ACCEPTED)
    MP --> MR(MERCHANT_REJECTED)
    MA -->|موافقة العميل على الوقت ثم Intent| PP(PAYMENT_PENDING)
    PP --> PA(PAYMENT_AUTHORIZED) --> PR(PREPARING)
    PP --> PF(PAYMENT_FAILED) -->|إعادة محاولة ضمن المهلة| PP
    MA & PP & PF -->|انتهاء مهلة 5 د| EX(EXPIRED)
    PR --> R(READY) --> CN(CUSTOMER_NOTIFIED)
    CN --> OTW(CUSTOMER_ON_THE_WAY) --> NB(CUSTOMER_NEARBY) --> AR(CUSTOMER_ARRIVED)
    PR & R -.->|يمكن التحرك بعد الدفع| OTW
    AR --> H(HANDOFF_IN_PROGRESS) --> C(COMPLETED)
    CN -->|تجاوز العتبة| NS(NO_SHOW)
    any(أي حالة قبل HANDOFF) --> CR(CANCELLATION_REQUESTED) --> X(CANCELLED)
    X & NS -->|فقط إن سبق الدفع| RP(REFUND_PENDING) --> RF(REFUNDED)
    RP --> PRf(PARTIALLY_REFUNDED)
```

ملاحظة: مسار الوصول (ON_THE_WAY→NEARBY→ARRIVED) يجري عبر **Pickup Session** موازية (`14-pickup-location-spec.md`)؛ يجوز أن يسبق READY — الفرع يراه بوضوح («وصل مبكراً») ولا يبدأ HANDOFF قبل READY. الرحلة تبدأ من PREPARING فصاعداً (أي بعد الدفع حصراً).

## 3. جدول الانتقالات (المالك + الشرط)

| من → إلى | المالك | الشرط/الأثر |
|----------|--------|--------------|
| CART_ACTIVE → CHECKOUT_PENDING | العميل | سلة صالحة + quote خادمي ساري |
| CHECKOUT → ORDER_SUBMITTED | العميل | إنشاء الطلب **بلا دفع** في معاملة DB واحدة + Idempotency-Key |
| SUBMITTED → MERCHANT_PENDING | النظام | فوراً (المجدول: عند دخول فترته) + إشعار الفرع + عداد القبول BR-1 |
| MERCHANT_PENDING → ACCEPTED | كاشير/مدير | تحديد وقت التجهيز المتوقع (10/15/20/25 د) + بدء **مهلة موافقة العميل 5 د** |
| MERCHANT_PENDING → REJECTED | الفرع أو انتهاء العداد | سبب مغلق؛ **لا استرجاع — لم يُدفع**؛ يُحتسب على الفرع |
| ACCEPTED → PAYMENT_PENDING | العميل | موافقته على الوقت (prep_time_confirmed_at) ثم Payment Intent + بدء **مهلة الدفع 5 د** |
| ACCEPTED/PAYMENT_PENDING/FAILED → EXPIRED | النظام | انتهاء مهلة الموافقة أو الدفع (5 د لكلٍّ) — إشعار الطرفين وتحرير اللوحة |
| PAYMENT_PENDING → AUTHORIZED/FAILED | webhook البوابة | التوقيع + مطابقة المبلغ والعملة |
| PAYMENT_FAILED → PAYMENT_PENDING | العميل | إعادة محاولة ضمن مهلة الدفع |
| AUTHORIZED → PREPARING | النظام | **لحظة الصفر**: Capture إن وجد + بدء عداد دقائق التجهيز من paid_at + تنبيه الفرع «ابدأ التجهيز» |
| PREPARING → READY | مطبخ | منع «جاهز» ناقص العناصر |
| READY → CUSTOMER_NOTIFIED | النظام | إشعار + «متى تتحرك» |
| (PREPARING..NOTIFIED) → ON_THE_WAY | العميل | «انطلقت الآن» → Pickup Session — **بعد الدفع حصراً** |
| ON_THE_WAY → NEARBY | النظام | ETA/Geofence (10/5/3/**1** د — عتبة الدقيقة تُحمّر الطلب في رادار الفرع) |
| NEARBY/ON_THE_WAY → ARRIVED | **العميل حصراً** | تأكيد يدوي — لا GPS وحده |
| ARRIVED → HANDOFF_IN_PROGRESS | موظف التسليم | «خرج الموظف» + الطلب READY |
| HANDOFF → COMPLETED | تحقق | رمز/QR/زر العميل/تأكيد اللوحة (مزدوج للقيمة العالية) |
| CUSTOMER_NOTIFIED → NO_SHOW | نظام | تجاوز عتبة السياسة بعد تذكير |
| قبل HANDOFF → CANCELLATION_REQUESTED → CANCELLED | عميل/فرع/أدمن | وفق مصفوفة الإلغاء في `06` — قبل الدفع: إنهاء فوري بلا أي أثر مالي |
| CANCELLED/NO_SHOW/شكوى (بعد الدفع فقط) → REFUND_PENDING → REFUNDED/PARTIALLY | Finance آلي | ledger مستقل، منع التكرار |

## 4. القواعد الصلبة (من المخطط الشامل — مُلزمة)

1. لا رحلة قبل الدفع — «انطلقت الآن» تُسمح من PREPARING فصاعداً حصراً.
2. التوجه قبل الجاهزية مسموح، والفرع يراه بوضوح.
3. **لا تتحول الحالة إلى «وصل» بإشارة GPS واحدة** — تأكيد العميل شرط.
4. لا COMPLETED دون تأكيد تسليم.
5. كل انتقال يُحفظ في `order_status_history` **غير قابل للتعديل** (من، متى، لماذا، بأي جهاز).
6. كل أمر دفع أو إنشاء طلب يستخدم Idempotency Key — تحديث الصفحة لا ينشئ طلباً ثانياً أبداً.
7. أحداث النطاق المقابلة (`12-domain-events.md`) تُبث عند كل انتقال.
8. حالات العرض للعميل (شريط الـ7) هي إسقاط مبسط من هذه القائمة — الخريطة في `07-prd.md`.
