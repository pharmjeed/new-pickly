import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  CreateTicketBodySchema,
  CreateTicketMessageBodySchema,
  UuidSchema,
  type NotificationListResponse,
  type SupportTicket as SupportTicketDto,
  type TicketStatus
} from "@pickly/contracts";
import { prisma } from "@pickly/database";
import { AppError } from "@pickly/observability";
import { requireAuth, requireCustomer } from "../../lib/auth-plugin.js";
import { requireFlag } from "../../lib/flags.js";
import { walletBalance } from "../../lib/payment-methods.js";
import { decryptPlate, encryptPlate } from "../../lib/plate-crypto.js";

/** وحدة Customers: الملف + السيارات + صندوق الإشعارات (C-62) + تذاكر الدعم (C-65/66) */
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

  // ===== السيارات — لوحة سعودية كاملة (حروف + أرقام) مشفرة AES-GCM =====

  /** اللوحة الكاملة تخزن مشفرة بصيغة «حروف|أرقام» — تفك للمالك فقط */
  const platePartsOf = (v: { plate_encrypted: string | null; plate_short: string }) => {
    const full = decryptPlate(v.plate_encrypted);
    const [letters, digits] = full?.includes("|") ? full.split("|") : ["", ""];
    return {
      plate_letters_ar: letters || null,
      plate_digits: digits || v.plate_short
    };
  };

  const vehicleDto = (
    v: {
      id: string;
      make_ar: string | null;
      model_ar: string | null;
      color_ar: string;
      plate_encrypted: string | null;
      plate_short: string;
    },
    is_default: boolean
  ) => ({
    id: v.id,
    make_ar: v.make_ar,
    model_ar: v.model_ar,
    color_ar: v.color_ar,
    plate_short: v.plate_short,
    ...platePartsOf(v),
    is_default
  });

  /** حروف اللوحة السعودية: حتى 3 أحرف عربية — تُخزن مفصولة بمسافات («ح ع ن») */
  const PlateLettersSchema = z
    .string()
    .max(11)
    .transform((s) => s.replace(/\s+/g, ""))
    .refine((s) => /^[ء-ي]{0,3}$/.test(s), "حروف عربية فقط (حتى 3)")
    .transform((s) => s.split("").join(" "));

  const VehicleBodySchema = z.object({
    color_ar: z.string().min(2).max(30),
    /** أرقام اللوحة (حتى 4) — الحقل الرئيس؛ plate_short يبقى للتوافق مع العملاء القدامى */
    plate_digits: z
      .string()
      .transform((s) => s.replace(/\D/g, ""))
      .refine((s) => /^\d{1,4}$/.test(s), "1-4 أرقام")
      .optional(),
    plate_letters_ar: PlateLettersSchema.optional(),
    plate_short: z.string().min(1).max(8).optional(),
    make_ar: z.string().max(40).optional(),
    model_ar: z.string().max(40).optional(),
    set_default: z.boolean().default(true)
  });

  app.get("/me/vehicles", async (req) => {
    const claims = requireCustomer(req);
    const [vehicles, def] = await Promise.all([
      prisma.vehicle.findMany({
        where: { user_id: claims.sub, is_active: true },
        orderBy: { created_at: "asc" }
      }),
      prisma.customerDefaultVehicle.findUnique({ where: { user_id: claims.sub } })
    ]);
    return vehicles.map((v) => vehicleDto(v, v.id === def?.vehicle_id));
  });

  /** إضافة سيارة — ماركة/موديل/لون من الكتالوج + لوحة كاملة (حروف + أرقام) */
  app.post("/me/vehicles", async (req) => {
    const claims = requireCustomer(req);
    const body = VehicleBodySchema.parse(req.body);
    const digits = body.plate_digits ?? body.plate_short;
    if (!digits) throw new AppError("SYS-9004", { field: "plate_digits" });

    const vehicle = await prisma.vehicle.create({
      data: {
        user_id: claims.sub,
        color_ar: body.color_ar,
        plate_short: digits,
        plate_encrypted: encryptPlate(`${body.plate_letters_ar ?? ""}|${digits}`),
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
    return vehicleDto(vehicle, body.set_default);
  });

  /** تعديل سيارة (ضغط مطول على البطاقة) — ملكية العميل شرط */
  app.patch("/me/vehicles/:id", async (req) => {
    const claims = requireCustomer(req);
    const id = UuidSchema.parse((req.params as { id: string }).id);
    const body = VehicleBodySchema.partial().parse(req.body);

    const existing = await prisma.vehicle.findUnique({ where: { id } });
    if (!existing || existing.user_id !== claims.sub || !existing.is_active)
      throw new AppError("SYS-9004", { hint: "السيارة غير موجودة" });

    const digits = body.plate_digits ?? existing.plate_short;
    const letters = body.plate_letters_ar ?? platePartsOf(existing).plate_letters_ar ?? "";

    const vehicle = await prisma.vehicle.update({
      where: { id },
      data: {
        ...(body.color_ar ? { color_ar: body.color_ar } : {}),
        ...(body.make_ar !== undefined ? { make_ar: body.make_ar || null } : {}),
        ...(body.model_ar !== undefined ? { model_ar: body.model_ar || null } : {}),
        plate_short: digits,
        plate_encrypted: encryptPlate(`${letters}|${digits}`)
      }
    });
    if (body.set_default) {
      await prisma.customerDefaultVehicle.upsert({
        where: { user_id: claims.sub },
        create: { user_id: claims.sub, vehicle_id: vehicle.id },
        update: { vehicle_id: vehicle.id }
      });
    }
    const def = await prisma.customerDefaultVehicle.findUnique({ where: { user_id: claims.sub } });
    return vehicleDto(vehicle, vehicle.id === def?.vehicle_id);
  });

  /** حذف سيارة (إخفاء ناعم) — لو كانت الافتراضية تنتقل الافتراضية لأقدم سيارة متبقية */
  app.delete("/me/vehicles/:id", async (req) => {
    const claims = requireCustomer(req);
    const id = UuidSchema.parse((req.params as { id: string }).id);

    const existing = await prisma.vehicle.findUnique({ where: { id } });
    if (!existing || existing.user_id !== claims.sub || !existing.is_active)
      throw new AppError("SYS-9004", { hint: "السيارة غير موجودة" });

    await prisma.vehicle.update({ where: { id }, data: { is_active: false } });

    const def = await prisma.customerDefaultVehicle.findUnique({ where: { user_id: claims.sub } });
    if (def?.vehicle_id === id) {
      const next = await prisma.vehicle.findFirst({
        where: { user_id: claims.sub, is_active: true },
        orderBy: { created_at: "asc" }
      });
      if (next) {
        await prisma.customerDefaultVehicle.update({
          where: { user_id: claims.sub },
          data: { vehicle_id: next.id }
        });
      } else {
        await prisma.customerDefaultVehicle.delete({ where: { user_id: claims.sub } });
      }
    }
    return { ok: true };
  });

  // ===== محفظة بيكلي — رصيد داخل التطبيق (docs/01§1، قرار المالك 2026-07-12) =====

  /** الرصيد + آخر الحركات — عزل صارم بمالك الجلسة */
  app.get("/me/wallet", async (req) => {
    await requireFlag("in_app_wallet");
    const claims = requireCustomer(req);
    const [balance, entries] = await Promise.all([
      walletBalance(prisma, claims.sub),
      prisma.customerWalletEntry.findMany({
        where: { user_id: claims.sub },
        orderBy: { created_at: "desc" },
        take: 50
      })
    ]);
    return {
      balance_halalas: Math.max(balance, 0),
      entries: entries.map((e) => ({
        id: e.id,
        amount_halalas: e.amount_halalas,
        entry_type: e.entry_type,
        reference: e.reference,
        created_at: e.created_at.toISOString()
      }))
    };
  });

  // ===== صندوق الإشعارات C-62 — docs/15 =====

  app.get("/me/notifications", async (req) => {
    const claims = requireCustomer(req);
    const rows = await prisma.notification.findMany({
      where: { user_id: claims.sub, channel: "inapp" },
      orderBy: { created_at: "desc" },
      take: 50,
      include: { deliveries: { where: { channel: "inapp" } } }
    });
    const result: NotificationListResponse = {
      notifications: rows.map((n) => ({
        id: n.id,
        order_id: n.order_id,
        template_key: n.template_key,
        title_ar: n.title_ar,
        body_ar: n.body_ar,
        read: n.deliveries.some((d) => d.opened_at != null),
        created_at: n.created_at.toISOString()
      })),
      unread_count: rows.filter((n) => !n.deliveries.some((d) => d.opened_at != null)).length
    };
    return result;
  });

  /** تعليم الكل مقروءاً — فتح الصندوق (opened في notification_deliveries) */
  app.post("/me/notifications/read", async (req) => {
    const claims = requireCustomer(req);
    await prisma.notificationDelivery.updateMany({
      where: {
        channel: "inapp",
        opened_at: null,
        notification: { user_id: claims.sub }
      },
      data: { status: "opened", opened_at: new Date() }
    });
    return { ok: true };
  });

  // ===== تذاكر الدعم C-65/C-66 — عزل بمالك التذكرة (user_id) =====

  const ticketDto = (
    t: { id: string; subject: string; status: string; order_id: string | null; created_at: Date; updated_at: Date },
    messages?: Array<{ id: string; author: string; body: string; created_at: Date }>
  ): SupportTicketDto => ({
    id: t.id,
    subject: t.subject,
    status: t.status as TicketStatus,
    order_id: t.order_id,
    created_at: t.created_at.toISOString(),
    updated_at: t.updated_at.toISOString(),
    ...(messages
      ? {
          messages: messages.map((m) => ({
            id: m.id,
            author: m.author,
            body: m.body,
            created_at: m.created_at.toISOString()
          }))
        }
      : {})
  });

  app.get("/me/support-tickets", async (req) => {
    const claims = requireCustomer(req);
    const tickets = await prisma.supportTicket.findMany({
      where: { user_id: claims.sub },
      orderBy: { updated_at: "desc" },
      take: 50
    });
    return tickets.map((t) => ticketDto(t));
  });

  app.get("/me/support-tickets/:id", async (req) => {
    const claims = requireCustomer(req);
    const id = UuidSchema.parse((req.params as { id: string }).id);
    const ticket = await prisma.supportTicket.findUnique({
      where: { id },
      include: { messages: { orderBy: { created_at: "asc" } } }
    });
    if (!ticket || ticket.user_id !== claims.sub) throw new AppError("SYS-9004", { hint: "التذكرة غير موجودة" });
    return ticketDto(ticket, ticket.messages);
  });

  app.post("/me/support-tickets", async (req) => {
    await requireFlag("support_tickets");
    const claims = requireCustomer(req);
    const body = CreateTicketBodySchema.parse(req.body);

    // التذكرة ببيانات الطلب مدمجة (A-15) — الطلب المرجعي يجب أن يكون للعميل نفسه
    let merchant_id: string | null = null;
    if (body.order_id) {
      const order = await prisma.order.findUnique({ where: { id: body.order_id } });
      if (!order || order.user_id !== claims.sub) throw new AppError("ORDER-4001");
      merchant_id = order.merchant_id;
    }

    const ticket = await prisma.supportTicket.create({
      data: {
        user_id: claims.sub,
        order_id: body.order_id ?? null,
        merchant_id,
        subject: body.subject,
        messages: { create: { author: "customer", author_id: claims.sub, body: body.body } }
      },
      include: { messages: true }
    });
    return ticketDto(ticket, ticket.messages);
  });

  app.post("/me/support-tickets/:id/messages", async (req) => {
    const claims = requireCustomer(req);
    const id = UuidSchema.parse((req.params as { id: string }).id);
    const body = CreateTicketMessageBodySchema.parse(req.body);

    const ticket = await prisma.supportTicket.findUnique({ where: { id } });
    if (!ticket || ticket.user_id !== claims.sub) throw new AppError("SYS-9004", { hint: "التذكرة غير موجودة" });
    if (ticket.status === "closed") throw new AppError("SYS-9004", { hint: "التذكرة مغلقة" });

    await prisma.$transaction([
      prisma.supportMessage.create({
        data: { ticket_id: id, author: "customer", author_id: claims.sub, body: body.body }
      }),
      prisma.supportTicket.update({ where: { id }, data: { status: "open" } })
    ]);

    const fresh = await prisma.supportTicket.findUniqueOrThrow({
      where: { id },
      include: { messages: { orderBy: { created_at: "asc" } } }
    });
    return ticketDto(fresh, fresh.messages);
  });
}
