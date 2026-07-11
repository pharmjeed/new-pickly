import { z } from "zod";
import { generateBranchSlotsFromTemplate, prisma } from "@pickly/database";
import { createLogger } from "@pickly/observability";
import { notifyInApp } from "./notifications.js";

/**
 * BR-5 الطلب المجدول (docs/06§BR-5 + docs/03 J3):
 * - scheduled_slot_entry: دخول الفترة يحوّل الطلب المدفوع لمسار ASAP الطبيعي (MERCHANT_PENDING).
 * - scheduled_reminder: تذكير «حان وقت التوجه» قبل الفترة.
 * - scheduled_expire: مجدول لم يُدفع خلال المهلة → EXPIRED + تحرير السعة (docs/05).
 * كلها idempotent — تفحص حالة الطلب قبل أي فعل.
 */
const logger = createLogger("scheduled");

const PayloadSchema = z.object({ order_id: z.string().uuid() });
const ExpirePayloadSchema = z.object({ order_id: z.string().uuid(), slot_id: z.string().uuid() });

/** دخول الفترة — ORDER_SUBMITTED → MERCHANT_PENDING بعداد BR-1 */
export async function handleScheduledSlotEntry(payload: unknown): Promise<void> {
  const { order_id } = PayloadSchema.parse(payload);
  const order = await prisma.order.findUnique({
    where: { id: order_id },
    include: { scheduled_slot: true }
  });
  if (!order || order.order_status !== "ORDER_SUBMITTED") return; // أُلغي أو تقدّم — لا شيء

  // عُدّلت الفترة بعد جدولة هذا الـjob؟ أعد الجدولة للموعد الفعلي
  const slot = order.scheduled_slot;
  if (slot && slot.slot_start > new Date()) {
    await prisma.backgroundJob.upsert({
      where: { dedupe_key: `slot_entry:${order_id}:${slot.slot_start.getTime()}` },
      create: {
        job_type: "scheduled_slot_entry",
        payload: { order_id },
        run_at: slot.slot_start,
        dedupe_key: `slot_entry:${order_id}:${slot.slot_start.getTime()}`
      },
      update: {}
    });
    return;
  }

  const settings = await prisma.branchPickupSettings.findUnique({
    where: { branch_id: order.branch_id }
  });
  const windowSec = settings?.accept_window_seconds ?? 180;
  const deadline = new Date(Date.now() + windowSec * 1000);

  await prisma.$transaction(async (tx) => {
    await tx.order.update({
      where: { id: order_id },
      data: { order_status: "MERCHANT_PENDING", accept_deadline_at: deadline }
    });
    await tx.orderStatusHistory.create({
      data: {
        order_id,
        from_status: "ORDER_SUBMITTED",
        to_status: "MERCHANT_PENDING",
        actor_type: "system",
        reason: "scheduled_slot_entry"
      }
    });
    await tx.backgroundJob.create({
      data: {
        job_type: "accept_timeout",
        payload: { order_id },
        run_at: deadline,
        dedupe_key: `accept_timeout:${order_id}`
      }
    });
    await tx.backgroundJob.create({
      data: {
        job_type: "domain_event",
        dedupe_key: `merchant.order_received:scheduled:${order_id}`,
        payload: {
          event_id: crypto.randomUUID(),
          name: "merchant.order_received",
          version: 1,
          timestamp: new Date().toISOString(),
          aggregate_type: "order",
          aggregate_id: order_id,
          merchant_id: order.merchant_id,
          branch_id: order.branch_id,
          payload: { reason: "scheduled_slot_entry" },
          idempotency_key: `merchant.order_received:scheduled:${order_id}`
        }
      }
    });
  });
  logger.info({ order_id }, "مجدول دخل فترته — التحق بمسار ASAP");
}

/** تذكير «حان وقت التوجه» — J3 */
export async function handleScheduledReminder(payload: unknown): Promise<void> {
  const { order_id } = PayloadSchema.parse(payload);
  const order = await prisma.order.findUnique({
    where: { id: order_id },
    include: { scheduled_slot: true }
  });
  if (!order || !order.scheduled_slot) return;
  // أُلغي أو تحرك العميل بالفعل — لا تذكير
  if (!["ORDER_SUBMITTED", "MERCHANT_PENDING", "MERCHANT_ACCEPTED", "PREPARING", "READY"].includes(order.order_status)) return;

  await prisma.$transaction(async (tx) => {
    await notifyInApp(tx, {
      user_id: order.user_id,
      order_id,
      template_key: "scheduled_reminder",
      vars: { display_code: order.display_code },
      dedupe_key: `scheduled_reminder:${order_id}`
    });
  });
  logger.info({ order_id }, "تذكير التوجه للمجدول");
}

/** مجدول لم يُدفع — EXPIRED وتحرير السعة */
export async function handleScheduledExpire(payload: unknown): Promise<void> {
  const { order_id, slot_id } = ExpirePayloadSchema.parse(payload);
  const order = await prisma.order.findUnique({ where: { id: order_id } });
  if (!order) return;
  if (!["CHECKOUT_PENDING", "PAYMENT_PENDING", "PAYMENT_FAILED"].includes(order.order_status)) return; // دُفع أو أُلغي

  await prisma.$transaction(async (tx) => {
    await tx.order.update({ where: { id: order_id }, data: { order_status: "EXPIRED" } });
    await tx.orderStatusHistory.create({
      data: {
        order_id,
        from_status: order.order_status,
        to_status: "EXPIRED",
        actor_type: "system",
        reason: "scheduled_unpaid"
      }
    });
    await tx.$executeRaw`
      UPDATE branch_capacity_slots
      SET booked = GREATEST(booked - 1, 0)
      WHERE id = ${slot_id}::uuid`;
    await notifyInApp(tx, {
      user_id: order.user_id,
      order_id,
      template_key: "scheduled_expired",
      vars: { display_code: order.display_code },
      dedupe_key: `scheduled_expired:${order_id}`
    });
  });
  logger.warn({ order_id }, "مجدول غير مدفوع — EXPIRED وحُررت السعة");
}

/**
 * تجديد متدحرج لفترات BR-5 من دوام الأسبوع (branch_hours):
 * لكل فرع مفعّل الجدولة وله دوام محفوظ — upsert فترات الأيام السبعة القادمة.
 * idempotent: القائمة تُحدَّث سعتها فقط، والمحجوز لا يُمس.
 */
export async function runWeeklySlotRoll(): Promise<number> {
  const enabled = await prisma.branchPickupSettings.findMany({ where: { scheduled_enabled: true } });
  let total = 0;
  for (const settings of enabled) {
    const windows = await prisma.branchHour.findMany({ where: { branch_id: settings.branch_id } });
    if (windows.length === 0) continue;
    total += await generateBranchSlotsFromTemplate({
      branch_id: settings.branch_id,
      windows,
      slotMinutes: settings.scheduled_slot_minutes,
      capacity: settings.scheduled_capacity
    });
  }
  if (total > 0) logger.info({ slots: total, branches: enabled.length }, "تجديد فترات الجدولة من دوام الأسبوع");
  return total;
}

/** حلقة التجديد — كل ساعة تكفي لأفق 7 أيام */
export function startWeeklySlotRoll(intervalMs = 3600_000): () => void {
  let running = true;
  void (async () => {
    while (running) {
      try {
        await runWeeklySlotRoll();
      } catch (err) {
        logger.error({ err }, "weekly slot roll error");
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  })();
  return () => {
    running = false;
  };
}
