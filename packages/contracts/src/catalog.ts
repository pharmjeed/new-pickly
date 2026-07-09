import { z } from "zod";
import { CoordsSchema, HalalaSchema, UuidSchema } from "./common.js";

/** docs/11§2 — الاكتشاف والكتالوج (نطاق الطيار) */

export const BranchStatusSchema = z.enum(["open", "busy", "paused", "closed"]);

export const BranchCardSchema = z.object({
  id: UuidSchema,
  brand_id: UuidSchema,
  brand_name_ar: z.string(),
  brand_name_en: z.string().nullable(),
  logo_url: z.string().nullable(),
  cover_url: z.string().nullable(),
  status: BranchStatusSchema,
  busy_message: z.string().nullable(),
  distance_meters: z.number().int().nullable(),
  eta_minutes: z.number().int().nullable(),
  rating: z.number().min(0).max(5).nullable(),
  min_order_halalas: HalalaSchema.nullable(),
  location: CoordsSchema,
  address_short: z.string()
});
export type BranchCard = z.infer<typeof BranchCardSchema>;

export const ModifierSchema = z.object({
  id: UuidSchema,
  name_ar: z.string(),
  name_en: z.string().nullable(),
  price_halalas: HalalaSchema,
  is_available: z.boolean()
});

export const ModifierGroupSchema = z.object({
  id: UuidSchema,
  name_ar: z.string(),
  name_en: z.string().nullable(),
  min_select: z.number().int().nonnegative(),
  max_select: z.number().int().positive(),
  modifiers: z.array(ModifierSchema)
});

export const ProductSchema = z.object({
  id: UuidSchema,
  category_id: UuidSchema,
  name_ar: z.string(),
  name_en: z.string().nullable(),
  description_ar: z.string().nullable(),
  price_halalas: HalalaSchema,
  image_url: z.string().nullable(),
  is_available: z.boolean(),
  modifier_groups: z.array(ModifierGroupSchema),
  calories: z.number().int().nullable()
});
export type Product = z.infer<typeof ProductSchema>;

export const MenuSchema = z.object({
  branch_id: UuidSchema,
  categories: z.array(
    z.object({
      id: UuidSchema,
      name_ar: z.string(),
      name_en: z.string().nullable(),
      sort_order: z.number().int(),
      products: z.array(ProductSchema)
    })
  )
});
export type Menu = z.infer<typeof MenuSchema>;

export const NearbyQuerySchema = z.object({
  lat: z.coerce.number(),
  lng: z.coerce.number(),
  radius: z.coerce.number().int().min(100).max(50_000).default(10_000)
});
