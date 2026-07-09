import { z } from "zod";
import { SaudiPhoneSchema } from "./common.js";

/** docs/11§1 — المصادقة */

export const OtpRequestBodySchema = z.object({
  phone: SaudiPhoneSchema
});
export type OtpRequestBody = z.infer<typeof OtpRequestBodySchema>;

export const OtpRequestResponseSchema = z.object({
  request_id: z.string().uuid(),
  /** ثواني حتى السماح بإعادة الإرسال */
  retry_after_seconds: z.number().int()
});

export const OtpVerifyBodySchema = z.object({
  phone: SaudiPhoneSchema,
  code: z.string().regex(/^\d{4,6}$/)
});
export type OtpVerifyBody = z.infer<typeof OtpVerifyBodySchema>;

export const TokenPairSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  /** true عند أول تسجيل — التطبيق يكمل P2 (الاسم) */
  is_new_user: z.boolean()
});
export type TokenPair = z.infer<typeof TokenPairSchema>;

export const RefreshBodySchema = z.object({
  refresh_token: z.string()
});

/** دخول فريق الفرع: كود فرع + حساب/PIN — docs/11§1 */
export const BranchLoginBodySchema = z.object({
  branch_code: z.string().min(4).max(16),
  username: z.string().min(2),
  pin: z.string().regex(/^\d{4,8}$/),
  device_name: z.string().min(1).max(64)
});

/** أدوار جانب التاجر — docs/16§1 */
export const MERCHANT_ROLES = [
  "owner",
  "general_manager",
  "operations_manager",
  "branch_manager",
  "cashier",
  "kitchen",
  "handoff",
  "finance",
  "analyst"
] as const;
export const MerchantRoleSchema = z.enum(MERCHANT_ROLES);
export type MerchantRole = z.infer<typeof MerchantRoleSchema>;

/** أدوار جانب Pickly — docs/16§2 */
export const ADMIN_ROLES = [
  "super_admin",
  "operations",
  "finance",
  "support",
  "merchant_success",
  "risk",
  "read_only"
] as const;
export const AdminRoleSchema = z.enum(ADMIN_ROLES);
export type AdminRole = z.infer<typeof AdminRoleSchema>;

export const ActorTypeSchema = z.enum(["customer", "merchant_staff", "admin", "system"]);
export type ActorType = z.infer<typeof ActorTypeSchema>;

/** حمولة JWT — الصلاحيات تُحمل في الجلسة وتُفحص في API (docs/16§3) */
export const JwtClaimsSchema = z.object({
  sub: z.string().uuid(),
  actor_type: ActorTypeSchema,
  session_id: z.string().uuid(),
  merchant_id: z.string().uuid().optional(),
  branch_ids: z.array(z.string().uuid()).optional(),
  roles: z.array(z.string()),
  iat: z.number(),
  exp: z.number()
});
export type JwtClaims = z.infer<typeof JwtClaimsSchema>;
