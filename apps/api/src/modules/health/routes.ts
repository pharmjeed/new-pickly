import type { FastifyInstance } from "fastify";
import { prisma } from "@pickly/database";

/** Health and Monitoring — من قائمة الوحدات docs/09§4 */
export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health", async () => ({ status: "ok", ts: new Date().toISOString() }));

  app.get("/health/ready", async (_req, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return { status: "ready", db: "up" };
    } catch {
      return reply.status(503).send({ status: "not_ready", db: "down" });
    }
  });
}
