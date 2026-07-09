import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "@pickly/database";
import { requireAuth, requireCustomer } from "../../lib/auth-plugin.js";

/** وحدة Customers/Vehicles (نطاق الشريحة): الملف + سيارات العميل */
export async function customerRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  app.get("/me", async (req) => {
    const claims = requireCustomer(req);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: claims.sub } });
    return { id: user.id, phone: user.phone, full_name: user.full_name };
  });

  app.patch("/me", async (req) => {
    const claims = requireCustomer(req);
    const body = z.object({ full_name: z.string().min(2).max(80) }).parse(req.body);
    const user = await prisma.user.update({
      where: { id: claims.sub },
      data: { full_name: body.full_name }
    });
    return { id: user.id, phone: user.phone, full_name: user.full_name };
  });

  app.get("/me/vehicles", async (req) => {
    const claims = requireCustomer(req);
    const [vehicles, def] = await Promise.all([
      prisma.vehicle.findMany({ where: { user_id: claims.sub, is_active: true } }),
      prisma.customerDefaultVehicle.findUnique({ where: { user_id: claims.sub } })
    ]);
    return vehicles.map((v) => ({
      id: v.id,
      make_ar: v.make_ar,
      model_ar: v.model_ar,
      color_ar: v.color_ar,
      plate_short: v.plate_short,
      is_default: v.id === def?.vehicle_id
    }));
  });

  /** إضافة سيارة مصغرة — S3: حقلان إلزاميان فقط (اللون + آخر 4 أرقام) */
  app.post("/me/vehicles", async (req) => {
    const claims = requireCustomer(req);
    const body = z
      .object({
        color_ar: z.string().min(2).max(30),
        plate_short: z.string().min(1).max(8),
        make_ar: z.string().max(40).optional(),
        model_ar: z.string().max(40).optional(),
        set_default: z.boolean().default(true)
      })
      .parse(req.body);

    const vehicle = await prisma.vehicle.create({
      data: {
        user_id: claims.sub,
        color_ar: body.color_ar,
        plate_short: body.plate_short,
        make_ar: body.make_ar ?? null,
        model_ar: body.model_ar ?? null
      }
    });
    if (body.set_default) {
      await prisma.customerDefaultVehicle.upsert({
        where: { user_id: claims.sub },
        create: { user_id: claims.sub, vehicle_id: vehicle.id },
        update: { vehicle_id: vehicle.id }
      });
    }
    return {
      id: vehicle.id,
      make_ar: vehicle.make_ar,
      model_ar: vehicle.model_ar,
      color_ar: vehicle.color_ar,
      plate_short: vehicle.plate_short,
      is_default: body.set_default
    };
  });
}
