import { z } from "zod";
import { UuidSchema } from "./common.js";

/** صندوق إشعارات العميل C-62 — docs/15 (Push + inapp) */

export const CustomerNotificationSchema = z.object({
  id: UuidSchema,
  order_id: UuidSchema.nullable(),
  template_key: z.string(),
  title_ar: z.string(),
  body_ar: z.string(),
  read: z.boolean(),
  created_at: z.string().datetime()
});
export type CustomerNotification = z.infer<typeof CustomerNotificationSchema>;

export const NotificationListResponseSchema = z.object({
  notifications: z.array(CustomerNotificationSchema),
  unread_count: z.number().int().nonnegative()
});
export type NotificationListResponse = z.infer<typeof NotificationListResponseSchema>;
