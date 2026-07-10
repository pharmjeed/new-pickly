import { z } from "zod";
import { UuidSchema } from "./common.js";

/** تذاكر الدعم C-65/C-66 + A-15 — docs/07 FR-A09 */

export const TicketStatusSchema = z.enum([
  "open",
  "pending_customer",
  "pending_merchant",
  "resolved",
  "closed"
]);
export type TicketStatus = z.infer<typeof TicketStatusSchema>;

export const CreateTicketBodySchema = z.object({
  subject: z.string().trim().min(3).max(120),
  body: z.string().trim().min(1).max(2000),
  order_id: UuidSchema.optional()
});
export type CreateTicketBody = z.infer<typeof CreateTicketBodySchema>;

export const CreateTicketMessageBodySchema = z.object({
  body: z.string().trim().min(1).max(2000)
});

export const TicketMessageSchema = z.object({
  id: UuidSchema,
  /** actor_types docs/10 — customer | merchant_staff | admin | system */
  author: z.string(),
  body: z.string(),
  created_at: z.string().datetime()
});

export const SupportTicketSchema = z.object({
  id: UuidSchema,
  subject: z.string(),
  status: TicketStatusSchema,
  order_id: UuidSchema.nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  messages: z.array(TicketMessageSchema).optional()
});
export type SupportTicket = z.infer<typeof SupportTicketSchema>;
