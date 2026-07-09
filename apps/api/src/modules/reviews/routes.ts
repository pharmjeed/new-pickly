import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "@pickly/database";
import { AppError } from "@pickly/observability";
import { UuidSchema } from "@pickly/contracts";
import { requireAuth, requireCustomer } from "../../lib/auth-plugin.js";

/**
 * وحدة Reviews — BR-11: تقييم خلال 7 أيام من COMPLETED، خمسة أبعاد،
 * البقشيش اختياري (بند مستقل في التسوية — يُحصَّل في مرحلة 5).
 * التقييمات تُنشر بعد فلترة (status=pending افتراضياً).
 */

const REVIEW_WINDOW_DAYS = 7;

const CreateReviewBodySchema = z.object({
  rating_overall: z.number().int().min(1).max(5),
  rating_speed: z.number().int().min(1).max(5).optional(),
  rating_accuracy: z.number().int().min(1).max(5).optional(),
  rating_staff: z.number().int().min(1).max(5).optional(),
  rating_experience: z.number().int().min(1).max(5).optional(),
  comment: z.string().max(500).optional(),
  tip_halalas: z.number().int().min(0).max(50_000).default(0)
});

export async function reviewRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  app.post("/orders/:id/review", async (req) => {
    const claims = requireCustomer(req);
    const order_id = UuidSchema.parse((req.params as { id: string }).id);
    const body = CreateReviewBodySchema.parse(req.body);

    const order = await prisma.order.findUnique({ where: { id: order_id } });
    if (!order || order.user_id !== claims.sub) throw new AppError("ORDER-4001");
    if (order.order_status !== "COMPLETED" || !order.completed_at) {
      throw new AppError("ORDER-4002", { hint: "التقييم بعد اكتمال الطلب" });
    }
    const windowMs = REVIEW_WINDOW_DAYS * 24 * 3600 * 1000;
    if (Date.now() - order.completed_at.getTime() > windowMs) {
      throw new AppError("ORDER-4003", { hint: "نافذة التقييم 7 أيام (BR-11)" });
    }

    const existing = await prisma.review.findUnique({ where: { order_id } });
    if (existing) return { id: existing.id, status: existing.status }; // idempotent

    const review = await prisma.review.create({
      data: {
        order_id,
        user_id: claims.sub,
        branch_id: order.branch_id,
        rating_overall: body.rating_overall,
        rating_speed: body.rating_speed ?? null,
        rating_accuracy: body.rating_accuracy ?? null,
        rating_staff: body.rating_staff ?? null,
        rating_experience: body.rating_experience ?? null,
        comment: body.comment ?? null,
        tip_halalas: body.tip_halalas
      }
    });
    return { id: review.id, status: review.status };
  });

  app.get("/orders/:id/review", async (req) => {
    const claims = requireCustomer(req);
    const order_id = UuidSchema.parse((req.params as { id: string }).id);
    const review = await prisma.review.findUnique({ where: { order_id } });
    if (!review || review.user_id !== claims.sub) return { exists: false };
    return { exists: true, rating_overall: review.rating_overall, status: review.status };
  });
}
