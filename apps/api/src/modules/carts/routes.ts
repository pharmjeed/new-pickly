import type { FastifyInstance } from "fastify";
import { CartItemInputSchema, CreateCartBodySchema, UuidSchema } from "@pickly/contracts";
import { requireAuth, requireCustomer } from "../../lib/auth-plugin.js";
import { CartService } from "./service.js";

/** docs/11§3 — السلة */
export async function cartRoutes(app: FastifyInstance): Promise<void> {
  const service = new CartService();
  app.addHook("preHandler", requireAuth);

  app.post("/", async (req) => {
    const claims = requireCustomer(req);
    const body = CreateCartBodySchema.parse(req.body);
    return service.create(claims.sub, body.branch_id);
  });

  app.get("/:id", async (req) => {
    const claims = requireCustomer(req);
    const id = UuidSchema.parse((req.params as { id: string }).id);
    return service.get(id, claims.sub);
  });

  app.post("/:id/items", async (req) => {
    const claims = requireCustomer(req);
    const id = UuidSchema.parse((req.params as { id: string }).id);
    const body = CartItemInputSchema.parse(req.body);
    return service.addItem(id, claims.sub, body);
  });

  app.delete("/:id/items/:itemId", async (req) => {
    const claims = requireCustomer(req);
    const { id, itemId } = req.params as { id: string; itemId: string };
    return service.removeItem(UuidSchema.parse(id), claims.sub, UuidSchema.parse(itemId));
  });

  app.post("/:id/quote", async (req) => {
    const claims = requireCustomer(req);
    const id = UuidSchema.parse((req.params as { id: string }).id);
    return service.quote(id, claims.sub);
  });
}
