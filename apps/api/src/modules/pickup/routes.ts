import type { FastifyInstance } from "fastify";
import {
  HandoffConfirmBodySchema,
  ParkingSpotBodySchema,
  TripLocationBodySchema,
  UuidSchema
} from "@pickly/contracts";
import { requireAuth, requireCustomer } from "../../lib/auth-plugin.js";
import { PickupService } from "./service.js";

/** docs/11§5 — الاستلام (Pickup Session) */
export async function pickupRoutes(app: FastifyInstance): Promise<void> {
  const service = new PickupService();
  app.addHook("preHandler", requireAuth);

  const orderId = (req: { params: unknown }) =>
    UuidSchema.parse((req.params as { id: string }).id);

  app.post("/:id/trip/start", async (req) => {
    const claims = requireCustomer(req);
    return service.startTrip(orderId(req), claims.sub);
  });

  app.post("/:id/trip/location", async (req) => {
    const claims = requireCustomer(req);
    const body = TripLocationBodySchema.parse(req.body);
    return service.recordLocation(orderId(req), claims.sub, body);
  });

  app.post("/:id/trip/stop", async (req) => {
    const claims = requireCustomer(req);
    return service.stopTrip(orderId(req), claims.sub);
  });

  app.post("/:id/arrival", async (req) => {
    const claims = requireCustomer(req);
    return service.confirmArrival(orderId(req), claims.sub);
  });

  app.post("/:id/parking-spot", async (req) => {
    const claims = requireCustomer(req);
    const body = ParkingSpotBodySchema.parse(req.body);
    return service.setParkingSpot(orderId(req), claims.sub, body);
  });

  app.post("/:id/handoff/confirm", async (req) => {
    const claims = requireCustomer(req);
    const body = HandoffConfirmBodySchema.parse(req.body);
    return service.customerHandoffConfirm(orderId(req), claims.sub, body.method, body.code);
  });
}
