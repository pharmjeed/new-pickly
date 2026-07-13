import { z } from "zod";
import { HalalaSchema, UuidSchema } from "./common.js";
import { OrderStateSchema } from "./order-states.js";

/** docs/11§4 — الطلب والدفع */

/** FR-C06: أقرب وقت / «سأتحرك لاحقاً» / مجدول بفترات وسعة (BR-5) */
export const PickupTimeSchema = z.enum(["asap", "later", "scheduled"]);
export type PickupTime = z.infer<typeof PickupTimeSchema>;

export const CreateOrderBodySchema = z.object({
  cart_id: UuidSchema,
  quote_id: UuidSchema,
  vehicle_id: UuidSchema,
  pickup_time: PickupTimeSchema.default("asap"),
  /** إلزامي عند pickup_time=scheduled — فترة من GET /v1/branches/:id/slots */
  slot_id: UuidSchema.optional(),
  parking_pref: z.enum(["numbered_spot", "front_of_entrance", "unknown"]).default("unknown"),
  notes: z.string().max(280).optional()
});
export type CreateOrderBody = z.infer<typeof CreateOrderBodySchema>;

export const VehicleSchema = z.object({
  id: UuidSchema,
  make_ar: z.string().nullable(),
  model_ar: z.string().nullable(),
  color_ar: z.string(),
  /** عمود مختصر للعرض — اللوحة الكاملة مشفرة (docs/10§1) */
  plate_short: z.string(),
  is_default: z.boolean()
});
export type Vehicle = z.infer<typeof VehicleSchema>;

export const OrderItemSchema = z.object({
  id: UuidSchema,
  /** لقطات — المنيو يتغير والطلب لا (docs/10§4) */
  name_ar_snapshot: z.string(),
  quantity: z.number().int(),
  unit_price_halalas_snapshot: HalalaSchema,
  modifiers_snapshot: z.array(z.object({ name_ar: z.string(), price_halalas: HalalaSchema })),
  line_total_halalas: HalalaSchema
});

export const OrderSchema = z.object({
  id: UuidSchema,
  /** كود العرض مثل P-4821 — لاتيني دائماً (README §5) */
  display_code: z.string(),
  order_status: OrderStateSchema,
  branch_id: UuidSchema,
  brand_name_ar: z.string(),
  items: z.array(OrderItemSchema),
  subtotal_halalas: HalalaSchema,
  discount_halalas: HalalaSchema,
  vat_halalas: HalalaSchema,
  service_fee_halalas: HalalaSchema,
  total_halalas: HalalaSchema,
  vehicle: VehicleSchema.nullable(),
  /** رمز التسليم — يظهر للعميل فقط بعد ARRIVED أو عند الجاهزية حسب الحالة */
  handoff_code: z.string().nullable(),
  /** الوقت المتوقع — «متوسط وقت التجهيز» المختوم عند القبول من إعدادات المطعم (قرار المالك 2026-07-12) */
  prep_minutes: z.number().int().nullable(),
  /** لحظة قبول المطعم — مرساة العدّاد التنازلي للتجهيز لدى العميل */
  accepted_at: z.string().datetime().nullable().default(null),
  /** موقع الفرع وعنوانه المختصر — لزر «الاتجاه للمطعم» في صفحة التتبع */
  branch_lat: z.number(),
  branch_lng: z.number(),
  branch_address_short: z.string(),
  /** نصف قطر تفعيل زر «وصلت» بالأمتار — يضبطه Super Admin (ops.arrival_radius_m، الافتراضي 500) */
  arrival_radius_m: z.number().int().positive().default(500),
  /** مسار التجهيز الموازي (docs/05§3) — حقيقتا التحضير والجاهزية مستقلتان عن حالة رحلة العميل */
  preparing_at: z.string().datetime().nullable().default(null),
  ready_at: z.string().datetime().nullable().default(null),
  pickup_time: PickupTimeSchema,
  /** فترة BR-5 المحجوزة — null لغير المجدول */
  scheduled_slot: z
    .object({
      slot_start: z.string().datetime(),
      slot_end: z.string().datetime(),
      free_change_until: z.string().datetime()
    })
    .nullable(),
  created_at: z.string().datetime()
});
export type Order = z.infer<typeof OrderSchema>;

/** GET /v1/customers/me/orders — بطاقة ملخص في «طلباتي» (C-56 / W-09) */
export const CustomerOrderSummarySchema = z.object({
  id: UuidSchema,
  display_code: z.string(),
  order_status: OrderStateSchema,
  branch_id: UuidSchema,
  brand_name_ar: z.string(),
  logo_url: z.string().nullable(),
  /** مجموع الكميات — «3 أصناف» */
  items_count: z.number().int(),
  /** أول صنفين للعرض السريع — «برجر دجاج، بطاطس» */
  items_preview_ar: z.string().nullable(),
  total_halalas: HalalaSchema,
  pickup_time: PickupTimeSchema,
  /** بداية فترة BR-5 للمجدول — null لغير المجدول */
  scheduled_start: z.string().datetime().nullable(),
  created_at: z.string().datetime()
});
export type CustomerOrderSummary = z.infer<typeof CustomerOrderSummarySchema>;

export const CancelOrderBodySchema = z.object({
  reason: z.enum(["changed_mind", "ordered_by_mistake", "wait_too_long", "other"]),
  note: z.string().max(280).optional()
});

/** رد العميل على تعديل الفرع — BR-4 */
export const ChangeResponseBodySchema = z.object({
  change_request_id: UuidSchema,
  decision: z.enum(["accept_substitute", "remove_item", "cancel"])
});

/** تعديل فترة المجدول قبل free_change_until — BR-5 */
export const RescheduleOrderBodySchema = z.object({
  slot_id: UuidSchema
});

/**
 * وسيلة الدفع — طرق يديرها السوبر أدمن (docs/01§1، قرار المالك 2026-07-12):
 * apple_pay | card | stc_pay عبر البوابة، و"wallet" القديمة (C-33) تبقى للتوافق.
 */
export const PaymentMethodKeySchema = z.enum(["card", "apple_pay", "stc_pay", "wallet"]);
export type PaymentMethodKey = z.infer<typeof PaymentMethodKeySchema>;

export const CreatePaymentIntentBodySchema = z.object({
  method: PaymentMethodKeySchema.default("card"),
  /** بطاقة محفوظة (بطاقاتي) — للدفع بها عند method=card؛ الملكية تُتحقق خادمياً */
  card_id: UuidSchema.optional(),
  /** محفظة بيكلي: صرف الرصيد من الإجمالي (كلياً أو جزئياً) قبل البوابة */
  use_wallet: z.boolean().default(false)
});
export type CreatePaymentIntentBody = z.infer<typeof CreatePaymentIntentBodySchema>;

export const PaymentIntentResponseSchema = z.object({
  intent_id: UuidSchema,
  provider: z.string(),
  client_secret: z.string(),
  /** المستحق عبر البوابة (الإجمالي − المطبق من المحفظة) — 0 يعني المحفظة غطت الطلب كاملاً */
  amount_halalas: HalalaSchema,
  wallet_applied_halalas: HalalaSchema.default(0),
  currency: z.literal("SAR"),
  status: z.enum(["requires_payment", "processing", "authorized", "captured", "failed"])
});
export type PaymentIntentResponse = z.infer<typeof PaymentIntentResponseSchema>;
