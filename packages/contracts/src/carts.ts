import { z } from "zod";
import { HalalaSchema, UuidSchema } from "./common.js";

/** docs/11§3 — السلة والتسعير الخادمي (BR-6) */

export const CartItemInputSchema = z.object({
  product_id: UuidSchema,
  quantity: z.number().int().min(1).max(50),
  modifier_ids: z.array(UuidSchema).default([]),
  notes: z.string().max(280).optional()
});
export type CartItemInput = z.infer<typeof CartItemInputSchema>;

export const CreateCartBodySchema = z.object({
  branch_id: UuidSchema
});

export const CartItemSchema = z.object({
  id: UuidSchema,
  product_id: UuidSchema,
  name_ar: z.string(),
  quantity: z.number().int(),
  unit_price_halalas: HalalaSchema,
  modifiers: z.array(
    z.object({ id: UuidSchema, name_ar: z.string(), price_halalas: HalalaSchema })
  ),
  line_total_halalas: HalalaSchema,
  notes: z.string().nullable(),
  is_available: z.boolean()
});

export const CartSchema = z.object({
  id: UuidSchema,
  branch_id: UuidSchema,
  items: z.array(CartItemSchema),
  coupon_code: z.string().nullable(),
  quote: z
    .object({
      quote_id: UuidSchema,
      expires_at: z.string().datetime(),
      subtotal_halalas: HalalaSchema,
      discount_halalas: HalalaSchema,
      vat_halalas: HalalaSchema,
      service_fee_halalas: HalalaSchema, // رسم خدمة Pickly — يظهر مفصولاً دائماً (BR-6)
      total_halalas: HalalaSchema
    })
    .nullable()
});
export type Cart = z.infer<typeof CartSchema>;

export const ApplyCouponBodySchema = z.object({
  code: z.string().min(2).max(32)
});
