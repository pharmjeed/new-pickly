import { z } from "zod";
import { HalalaSchema, UuidSchema } from "./common.js";
import { OrderStateSchema } from "./order-states.js";

/** docs/11§6 — واجهات الفرع/التاجر (نطاق الطيار) */

export const MerchantOrdersQuerySchema = z.object({
  branch_id: UuidSchema,
  status: OrderStateSchema.optional(),
  /** تبويبات لوحة التشغيل B-03 — awaiting_payment: بين القبول والدفع (معلوماتي، لا تحضير) */
  tab: z.enum(["new", "awaiting_payment", "preparing", "ready", "arrived", "completed", "all"]).default("all"),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50)
});

/** بطاقة الطلب في لوحة الفرع — بيانات العميل مقنّعة (docs/10§3-4) */
export const BranchOrderCardSchema = z.object({
  id: UuidSchema,
  display_code: z.string(),
  order_status: OrderStateSchema,
  customer_first_name: z.string(),
  customer_phone_masked: z.string(), // 05X *** XX21
  vehicle_summary: z.string().nullable(), // «كامري · بيضاء · 8241» — أثناء الطلب النشط فقط
  parking_spot: z.string().nullable(),
  items_count: z.number().int(),
  total_halalas: HalalaSchema,
  eta_minutes: z.number().int().nullable(),
  accept_deadline_at: z.string().datetime().nullable(), // عداد BR-1
  arrived_at: z.string().datetime().nullable(),
  /** FR-C06: asap | later | scheduled — «سأتحرك لاحقاً» يعني تجهيزاً غير موقوت بالوصول */
  pickup_time: z.enum(["asap", "later", "scheduled"]).default("asap"),
  scheduled_slot_start: z.string().datetime().nullable().default(null),
  /** وقت التجهيز المتوقع الذي حدده الفرع عند القبول (10/15/20/25 د) */
  prep_minutes: z.number().int().nullable().default(null),
  /** موافقة العميل على الوقت — شرط الانتقال للدفع؛ التحضير يبدأ آلياً عند الدفع */
  prep_time_confirmed_at: z.string().datetime().nullable().default(null),
  /** مهلتا ما بعد القبول (5 د لكلٍّ — docs/06 BR-2) لعرض عداد «بانتظار الدفع» */
  prep_confirm_deadline_at: z.string().datetime().nullable().default(null),
  payment_deadline_at: z.string().datetime().nullable().default(null),
  /** مسار التجهيز الموازي (docs/05§3) — يتقدم ولو كانت order_status في مسار رحلة العميل */
  preparing_at: z.string().datetime().nullable().default(null),
  ready_at: z.string().datetime().nullable().default(null),
  created_at: z.string().datetime()
});
export type BranchOrderCard = z.infer<typeof BranchOrderCardSchema>;

export const AcceptOrderBodySchema = z.object({
  prep_time_override_minutes: z.number().int().min(1).max(120).optional()
});

/** أسباب الرفض المغلقة — BR-1 */
export const REJECT_REASONS = [
  "item_unavailable",
  "branch_closed",
  "high_load",
  "system_issue",
  "other"
] as const;
export const RejectOrderBodySchema = z.object({
  reason: z.enum(REJECT_REASONS),
  note: z.string().max(280).optional()
});

export const ReadyOrderBodySchema = z.object({
  shelf: z.string().max(16).optional()
});

export const HandoffCompleteBodySchema = z.object({
  verification: z.object({
    method: z.enum(["code", "qr", "customer_button", "board"]),
    code: z.string().regex(/^\d{4}$/).optional()
  })
});

/** نقص منتج → موافقة العميل — BR-4 */
export const ItemIssueBodySchema = z.object({
  order_item_id: UuidSchema,
  issue: z.enum(["out_of_stock", "partial"]),
  substitute_product_id: UuidSchema.optional(),
  note: z.string().max(280).optional()
});

/** وضع الازدحام — BR-10 */
export const BusyModeBodySchema = z
  .object({
    prep_delta_minutes: z.union([z.literal(10), z.literal(20), z.literal(30)]).optional(),
    pause: z.boolean().optional(),
    order_cap: z.number().int().min(1).max(200).optional(),
    close_pickup_only: z.boolean().optional(),
    customer_message: z.string().max(140).optional()
  })
  .refine(
    (v) =>
      v.prep_delta_minutes !== undefined ||
      v.pause !== undefined ||
      v.order_cap !== undefined ||
      v.close_pickup_only !== undefined,
    { message: "حدد إجراء ازدحام واحداً على الأقل" }
  );

/**
 * رادار الوصول — docs/14§5-مكرر: لكل طلب مدفوع نشط سطر يقارن
 * المتبقي لوصول العميل (ETA) بما مضى من دقائق التجهيز المتفق عليها.
 * اللون يُحسب في الواجهة: أحمر عند eta ≤ 1 أو الوصول؛ رمادي عند غياب الرحلة.
 */
export const BranchRadarEntrySchema = z.object({
  order_id: UuidSchema,
  display_code: z.string(),
  order_status: OrderStateSchema,
  customer_first_name: z.string(),
  vehicle_summary: z.string().nullable(),
  prep_minutes: z.number().int().nullable(),
  /** بدء عداد التجهيز = لحظة نجاح الدفع (docs/05§3) */
  preparing_at: z.string().datetime().nullable(),
  ready_at: z.string().datetime().nullable(),
  arrived_at: z.string().datetime().nullable(),
  /** رحلة نشطة (شارك موقعه) — false = «لم ينطلق بعد» */
  trip_active: z.boolean(),
  eta_minutes: z.number().int().nullable(),
  eta_updated_at: z.string().datetime().nullable()
});
export type BranchRadarEntry = z.infer<typeof BranchRadarEntrySchema>;

export const ArrivalQueueEntrySchema = z.object({
  order_id: UuidSchema,
  display_code: z.string(),
  position: z.number().int().positive(),
  vehicle_summary: z.string().nullable(),
  parking_spot: z.string().nullable(),
  waiting_seconds: z.number().int(),
  service_target_exceeded: z.boolean() // تصعيد أحمر — BR-9
});
export type ArrivalQueueEntry = z.infer<typeof ArrivalQueueEntrySchema>;
