import { z } from "zod";

/**
 * أحداث النطاق — القائمة مغلقة من docs/12§1
 * (مع الامتدادات المسموحة المذكورة نصاً في الوثيقة).
 */
export const DOMAIN_EVENTS = [
  "order.created",
  "payment.authorized",
  "payment.failed",
  "merchant.order_received",
  "merchant.order_accepted",
  "merchant.order_rejected",
  "order.preparing",
  "order.ready",
  "pickup.trip_started",
  "pickup.eta_updated",
  "pickup.customer_nearby",
  "pickup.customer_arrived",
  "handoff.started",
  "handoff.completed",
  "order.completed",
  "order.cancelled",
  "refund.requested",
  "refund.completed",
  "settlement.generated",
  "notification.failed",
  "webhook.failed",
  // امتدادات مسموحة نصاً في docs/12§1:
  "order.no_show",
  "order.change_requested",
  "order.change_resolved",
  "subscription.renewed",
  "risk.alert_raised"
] as const;

export const DomainEventNameSchema = z.enum(DOMAIN_EVENTS);
export type DomainEventName = z.infer<typeof DomainEventNameSchema>;

/** مغلف الحدث الإلزامي — docs/12§2 */
export const EventEnvelopeSchema = z.object({
  event_id: z.string().uuid(),
  name: DomainEventNameSchema,
  version: z.number().int().positive(),
  timestamp: z.string().datetime(),
  aggregate_type: z.string(),
  aggregate_id: z.string().uuid(),
  merchant_id: z.string().uuid().nullable(),
  branch_id: z.string().uuid().nullable(),
  payload: z.record(z.unknown()),
  idempotency_key: z.string()
});
export type EventEnvelope = z.infer<typeof EventEnvelopeSchema>;
