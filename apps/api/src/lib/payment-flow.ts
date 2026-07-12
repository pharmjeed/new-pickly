import type { Order, PaymentIntent, Prisma, ScheduledPickupSlot } from "@pickly/database";
import { emitEvent, scheduleJob } from "./events.js";
import { transitionOrder } from "./state-machine.js";

type OrderWithSlot = Order & { scheduled_slot: ScheduledPickupSlot | null };

/**
 * ما بعد تفويض الدفع — مشترك بين webhook البوابة (payments/routes) والتغطية
 * الكاملة من محفظة بيكلي (orders/service): PAYMENT_PENDING → PAYMENT_AUTHORIZED →
 * ORDER_SUBMITTED ثم انتظار الفترة (BR-5) أو عداد قبول الفرع (BR-1) — معاملة المستدعي.
 */
export async function proceedAfterAuthorization(
  tx: Prisma.TransactionClient,
  intent: Pick<PaymentIntent, "id" | "amount_halalas" | "wallet_applied_halalas">,
  order: OrderWithSlot
): Promise<void> {
  await transitionOrder(tx, order, "PAYMENT_AUTHORIZED", { actor_type: "system" });
  await transitionOrder(
    tx,
    { ...order, order_status: "PAYMENT_AUTHORIZED" },
    "ORDER_SUBMITTED",
    { actor_type: "system" }
  );
  await emitEvent(tx, {
    name: "payment.authorized",
    aggregate_type: "payment_intent",
    aggregate_id: intent.id,
    merchant_id: order.merchant_id,
    branch_id: order.branch_id,
    payload: {
      amount_halalas: intent.amount_halalas,
      wallet_applied_halalas: intent.wallet_applied_halalas
    }
  });

  // BR-5: المجدول المدفوع ينتظر عند ORDER_SUBMITTED — دخول الفترة يحوّله لمسار ASAP
  const slot = order.scheduled_slot;
  if (order.pickup_time === "scheduled" && slot && slot.slot_start > new Date()) {
    await scheduleJob(
      tx,
      "scheduled_slot_entry",
      { order_id: order.id },
      slot.slot_start,
      `slot_entry:${order.id}:${slot.slot_start.getTime()}`
    );
    // تذكير «حان وقت التوجه» قبل الفترة (J3 — docs/03)
    const remindAt = new Date(slot.slot_start.getTime() - 15 * 60_000);
    if (remindAt > new Date()) {
      await scheduleJob(
        tx,
        "scheduled_reminder",
        { order_id: order.id },
        remindAt,
        `scheduled_reminder:${order.id}:${slot.slot_start.getTime()}`
      );
    }
    return;
  }

  // عداد قبول الفرع — BR-1
  const settings = await tx.branchPickupSettings.findUnique({
    where: { branch_id: order.branch_id }
  });
  const windowSec = settings?.accept_window_seconds ?? 180;
  const deadline = new Date(Date.now() + windowSec * 1000);
  await transitionOrder(
    tx,
    { ...order, order_status: "ORDER_SUBMITTED" },
    "MERCHANT_PENDING",
    { actor_type: "system" },
    { data: { accept_deadline_at: deadline } }
  );
  await scheduleJob(
    tx,
    "accept_timeout",
    { order_id: order.id },
    deadline,
    `accept_timeout:${order.id}`
  );
}
