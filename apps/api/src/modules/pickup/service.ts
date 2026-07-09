import { prisma } from "@pickly/database";
import type { OrderState, PickupSession as SessionDto, TripLocationBody } from "@pickly/contracts";
import { AppError } from "@pickly/observability";
import { createGeoAdapter } from "@pickly/geo";
import { emitEvent } from "../../lib/events.js";
import { transitionOrder } from "../../lib/state-machine.js";
import { handoffCodeFor } from "../../lib/codes.js";

/**
 * وحدة Pickup — docs/14: الطبقات الأربع.
 * «وصلت» اليدوي هو الوحيد الذي يحوّل إلى ARRIVED (docs/05§4-3).
 */

const geo = createGeoAdapter();

/** الرحلة مسموحة من MERCHANT_ACCEPTED فصاعداً (docs/05§4-1) */
const TRIP_ALLOWED: OrderState[] = ["MERCHANT_ACCEPTED", "PREPARING", "READY", "CUSTOMER_NOTIFIED"];

function toSessionDto(s: {
  id: string;
  order_id: string;
  status: string;
  started_at: Date;
}, eta_minutes: number | null): SessionDto {
  return {
    id: s.id,
    order_id: s.order_id,
    status: s.status as SessionDto["status"],
    eta_minutes,
    started_at: s.started_at.toISOString()
  };
}

export class PickupService {
  private async loadOwnedOrder(order_id: string, user_id: string) {
    const order = await prisma.order.findUnique({
      where: { id: order_id },
      include: { branch: { include: { pickup_settings: true } } }
    });
    if (!order || order.user_id !== user_id) throw new AppError("ORDER-4001");
    return order;
  }

  /** POST trip/start — «أنا في الطريق» يفتح Pickup Session (الطبقة 1) */
  async startTrip(order_id: string, user_id: string, mode: "auto" | "manual" = "auto"): Promise<SessionDto> {
    const order = await this.loadOwnedOrder(order_id, user_id);
    const status = order.order_status as OrderState;
    if (!TRIP_ALLOWED.includes(status)) throw new AppError("ORDER-4002", { from: status, to: "CUSTOMER_ON_THE_WAY" });

    const existing = await prisma.pickupSession.findUnique({ where: { order_id } });
    if (existing && existing.status === "active") return toSessionDto(existing, null);

    const session = await prisma.$transaction(async (tx) => {
      const s = await tx.pickupSession.create({
        data: { order_id, mode }
      });
      await transitionOrder(tx, order, "CUSTOMER_ON_THE_WAY", {
        actor_type: "customer",
        actor_id: user_id
      });
      await tx.arrivalEvent.create({
        data: { order_id, session_id: s.id, event_type: "trip_started" }
      });
      return s;
    });
    return toSessionDto(session, null);
  }

