import type { Order, Prisma } from "@pickly/database";
import {
  canTransition,
  type ActorType,
  type DomainEventName,
  type OrderState
} from "@pickly/contracts";
import { AppError } from "@pickly/observability";
import { emitEvent } from "./events.js";

/**
 * خدمة آلة حالات الطلب — docs/05 (القواعد الصلبة §4):
 * كل انتقال: تحقق من الجدول ← تحديث ← سجل append-only ← حدث Outbox،
 * كله في معاملة DB واحدة يمررها المستدعي.
 */

/** خريطة انتقال ← حدث نطاق (docs/12§4) */
const TRANSITION_EVENTS: Partial<Record<OrderState, DomainEventName>> = {
  ORDER_SUBMITTED: "order.created",
  MERCHANT_PENDING: "merchant.order_received",
  MERCHANT_ACCEPTED: "merchant.order_accepted",
  MERCHANT_REJECTED: "merchant.order_rejected",
  PREPARING: "order.preparing",
  READY: "order.ready",
  CUSTOMER_ON_THE_WAY: "pickup.trip_started",
  CUSTOMER_NEARBY: "pickup.customer_nearby",
  CUSTOMER_ARRIVED: "pickup.customer_arrived",
  HANDOFF_IN_PROGRESS: "handoff.started",
  COMPLETED: "order.completed",
  CANCELLED: "order.cancelled",
  NO_SHOW: "order.no_show",
  REFUND_PENDING: "refund.requested",
  REFUNDED: "refund.completed"
};

export interface TransitionActor {
  actor_type: ActorType;
  actor_id?: string;
  device_id?: string;
}

export async function transitionOrder(
  tx: Prisma.TransactionClient,
  order: Pick<Order, "id" | "order_status" | "merchant_id" | "branch_id">,
  to: OrderState,
  actor: TransitionActor,
  opts: { reason?: string; payload?: Record<string, unknown>; data?: Prisma.OrderUpdateInput } = {}
): Promise<void> {
  const from = order.order_status as OrderState;
  if (!canTransition(from, to)) {
    throw new AppError("ORDER-4002", { from, to });
  }

  await tx.order.update({
    where: { id: order.id },
    data: { order_status: to, ...(opts.data ?? {}) }
  });

  // سجل غير قابل للتعديل: من، متى، لماذا، بأي جهاز (docs/05§4-5)
  await tx.orderStatusHistory.create({
    data: {
      order_id: order.id,
      from_status: from,
      to_status: to,
      actor_type: actor.actor_type,
      ...(actor.actor_id ? { actor_id: actor.actor_id } : {}),
      ...(actor.device_id ? { device_id: actor.device_id } : {}),
      ...(opts.reason ? { reason: opts.reason } : {})
    }
  });

  const eventName = TRANSITION_EVENTS[to];
  if (eventName) {
    await emitEvent(tx, {
      name: eventName,
      aggregate_type: "order",
      aggregate_id: order.id,
      merchant_id: order.merchant_id,
      branch_id: order.branch_id,
      payload: { from, to, ...(opts.payload ?? {}) }
    });
  }
}
