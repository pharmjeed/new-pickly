import { z } from "zod";
import { UuidSchema } from "./common.js";

/**
 * محفظة بيكلي — رصيد داخل التطبيق (docs/01§1، قرار المالك 2026-07-12).
 * الرصيد = مجموع قيود customer_wallet_entries (موجب إيداع، سالب صرف) —
 * لا عمود رصيد منسوخ؛ القيود هي مصدر الحقيقة (docs/10§1).
 */

export const WalletEntrySchema = z.object({
  id: UuidSchema,
  /** موجب إيداع/استرجاع، سالب صرف في طلب */
  amount_halalas: z.number().int(),
  entry_type: z.enum(["credit", "debit", "expiry"]),
  /** مرجع القيد: order:P-XXXX أو refund:{id} أو admin */
  reference: z.string().nullable(),
  created_at: z.string().datetime()
});
export type WalletEntry = z.infer<typeof WalletEntrySchema>;

/** GET /v1/customers/me/wallet */
export const CustomerWalletSchema = z.object({
  balance_halalas: z.number().int().nonnegative(),
  entries: z.array(WalletEntrySchema)
});
export type CustomerWallet = z.infer<typeof CustomerWalletSchema>;