  /**
   * POST trip/location — الطبقتان 2 و3: ETA من الطريق + Geofence.
   * حماية البطارية على العميل؛ هنا: snapshot وعتبات 10/5/3 وNEARBY.
   */
  async recordLocation(order_id: string, user_id: string, loc: TripLocationBody) {
    const order = await this.loadOwnedOrder(order_id, user_id);
    const session = await prisma.pickupSession.findUnique({ where: { order_id } });
    if (!session || session.status !== "active") throw new AppError("PICKUP-6001");

    // فحص دقة الإحداثيات — مقاومة GPS Drift (docs/14§4)
    if (loc.accuracy > 100) {
      return { recorded: false, reason: "accuracy_too_low", eta_minutes: null };
    }

    await prisma.pickupLocationEvent.create({
      data: {
        session_id: session.id,
        lat: loc.lat,
        lng: loc.lng,
        speed: loc.speed,
        heading: loc.heading,
        accuracy: loc.accuracy
      }
    });

    const route = await geo.estimateRoute(
      { lat: loc.lat, lng: loc.lng },
      { lat: order.branch.lat, lng: order.branch.lng }
    );
    await prisma.pickupEtaSnapshot.create({
      data: {
        session_id: session.id,
        eta_seconds: route.eta_seconds,
        distance_m: route.distance_m,
        provider: route.provider
      }
    });

    const etaMin = Math.round(route.eta_seconds / 60);
    const settings = order.branch.pickup_settings;
    const alertRadius = settings?.alert_radius_m ?? 300;

    await prisma.$transaction(async (tx) => {
      await emitEvent(tx, {
        name: "pickup.eta_updated",
        aggregate_type: "order",
        aggregate_id: order.id,
        merchant_id: order.merchant_id,
        branch_id: order.branch_id,
        payload: { eta_seconds: route.eta_seconds, distance_m: route.distance_m }
      });

      // عتبات إشعار الفرع 10/5/3 دقائق (docs/14§1)
      for (const threshold of [10, 5, 3] as const) {
        if (etaMin <= threshold) {
          const eventType = `eta_threshold_${threshold}` as const;
          const already = await tx.arrivalEvent.findFirst({
            where: { order_id: order.id, event_type: eventType }
          });
          if (!already) {
            await tx.arrivalEvent.create({
              data: { order_id: order.id, session_id: session.id, event_type: eventType }
            });
          }
        }
      }

      // Geofence التنبيه → NEARBY (لا يحوّل ARRIVED أبداً)
      if (route.distance_m <= alertRadius && order.order_status === "CUSTOMER_ON_THE_WAY") {
        const already = await tx.arrivalEvent.findFirst({
          where: { order_id: order.id, event_type: "geofence_alert_enter" }
        });
        if (!already) {
          await tx.arrivalEvent.create({
            data: { order_id: order.id, session_id: session.id, event_type: "geofence_alert_enter" }
          });
        }
        await transitionOrder(tx, order, "CUSTOMER_NEARBY", { actor_type: "system" });
      }

      // Dwell — docs/14§4: قراءة واحدة لا تساوي وصولاً. البقاء داخل نطاق الوصول
      // بسرعة شبه صفرية طوال dwell_seconds ← حدث dwell_detected (يغذي «يبدو أنك
      // وصلت — هل وصلت؟» في الواجهة؛ التحول ARRIVED يبقى يدوياً حصراً).
      const arrivalRadius = settings?.arrival_radius_m ?? 100;
      if (route.distance_m <= arrivalRadius) {
        const dwellSec = settings?.dwell_seconds ?? 20;
        const dwellAlready = await tx.arrivalEvent.findFirst({
          where: { order_id: order.id, event_type: "dwell_detected" }
        });
        if (!dwellAlready) {
          const windowStart = new Date(Date.now() - dwellSec * 1000);
          const recent = await tx.pickupLocationEvent.findMany({
            where: { session_id: session.id, created_at: { gte: windowStart } },
            orderBy: { created_at: "asc" }
          });
          const stationary =
            recent.length >= 2 &&
            recent.every((e) => (e.speed ?? 0) < 2) && // < 2 م/ث ≈ توقف
            recent[0]!.created_at <= new Date(Date.now() - (dwellSec - 2) * 1000);
          if (stationary) {
            await tx.arrivalEvent.create({
              data: { order_id: order.id, session_id: session.id, event_type: "dwell_detected" }
            });
          }
        }
      }
    });

    const dwell = await prisma.arrivalEvent.findFirst({
      where: { order_id: order.id, event_type: "dwell_detected" }
    });
    return {
      recorded: true,
      eta_minutes: etaMin,
      distance_m: route.distance_m,
      // الواجهة تعرض «يبدو أنك وصلت — هل وصلت؟» — الزر اليدوي هو المرجع
      looks_arrived: Boolean(dwell) && order.order_status !== "CUSTOMER_ARRIVED"
    };
  }

  /** POST arrival — تأكيد «وصلت» اليدوي: الحصري للتحول ARRIVED */
  async confirmArrival(order_id: string, user_id: string) {
    const order = await this.loadOwnedOrder(order_id, user_id);
    const status = order.order_status as OrderState;

    // البديل اليدوي الكامل (J10): وصول دون رحلة GPS — نفتح session يدوية
    if (TRIP_ALLOWED.includes(status)) {
      await this.startTrip(order_id, user_id, "manual");
    }

    const fresh = await prisma.order.findUniqueOrThrow({ where: { id: order_id } });
    const session = await prisma.pickupSession.findUnique({ where: { order_id } });

    await prisma.$transaction(async (tx) => {
      await transitionOrder(
        tx,
        fresh,
        "CUSTOMER_ARRIVED",
        { actor_type: "customer", actor_id: user_id },
        { data: { arrived_at: new Date() } }
      );
      if (session) {
        await tx.pickupSession.update({ where: { id: session.id }, data: { status: "arrived" } });
        await tx.arrivalEvent.create({
          data: { order_id, session_id: session.id, event_type: "manual_arrival_confirm" }
        });
      }
      // دخول طابور الوصول — BR-9
      await tx.arrivalQueueEntry.upsert({
        where: { order_id },
        create: { branch_id: fresh.branch_id, order_id },
        update: {}
      });
    });

    return { arrived: true };
  }

