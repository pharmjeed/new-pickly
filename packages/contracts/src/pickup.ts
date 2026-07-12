import { z } from "zod";
import { UuidSchema } from "./common.js";

/** docs/11§5 + docs/14 — الاستلام (Pickup Session) */

export const TripLocationBodySchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  speed: z.number().nonnegative().nullable(),
  heading: z.number().min(0).max(360).nullable(),
  accuracy: z.number().nonnegative()
});
export type TripLocationBody = z.infer<typeof TripLocationBodySchema>;

export const PickupSessionSchema = z.object({
  id: UuidSchema,
  order_id: UuidSchema,
  status: z.enum(["active", "arrived", "completed", "cancelled"]),
  eta_minutes: z.number().int().nullable(),
  started_at: z.string().datetime()
});
export type PickupSession = z.infer<typeof PickupSessionSchema>;

/**
 * موقف استلام معرَّف من الفرع (parking_spots) — يعرضه العميل عند «وين وقفت؟».
 * lat/lng: نقطة الموقف على الخريطة يثبتها التاجر فيتوجه العميل إليها مباشرة (نمط أوبر).
 */
export const BranchParkingSpotSchema = z.object({
  id: UuidSchema,
  label: z.string(),
  lat: z.number().min(-90).max(90).nullable(),
  lng: z.number().min(-180).max(180).nullable()
});
export type BranchParkingSpot = z.infer<typeof BranchParkingSpotSchema>;

/** اختيار الموقف — docs/14§5 */
export const ParkingSpotBodySchema = z
  .object({
    spot_id: UuidSchema.optional(),
    free_text: z.string().max(140).optional(),
    photo_upload_id: UuidSchema.optional()
  })
  .refine((v) => v.spot_id || v.free_text, {
    message: "حدد موقفاً مرقماً أو صف موقعك"
  });

/** تأكيد التسليم — BR-8 */
export const HandoffConfirmBodySchema = z.object({
  method: z.enum(["code", "qr", "button"]),
  code: z
    .string()
    .regex(/^\d{4}$/)
    .optional()
});
export type HandoffConfirmBody = z.infer<typeof HandoffConfirmBodySchema>;
