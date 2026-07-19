import { z } from "zod";
import { UuidSchema } from "./common.js";

/**
 * النمو: نقاط المكافآت (C-63) + دعوة الأصدقاء (قرار المالك 2026-07-19).
 * النقاط عرضٌ واكتساب فقط في هذه المرحلة — الاستبدال مؤجل (docs/01§2)؛
 * مكافأة الدعوة تُصرف رصيداً في محفظة بيكلي للطرفين عند أول طلب مكتمل للمدعو.
 */

// ===== نقاط المكافآت =====

export const RewardsTransactionSchema = z.object({
  id: UuidSchema,
  /** موجب اكتساب، سالب تسوية/خصم أدمن */
  points: z.number().int(),
  reason: z.string(),
  order_id: UuidSchema.nullable(),
  created_at: z.string().datetime()
});
export type RewardsTransaction = z.infer<typeof RewardsTransactionSchema>;

/** GET /v1/customers/me/rewards */
export const CustomerRewardsSchema = z.object({
  points: z.number().int(),
  /** نقاط لكل ريال مدفوع — من إعدادات الأدمن، للعرض في «كيف أكسب النقاط» */
  points_per_sar: z.number().int().nonnegative(),
  transactions: z.array(RewardsTransactionSchema)
});
export type CustomerRewards = z.infer<typeof CustomerRewardsSchema>;

// ===== دعوة الأصدقاء =====

/** كود الدعوة: 6-8 حروف/أرقام لاتينية كبيرة — يُقرأ ويُملى بسهولة */
export const ReferralCodeSchema = z
  .string()
  .transform((s) => s.trim().toUpperCase())
  .refine((s) => /^[A-Z0-9]{6,8}$/.test(s), "كود غير صالح");

/** GET /v1/customers/me/referral */
export const CustomerReferralSchema = z.object({
  code: z.string(),
  /** مبلغا المكافأة الحاليان — من إعدادات الأدمن، للعرض في البانر */
  referrer_reward_halalas: z.number().int().nonnegative(),
  friend_reward_halalas: z.number().int().nonnegative(),
  /** عدد الأصدقاء المسجلين بكودي + كم منهم اكتمل أول طلب له فصُرفت مكافأته */
  invited_count: z.number().int().nonnegative(),
  rewarded_count: z.number().int().nonnegative(),
  /** هل يحق لي إدخال كود صديق؟ (لم أُدعَ سابقاً ولا طلبات مكتملة لي) */
  can_redeem: z.boolean(),
  redeemed_code: z.string().nullable()
});
export type CustomerReferral = z.infer<typeof CustomerReferralSchema>;

/** POST /v1/customers/me/referral/redeem */
export const RedeemReferralBodySchema = z.object({ code: ReferralCodeSchema });
export type RedeemReferralBody = z.infer<typeof RedeemReferralBodySchema>;

// ===== تفضيلات العميل (C-59/C-62) =====

/** PATCH /v1/customers/me — كل الحقول اختيارية؛ الواجهة ترسل ما تغيّر فقط */
export const UpdateMeBodySchema = z.object({
  full_name: z.string().min(2).max(80).optional(),
  preferred_language: z.enum(["ar", "en"]).optional(),
  marketing_opt_in: z.boolean().optional()
});
export type UpdateMeBody = z.infer<typeof UpdateMeBodySchema>;

/** GET /v1/customers/me */
export const CustomerMeSchema = z.object({
  id: UuidSchema,
  phone: z.string(),
  full_name: z.string().nullable(),
  preferred_language: z.enum(["ar", "en"]),
  marketing_opt_in: z.boolean()
});
export type CustomerMe = z.infer<typeof CustomerMeSchema>;

// ===== إعدادات النمو (أدمن) =====

/** system_settings:growth.rewards — سجل تاريخي كبقية الإعدادات */
export const GrowthSettingsSchema = z.object({
  points_per_sar: z.number().int().min(0).max(100),
  referrer_reward_halalas: z.number().int().min(0).max(50_000),
  friend_reward_halalas: z.number().int().min(0).max(50_000)
});
export type GrowthSettings = z.infer<typeof GrowthSettingsSchema>;