  /** POST parking-spot — docs/14§5 */
  async setParkingSpot(
    order_id: string,
    user_id: string,
    input: { spot_id?: string | undefined; free_text?: string | undefined }
  ) {
    const order = await this.loadOwnedOrder(order_id, user_id);
    let label = input.free_text ?? null;
    if (input.spot_id) {
      const spot = await prisma.parkingSpot.findUnique({ where: { id: input.spot_id } });
      if (!spot || spot.branch_id !== order.branch_id) throw new AppError("SYS-9004", { field: "spot_id" });
      label = spot.label;
    }
    await prisma.order.update({
      where: { id: order_id },
      data: { parking_spot_label: label }
    });
    return { parking_spot: label };
  }

  /** POST trip/stop */
  async stopTrip(order_id: string, user_id: string) {
    await this.loadOwnedOrder(order_id, user_id);
    const session = await prisma.pickupSession.findUnique({ where: { order_id } });
    if (!session || session.status !== "active") throw new AppError("PICKUP-6001");
    await prisma.$transaction(async (tx) => {
      await tx.pickupSession.update({
        where: { id: session.id },
        data: { status: "cancelled", ended_at: new Date() }
      });
      await tx.arrivalEvent.create({
        data: { order_id, session_id: session.id, event_type: "trip_stopped" }
      });
    });
    return { stopped: true };
  }

  /** POST handoff/confirm — زر «استلمت» من العميل (BR-8) */
  async customerHandoffConfirm(order_id: string, user_id: string, method: "code" | "qr" | "button", code?: string) {
    const order = await this.loadOwnedOrder(order_id, user_id);
    if (order.order_status !== "HANDOFF_IN_PROGRESS") {
      throw new AppError("ORDER-4002", { from: order.order_status, to: "COMPLETED" });
    }
    if (method === "code" && code !== handoffCodeFor(order.id)) throw new AppError("PICKUP-6003");

    await prisma.$transaction(async (tx) => {
      await tx.handoffConfirmation.create({
        data: { order_id, method: method === "button" ? "customer_button" : method, confirmed_by: "customer", actor_id: user_id }
      });

      if (order.requires_dual_confirmation) {
        // التأكيد المزدوج: يكتمل فقط إذا أكد الموظف أيضاً — BR-8
        const staffConfirm = await tx.handoffConfirmation.findFirst({
          where: { order_id, confirmed_by: "merchant_staff" }
        });
        if (!staffConfirm) return; // ننتظر الموظف
      }
      await completeHandoff(tx, order, { actor_type: "customer", actor_id: user_id });
    });

    const fresh = await prisma.order.findUniqueOrThrow({ where: { id: order_id } });
    return { order_status: fresh.order_status };
  }
}

/** إكمال التسليم — مشترك بين تأكيد العميل والموظف */
export async function completeHandoff(
  tx: Parameters<typeof transitionOrder>[0],
  order: { id: string; order_status: string; merchant_id: string; branch_id: string },
  actor: { actor_type: "customer" | "merchant_staff"; actor_id?: string }
): Promise<void> {
  await transitionOrder(tx, order as never, "COMPLETED", actor, {
    data: { completed_at: new Date() }
  });
  await tx.pickupSession.updateMany({
    where: { order_id: order.id },
    data: { status: "completed", ended_at: new Date() }
  });
  await tx.arrivalQueueEntry.updateMany({
    where: { order_id: order.id },
    data: { served_at: new Date() }
  });
  await emitEvent(tx, {
    name: "handoff.completed",
    aggregate_type: "order",
    aggregate_id: order.id,
    merchant_id: order.merchant_id,
    branch_id: order.branch_id
  });
}
