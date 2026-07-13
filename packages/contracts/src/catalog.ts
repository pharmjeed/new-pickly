import { z } from "zod";
import { CoordsSchema, HalalaSchema, UuidSchema } from "./common.js";

/** docs/11§2 — الاكتشاف والكتالوج (نطاق الطيار) */

export const BranchStatusSchema = z.enum(["open", "busy", "paused", "closed"]);

export const BranchCardSchema = z.object({
  id: UuidSchema,
  brand_id: UuidSchema,
  brand_name_ar: z.string(),
  brand_name_en: z.string().nullable(),
  /** تصنيف المطبخ (برجر/شاورما/مقهى…) — تصنيفات C-09 تُشتق منه */
  cuisine_ar: z.string().nullable(),
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
  /** السعر الأصلي — يُشطب للعميل حين يوجد عرض ساري */
  price_halalas: HalalaSchema,
  /** سعر العرض الساري الآن (M-11)؛ null = لا عرض. أقل دائماً من price_halalas */
  sale_price_halalas: HalalaSchema.nullable(),
  /** نهاية العرض إن وُجدت — للعدّاد التنازلي في الواجهة */
  sale_ends_at: z.string().datetime().nullable(),
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

/** GET /v1/search — بحث C-11/C-12 (FR-C02، docs/11§2) */
export const SearchQuerySchema = z.object({
  q: z.string().trim().min(1).max(80),
  lat: z.coerce.number().optional(),
  lng: z.coerce.number().optional()
});

export const SearchProductHitSchema = z.object({
  id: UuidSchema,
  branch_id: UuidSchema,
  brand_name_ar: z.string(),
  name_ar: z.string(),
  price_halalas: HalalaSchema,
  image_url: z.string().nullable()
});

export const SearchResponseSchema = z.object({
  branches: z.array(BranchCardSchema),
  products: z.array(SearchProductHitSchema)
});
export type SearchResponse = z.infer<typeof SearchResponseSchema>;

/** GET /v1/branches/:id/slots — فترات BR-5 المتاحة بسعتها */
export const CapacitySlotSchema = z.object({
  id: UuidSchema,
  slot_start: z.string().datetime(),
  slot_end: z.string().datetime(),
  capacity: z.number().int(),
  booked: z.number().int(),
  remaining: z.number().int()
});
export type CapacitySlot = z.infer<typeof CapacitySlotSchema>;

/**
 * GET /v1/customers/me/favorites — المفضلة C-18/C-64:
 * العلامة المحفوظة + أقرب فرع نشط للانتقال إليه (حسب lat/lng إن أُرسلا).
 */
export const FavoriteBrandSchema = z.object({
  brand_id: UuidSchema,
  name_ar: z.string(),
  cuisine_ar: z.string().nullable(),
  logo_url: z.string().nullable(),
  cover_url: z.string().nullable(),
  branch_id: UuidSchema.nullable(),
  branch_status: BranchStatusSchema.nullable(),
  distance_meters: z.number().int().nullable(),
  created_at: z.string().datetime()
});
export type FavoriteBrand = z.infer<typeof FavoriteBrandSchema>;

/** GET /v1/offers — بطاقة عرض C-17: كوبونات بيكلي العامة وعروض المطاعم السارية */
export const OfferCardSchema = z.object({
  id: UuidSchema,
  code: z.string(),
  type: z.enum(["amount", "percent", "free_product"]),
  /** هللات لـ amount، نقاط أساس لـ percent (كما في جدول coupons) */
  value: z.number().int(),
  min_order_halalas: HalalaSchema.nullable(),
  new_users_only: z.boolean(),
  /** null = كوبون بيكلي عام على كل المطاعم */
  merchant_name_ar: z.string().nullable(),
  brand_logo_url: z.string().nullable(),
  ends_at: z.string().datetime().nullable()
});
export type OfferCard = z.infer<typeof OfferCardSchema>;

/** GET /v1/content/banners — بانرات CMS (A-13) */
export const ContentBannerSchema = z.object({
  title_ar: z.string(),
  body_ar: z.string().nullable(),
  image_url: z.string().nullable(),
  link: z.string().nullable()
});
export type ContentBanner = z.infer<typeof ContentBannerSchema>;

/** GET /v1/content/categories — تصنيفات المطاعم (C-09) بترتيب السوبر أدمن (cms.categories) */
export const ContentCategorySchema = z.object({
  name_ar: z.string()
});
export type ContentCategory = z.infer<typeof ContentCategorySchema>;

/**
 * GET /v1/content/payment-methods — طرق الدفع الظاهرة للعميل بترتيب السوبر أدمن
 * (system_settings:payments.methods — قرار المالك 2026-07-12). الفعّالة فقط.
 */
export const ContentPaymentMethodSchema = z.object({
  key: z.enum(["apple_pay", "card", "stc_pay"]),
  name_ar: z.string(),
  desc_ar: z.string().nullable(),
  /** شارة اختيارية بجانب الاسم — مثل «جديد» */
  badge_ar: z.string().nullable()
});
export type ContentPaymentMethod = z.infer<typeof ContentPaymentMethodSchema>;
