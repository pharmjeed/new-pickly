import { z } from "zod";
import { UuidSchema } from "./common.js";

/**
 * بطاقات العميل المحفوظة (قرار المالك 2026-07-12) — Tokenization فقط (docs/17):
 * رقم البطاقة وCVV يمران للبوابة ولا يُخزنان ولا يُسجلان أبداً؛
 * يُحفظ token البوابة + brand/last4/expiry للعرض والدفع.
 */

export const CardBrandSchema = z.enum(["mada", "visa", "mastercard"]);
export type CardBrand = z.infer<typeof CardBrandSchema>;

/** POST /v1/customers/me/cards — «إضافة بطاقة جديدة» */
export const AddCardBodySchema = z.object({
  card_number: z
    .string()
    .transform((s) => s.replace(/[\s-]/g, ""))
    .refine((s) => /^\d{13,19}$/.test(s), "رقم البطاقة 13–19 رقماً"),
  exp_month: z.number().int().min(1).max(12),
  /** سنتان أو أربع خانات — تُطبَّع إلى أربع */
  exp_year: z
    .number()
    .int()
    .transform((y) => (y < 100 ? 2000 + y : y))
    .refine((y) => y >= 2020 && y <= 2100, "سنة غير صالحة"),
  cvv: z.string().regex(/^\d{3,4}$/, "CVV من 3–4 أرقام"),
  holder_name: z.string().trim().min(2).max(60).optional(),
  /** «حفظ كطريقة الدفع الأساسية» */
  set_default: z.boolean().default(true)
});
export type AddCardBody = z.infer<typeof AddCardBodySchema>;

export const CustomerCardSchema = z.object({
  id: UuidSchema,
  brand: CardBrandSchema,
  last4: z.string(),
  exp_month: z.number().int(),
  exp_year: z.number().int(),
  holder_name: z.string().nullable(),
  is_default: z.boolean(),
  /** منتهية الصلاحية — تُعرض موسومة ولا يُدفع بها */
  expired: z.boolean()
});
export type CustomerCard = z.infer<typeof CustomerCardSchema>;
