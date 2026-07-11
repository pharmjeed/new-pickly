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
  prep_minutes: z.number().int().nullable(),
  /** موافقة العميل على وقت التجهيز المتوقع — null حتى يؤكد (أو يضغط «انطلقت الآن») */
  prep_time_confirmed_at: z.string().datetime().nullable().default(null),
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

/** وسيلة الدفع C-33 — بطاقة أو محفظة (Apple Pay/STC Pay عبر البوابة، docs/13§2) */
export const CreatePaymentIntentBodySchema = z.object({
  method: z.enum(["card", "wallet"]).default("card")
});
export type CreatePaymentIntentBody = z.infer<typeof CreatePaymentIntentBodySchema>;

export const PaymentIntentResponseSchema = z.object({
  intent_id: UuidSchema,
  provider: z.string(),
  client_secret: z.string(),
  amount_halalas: HalalaSchema,
  currency: z.literal("SAR"),
  status: z.enum(["requires_payment", "processing", "authorized", "captured", "failed"])
});
export type PaymentIntentResponse = z.infer<typeof PaymentIntentResponseSchema>;
