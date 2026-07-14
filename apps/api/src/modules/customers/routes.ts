import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  AddCardBodySchema,
  CreateTicketBodySchema,
  CreateTicketMessageBodySchema,
  UuidSchema,
  type CardBrand,
  type CustomerCard as CustomerCardDto,
  type CustomerOrderSummary,
  type FavoriteBrand,
  type NotificationListResponse,
  type OrderState,
  type PickupTime,
  type SupportTicket as SupportTicketDto,
  type TicketStatus
} from "@pickly/contracts";
import { prisma } from "@pickly/database";
import { haversineMeters } from "@pickly/geo";
import { AppError } from "@pickly/observability";
import { requireAuth, requireCustomer } from "../../lib/auth-plugin.js";
import { requireFlag } from "../../lib/flags.js";
import { walletBalance } from "../../lib/payment-methods.js";
import { decryptPlate, encryptPlate } from "../../lib/plate-crypto.js";
import { payments } from "../orders/service.js";

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

  // ===== طلباتي C-56 / W-09 — قائمة طلبات العميل =====

  /** مسودات ما قبل إتمام الدفع لا تظهر في «طلباتي» — تظهر أول ما يصبح الطلب حقيقياً */
  const PRE_SUBMIT_STATES = [
    "DRAFT",
    "CART_ACTIVE",
    "CHECKOUT_PENDING",
    "PAYMENT_PENDING",
    "PAYMENT_AUTHORIZED",
    "PAYMENT_FAILED",
    "EXPIRED"
  ] as const;

  app.get("/me/orders", async (req) => {
    const claims = requireCustomer(req);
    const orders = await prisma.order.findMany({
      where: { user_id: claims.sub, order_status: { notIn: [...PRE_SUBMIT_STATES] } },
      orderBy: { created_at: "desc" },
      take: 50,
      include: {
        branch: { include: { brand: true } },
        items: true,
        scheduled_slot: true
      }
    });
    return orders.map(
      (o): CustomerOrderSummary => ({
        id: o.id,
        display_code: o.display_code,
        order_status: o.order_status as OrderState,
        branch_id: o.branch_id,
        brand_name_ar: o.branch.brand.name_ar,
        logo_url: o.branch.brand.logo_url,
        items_count: o.items.reduce((n, it) => n + it.quantity, 0),
        items_preview_ar:
          o.items
            .slice(0, 2)
            .map((it) => it.name_ar_snapshot)
            .join("، ") || null,
        total_halalas: o.total_halalas,
        pickup_time: o.pickup_time as PickupTime,
        scheduled_start: o.scheduled_slot?.slot_start.toISOString() ?? null,
        created_at: o.created_at.toISOString()
      })
    );
  });

  // ===== المفضلة C-18 / C-64 — علامات يحفظها العميل (favorites) =====

  app.get("/me/favorites", async (req) => {
    const claims = requireCustomer(req);
    const q = z
      .object({ lat: z.coerce.number().optional(), lng: z.coerce.number().optional() })
      .parse(req.query ?? {});

    const favs = await prisma.favorite.findMany({
      where: { user_id: claims.sub },
      orderBy: { created_at: "desc" }
    });
    if (favs.length === 0) return [];

    const brands = await prisma.brand.findMany({
      where: { id: { in: favs.map((f) => f.brand_id) } },
      include: { branches: { where: { is_active: true } } }
    });
    const byId = new Map(brands.map((b) => [b.id, b]));

    return favs.flatMap((f): FavoriteBrand[] => {
      const brand = byId.get(f.brand_id);
      if (!brand) return []; // علامة حُذفت — لا نكسر القائمة
      // أقرب فرع نشط إن توفر موقع العميل — وإلا أول فرع
      let branch = brand.branches[0] ?? null;
      let distance: number | null = null;
      if (q.lat != null && q.lng != null) {
        for (const b of brand.branches) {
          const d = haversineMeters({ lat: q.lat, lng: q.lng }, { lat: b.lat, lng: b.lng });
          if (distance === null || d < distance) {
            distance = d;
            branch = b;
          }
        }
      }
      return [
        {
          brand_id: brand.id,
          name_ar: brand.name_ar,
          cuisine_ar: brand.cuisine_ar,
          logo_url: brand.logo_url,
          cover_url: brand.cover_url,
          branch_id: branch?.id ?? null,
          branch_status: (branch?.status as FavoriteBrand["branch_status"]) ?? null,
          distance_meters: distance === null ? null : Math.round(distance),
          created_at: f.created_at.toISOString()
        }
      ];
    });
  });

  /** إضافة للمفضلة — upsert: الضغط المكرر على القلب لا يفشل */
  app.put("/me/favorites/:brandId", async (req) => {
    const claims = requireCustomer(req);
    const brand_id = UuidSchema.parse((req.params as { brandId: string }).brandId);
    const brand = await prisma.brand.findUnique({ where: { id: brand_id } });
    if (!brand || !brand.is_active) throw new AppError("CATALOG-2001");
    await prisma.favorite.upsert({
      where: { user_id_brand_id: { user_id: claims.sub, brand_id } },
      create: { user_id: claims.sub, brand_id },
      update: {}
    });
    return { ok: true };
  });

  app.delete("/me/favorites/:brandId", async (req) => {
    const claims = requireCustomer(req);
    const brand_id = UuidSchema.parse((req.params as { brandId: string }).brandId);
    await prisma.favorite.deleteMany({ where: { user_id: claims.sub, brand_id } });
    return { ok: true };
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

  /** حروف اللوحة السعودية: 3 أحرف عربية إلزامية — تُخزن مفصولة بمسافات («ح ع ن») */
  const PlateLettersSchema = z
    .string()
    .max(11)
    .transform((s) => s.replace(/\s+/g, ""))
    .refine((s) => /^[ء-ي]{3}$/.test(s), "3 حروف عربية إلزامية")
    .transform((s) => s.split("").join(" "));

  const VehicleBodySchema = z.object({
    color_ar: z.string().min(2).max(30),
    /** أرقام اللوحة (حتى 4) — الحقل الرئيس؛ plate_short يبقى للتوافق مع العملاء القدامى */
    plate_digits: z
      .string()
      .transform((s) => s.replace(/\D/g, ""))
      .refine((s) => /^\d{1,4}$/.test(s), "1-4 أرقام")
      .optional(),
    plate_letters_ar: PlateLettersSchema,
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
        plate_encrypted: encryptPlate(`${body.plate_letters_ar}|${digits}`),
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

  // ===== بطاقاتي — Tokenization فقط (قرار المالك 2026-07-12، docs/17) =====

  /** بطاقة منتهية إذا مضى شهر انتهائها */
  const isExpired = (exp_month: number, exp_year: number): boolean => {
    const now = new Date();
    return exp_year < now.getFullYear() || (exp_year === now.getFullYear() && exp_month < now.getMonth() + 1);
  };

  const cardDto = (c: {
    id: string;
    brand: string;
    last4: string;
    exp_month: number;
    exp_year: number;
    holder_name: string | null;
    is_default: boolean;
  }): CustomerCardDto => ({
    id: c.id,
    brand: c.brand as CardBrand,
    last4: c.last4,
    exp_month: c.exp_month,
    exp_year: c.exp_year,
    holder_name: c.holder_name,
    is_default: c.is_default,
    expired: isExpired(c.exp_month, c.exp_year)
  });

  app.get("/me/cards", async (req) => {
    const claims = requireCustomer(req);
    const cards = await prisma.customerCard.findMany({
      where: { user_id: claims.sub, is_active: true },
      orderBy: [{ is_default: "desc" }, { created_at: "desc" }]
    });
    return cards.map(cardDto);
  });

  /** «إضافة بطاقة جديدة» — الرقم وCVV يمران للبوابة (tokenize) ولا يُخزنان ولا يُسجلان */
  app.post("/me/cards", async (req) => {
    const claims = requireCustomer(req);
    const body = AddCardBodySchema.parse(req.body);
    if (isExpired(body.exp_month, body.exp_year))
      throw new AppError("SYS-9004", { hint: "البطاقة منتهية الصلاحية" });

    let tokenized;
    try {
      tokenized = await payments.tokenizeCard({
        card_number: body.card_number,
        exp_month: body.exp_month,
        exp_year: body.exp_year,
        cvv: body.cvv,
        ...(body.holder_name ? { holder_name: body.holder_name } : {})
      });
    } catch {
      // رسالة البوابة لا تُمرر خاماً — ولا يُسجل أي جزء من البيانات
      throw new AppError("SYS-9004", { hint: "تحقق من رقم البطاقة وبياناتها" });
    }

    const card = await prisma.$transaction(async (tx) => {
      if (body.set_default) {
        await tx.customerCard.updateMany({
          where: { user_id: claims.sub, is_default: true },
          data: { is_default: false }
        });
      }
      return tx.customerCard.create({
        data: {
          user_id: claims.sub,
          provider: payments.provider,
          token: tokenized.token,
          brand: tokenized.brand,
          last4: tokenized.last4,
          exp_month: body.exp_month,
          exp_year: body.exp_year,
          holder_name: body.holder_name ?? null,
          is_default: body.set_default
        }
      });
    });
    return cardDto(card);
  });

  /** حذف بطاقة (إخفاء ناعم) — الافتراضية تنتقل لأحدث بطاقة متبقية */
  app.delete("/me/cards/:id", async (req) => {
    const claims = requireCustomer(req);
    const id = UuidSchema.parse((req.params as { id: string }).id);
    const existing = await prisma.customerCard.findUnique({ where: { id } });
    if (!existing || existing.user_id !== claims.sub || !existing.is_active)
      throw new AppError("SYS-9004", { hint: "البطاقة غير موجودة" });

    await prisma.customerCard.update({ where: { id }, data: { is_active: false, is_default: false } });
    if (existing.is_default) {
      const next = await prisma.customerCard.findFirst({
        where: { user_id: claims.sub, is_active: true },
        orderBy: { created_at: "desc" }
      });
      if (next) await prisma.customerCard.update({ where: { id: next.id }, data: { is_default: true } });
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
