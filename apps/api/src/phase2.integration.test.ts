import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { config } from "dotenv";

config({ path: ["../../.env", ".env"] });
process.env.OTP_DEV_FIXED_CODE = "1234";
process.env.SMS_PROVIDER = "mock";
process.env.PAYMENT_PROVIDER = "mock";
process.env.GEO_PROVIDER = "mock";
// كاش الأعلام لحظي في الاختبارات — التبديل يظهر فوراً
process.env.FEATURE_FLAGS_REFRESH_SECONDS = "0";

/**
 * اختبارات مرحلة 2 — المؤجلات المفعلة:
 * BR-5 (سعة ذرّية، انتظار الفترة، تحرير الإلغاء) · «سأتحرك لاحقاً» ·
 * BR-7 (كوبون: خصم خادمي + redemption + سقف الاستخدام) ·
 * البحث C-11 · إشعارات C-62 · الدعم C-65/A-15 (بعزل) · Flags A-23 (كتابة بتدقيق) ·
 * المحفظة C-33 (method في intent).
 * تتخطى نفسها بلا DATABASE_URL.
 */
const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("Phase 2 — الميزات المؤجلة", async () => {
  const { buildApp } = await import("./app.js");
  const { prisma } = await import("@pickly/database");
  const { invalidateFlagCache } = await import("./lib/flags.js");

  const app = await buildApp();
  beforeAll(async () => {
    await app.ready();
    // الأعلام المطلوبة مفعلة (idempotent — الseed الجديد يفعّلها أصلاً)
    for (const key of ["scheduled_orders", "coupons_full", "wallet_payments", "search", "support_tickets"]) {
      await prisma.featureFlag.upsert({
        where: { key },
        create: { key, enabled: true },
        update: { enabled: true }
      });
    }
    invalidateFlagCache();
  });
  afterAll(async () => await app.close());

  const authed = (token: string) => ({ authorization: `Bearer ${token}` });

  async function customerLogin(): Promise<string> {
    const phone = `+9665${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
    await app.inject({ method: "POST", url: "/v1/auth/otp/request", payload: { phone } });
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/otp/verify",
      payload: { phone, code: "1234" }
    });
    return res.json().access_token as string;
  }

  async function adminLogin(): Promise<string> {
    const phone = "+966510000001"; // مشرف عام من الseed
    await app.inject({ method: "POST", url: "/v1/auth/otp/request", payload: { phone } });
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/otp/verify",
      payload: { phone, code: "1234" }
    });
    return res.json().access_token as string;
  }

  /** سلة مسعرة جاهزة للطلب */
  async function readyCart(token: string, branch_code = "BB-OLAYA") {
    const branch = await prisma.branch.findUniqueOrThrow({ where: { branch_code } });
    const veh = await app.inject({
      method: "POST",
      url: "/v1/customers/me/vehicles",
      headers: authed(token),
      payload: { color_ar: "بيضاء", plate_short: "2222" }
    });
    const cart = await app.inject({
      method: "POST",
      url: "/v1/carts",
      headers: authed(token),
      payload: { branch_id: branch.id }
    });
    const cartId = cart.json().id as string;
    const menuRes = await app.inject({ method: "GET", url: `/v1/branches/${branch.id}/menu` });
    const product = menuRes.json().categories[0].products[0];
    await app.inject({
      method: "POST",
      url: `/v1/carts/${cartId}/items`,
      headers: authed(token),
      payload: { product_id: product.id, quantity: 1, modifier_ids: [] }
    });
    const quoted = await app.inject({
      method: "POST",
      url: `/v1/carts/${cartId}/quote`,
      headers: authed(token)
    });
    return {
      branch,
      cartId,
      quote: quoted.json().quote as { quote_id: string; subtotal_halalas: number; discount_halalas: number; total_halalas: number },
      vehicleId: veh.json().id as string,
      productName: product.name_ar as string
    };
  }

  /** فترة سعة مستقبلية للفرع مع تفعيل الجدولة */
  async function makeSlot(branch_id: string, capacity: number, hoursAhead = 5) {
    await prisma.branchPickupSettings.upsert({
      where: { branch_id },
      create: { branch_id, scheduled_enabled: true },
      update: { scheduled_enabled: true }
    });
    const slot_start = new Date(Date.now() + hoursAhead * 3600 * 1000);
    return prisma.branchCapacitySlot.upsert({
      where: { branch_id_slot_start: { branch_id, slot_start } },
      create: {
        branch_id,
        slot_start,
        slot_end: new Date(slot_start.getTime() + 30 * 60_000),
        capacity
      },
      update: { capacity, booked: 0 }
    });
  }

  describe("BR-5 — الطلب المجدول", () => {
    it("الحجز يزيد booked ذرّياً، والفترة الممتلئة تُرفض ORDER-4006", async () => {
      const tokenA = await customerLogin();
      const a = await readyCart(tokenA);
      const slot = await makeSlot(a.branch.id, 1, 6);

      const okRes = await app.inject({
        method: "POST",
        url: "/v1/orders",
        headers: { ...authed(tokenA), "idempotency-key": randomUUID() },
        payload: {
          cart_id: a.cartId,
          quote_id: a.quote.quote_id,
          vehicle_id: a.vehicleId,
          pickup_time: "scheduled",
          slot_id: slot.id
        }
      });
      expect(okRes.statusCode).toBe(200);
      expect(okRes.json().pickup_time).toBe("scheduled");
      expect(okRes.json().scheduled_slot).not.toBeNull();

      const after = await prisma.branchCapacitySlot.findUniqueOrThrow({ where: { id: slot.id } });
      expect(after.booked).toBe(1);

      // السعة 1 امتلأت — عميل ثانٍ يُرفض
      const tokenB = await customerLogin();
      const b = await readyCart(tokenB);
      const fullRes = await app.inject({
        method: "POST",
        url: "/v1/orders",
        headers: { ...authed(tokenB), "idempotency-key": randomUUID() },
        payload: {
          cart_id: b.cartId,
          quote_id: b.quote.quote_id,
          vehicle_id: b.vehicleId,
          pickup_time: "scheduled",
          slot_id: slot.id
        }
      });
      expect(fullRes.statusCode).toBe(409);
      expect(fullRes.json().error.code).toBe("ORDER-4006");
    });

    it("المجدول ينتظر عند ORDER_SUBMITTED بلا دفع وتُجدول وظيفة دخول الفترة", async () => {
      const token = await customerLogin();
      const c = await readyCart(token);
      const slot = await makeSlot(c.branch.id, 5, 7);

      const orderRes = await app.inject({
        method: "POST",
        url: "/v1/orders",
        headers: { ...authed(token), "idempotency-key": randomUUID() },
        payload: {
          cart_id: c.cartId,
          quote_id: c.quote.quote_id,
          vehicle_id: c.vehicleId,
          pickup_time: "scheduled",
          slot_id: slot.id
        }
      });
      const orderId = orderRes.json().id as string;

      const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
      expect(order.order_status).toBe("ORDER_SUBMITTED"); // لا MERCHANT_PENDING قبل الفترة

      // الدفع بعد القبول: لا intent قبل دخول الفترة وقبول الفرع وموافقة العميل
      const early = await app.inject({
        method: "POST",
        url: `/v1/orders/${orderId}/payment-intent`,
        headers: { ...authed(token), "idempotency-key": randomUUID() },
        payload: { method: "card" }
      });
      expect(early.statusCode).toBe(409);

      const entryJob = await prisma.backgroundJob.findFirst({
        where: { job_type: "scheduled_slot_entry", dedupe_key: { contains: orderId } }
      });
      expect(entryJob).not.toBeNull();
    });

    it("إلغاء المجدول قبل فترته يحرّر السعة", async () => {
      const token = await customerLogin();
      const c = await readyCart(token);
      const slot = await makeSlot(c.branch.id, 3, 8);

      const orderRes = await app.inject({
        method: "POST",
        url: "/v1/orders",
        headers: { ...authed(token), "idempotency-key": randomUUID() },
        payload: {
          cart_id: c.cartId,
          quote_id: c.quote.quote_id,
          vehicle_id: c.vehicleId,
          pickup_time: "scheduled",
          slot_id: slot.id
        }
      });
      const orderId = orderRes.json().id as string;
      const booked = await prisma.branchCapacitySlot.findUniqueOrThrow({ where: { id: slot.id } });
      expect(booked.booked).toBe(1);

      const cancelRes = await app.inject({
        method: "POST",
        url: `/v1/orders/${orderId}/cancel`,
        headers: { ...authed(token), "idempotency-key": randomUUID() },
        payload: { reason: "changed_mind" }
      });
      expect(cancelRes.statusCode).toBe(200);

      const released = await prisma.branchCapacitySlot.findUniqueOrThrow({ where: { id: slot.id } });
      expect(released.booked).toBe(0);
    });

    it("الجدولة على فرع غير مفعّلها تُرفض ORDER-4007", async () => {
      const token = await customerLogin();
      const c = await readyCart(token, "DW-MALAZ");
      await prisma.branchPickupSettings.upsert({
        where: { branch_id: c.branch.id },
        create: { branch_id: c.branch.id, scheduled_enabled: false },
        update: { scheduled_enabled: false }
      });
      const res = await app.inject({
        method: "POST",
        url: "/v1/orders",
        headers: { ...authed(token), "idempotency-key": randomUUID() },
        payload: {
          cart_id: c.cartId,
          quote_id: c.quote.quote_id,
          vehicle_id: c.vehicleId,
          pickup_time: "scheduled",
          slot_id: randomUUID()
        }
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe("ORDER-4007");
    });
  });

  describe("FR-C06 — «سأتحرك لاحقاً»", () => {
    it("يُخزن على الطلب ويظهر لبطاقة الفرع", async () => {
      const token = await customerLogin();
      const c = await readyCart(token);
      const orderRes = await app.inject({
        method: "POST",
        url: "/v1/orders",
        headers: { ...authed(token), "idempotency-key": randomUUID() },
        payload: {
          cart_id: c.cartId,
          quote_id: c.quote.quote_id,
          vehicle_id: c.vehicleId,
          pickup_time: "later"
        }
      });
      expect(orderRes.statusCode).toBe(200);
      expect(orderRes.json().pickup_time).toBe("later");
      const order = await prisma.order.findUniqueOrThrow({ where: { id: orderRes.json().id } });
      expect(order.pickup_time).toBe("later");
    });
  });

  describe("BR-7 — الكوبونات", () => {
    it("percent يخصم خادمياً ويسجل redemption عند الطلب، وسقف per-user يمنع التكرار", async () => {
      const code = `T${Math.floor(Math.random() * 1e6)}`;
      const coupon = await prisma.coupon.create({
        data: { code, type: "percent", value: 10, max_uses_per_user: 1 }
      });

      const token = await customerLogin();
      const c = await readyCart(token);

      const applied = await app.inject({
        method: "POST",
        url: `/v1/carts/${c.cartId}/coupon`,
        headers: authed(token),
        payload: { code }
      });
      expect(applied.statusCode).toBe(200);
      const cartJson = applied.json();
      expect(cartJson.coupon_code).toBe(code);
      const expected = Math.round(c.quote.subtotal_halalas * 0.1);
      expect(cartJson.quote.discount_halalas).toBe(expected);

      const orderRes = await app.inject({
        method: "POST",
        url: "/v1/orders",
        headers: { ...authed(token), "idempotency-key": randomUUID() },
        payload: {
          cart_id: c.cartId,
          quote_id: cartJson.quote.quote_id,
          vehicle_id: c.vehicleId,
          pickup_time: "asap"
        }
      });
      expect(orderRes.statusCode).toBe(200);
      const redemption = await prisma.couponRedemption.findFirst({ where: { coupon_id: coupon.id } });
      expect(redemption?.amount_halalas).toBe(expected);

      // نفس العميل — سلة ثانية: تجاوز سقف الاستخدام
      const c2 = await readyCart(token);
      const again = await app.inject({
        method: "POST",
        url: `/v1/carts/${c2.cartId}/coupon`,
        headers: authed(token),
        payload: { code }
      });
      expect(again.statusCode).toBe(400);
      expect(again.json().error.code).toBe("CART-3003");
    });
  });

  describe("C-11 — البحث", () => {
    it("يعيد منتجات ومطاعم مطابقة", async () => {
      const token = await customerLogin();
      const c = await readyCart(token);
      const term = c.productName.slice(0, 4);
      const res = await app.inject({
        method: "GET",
        url: `/v1/search?q=${encodeURIComponent(term)}&lat=24.7&lng=46.68`
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.products.length + body.branches.length).toBeGreaterThan(0);
    });
  });

  describe("C-62 + A-15 — الإشعارات والدعم", () => {
    it("تذكرة العميل معزولة عن غيره، ورد الأدمن يصل صندوق إشعاراته", async () => {
      const tokenA = await customerLogin();
      const created = await app.inject({
        method: "POST",
        url: "/v1/customers/me/support-tickets",
        headers: authed(tokenA),
        payload: { subject: "استفسار عن طلب", body: "أين طلبي؟" }
      });
      expect(created.statusCode).toBe(200);
      const ticketId = created.json().id as string;

      // عزل: عميل آخر لا يقرأ التذكرة
      const tokenB = await customerLogin();
      const foreign = await app.inject({
        method: "GET",
        url: `/v1/customers/me/support-tickets/${ticketId}`,
        headers: authed(tokenB)
      });
      expect(foreign.statusCode).toBe(400);

      // رد الأدمن → إشعار inapp للعميل
      const adminToken = await adminLogin();
      const reply = await app.inject({
        method: "POST",
        url: `/v1/admin/support-tickets/${ticketId}/reply`,
        headers: authed(adminToken),
        payload: { body: "طلبك قيد التجهيز" }
      });
      expect(reply.statusCode).toBe(200);

      const inbox = await app.inject({
        method: "GET",
        url: "/v1/customers/me/notifications",
        headers: authed(tokenA)
      });
      expect(inbox.statusCode).toBe(200);
      const list = inbox.json();
      expect(list.unread_count).toBeGreaterThan(0);
      expect(list.notifications.some((n: { template_key: string }) => n.template_key === "support_reply")).toBe(true);

      // تعليم الكل مقروءاً
      await app.inject({
        method: "POST",
        url: "/v1/customers/me/notifications/read",
        headers: { ...authed(tokenA), "content-type": "application/json" },
        payload: "{}"
      });
      const after = await app.inject({
        method: "GET",
        url: "/v1/customers/me/notifications",
        headers: authed(tokenA)
      });
      expect(after.json().unread_count).toBe(0);
    });
  });

  describe("A-23 — Feature Flags كتابة بتدقيق", () => {
    it("التبديل يغيّر العلم ويدخل audit_logs بسبب", async () => {
      const adminToken = await adminLogin();
      const key = `test_flag_${Math.floor(Math.random() * 1e6)}`;
      const res = await app.inject({
        method: "POST",
        url: `/v1/admin/flags/${key}`,
        headers: authed(adminToken),
        payload: { enabled: true, reason: "اختبار مرحلة 2" }
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().enabled).toBe(true);

      const flag = await prisma.featureFlag.findUniqueOrThrow({ where: { key } });
      expect(flag.enabled).toBe(true);
      const log = await prisma.auditLog.findFirst({
        where: { action: "feature_flag_set", entity_id: flag.id }
      });
      expect(log?.reason).toBe("اختبار مرحلة 2");
    });
  });

  describe("BR-5 — دوام الأسبوع (توليد الفترات من branch_hours)", () => {
    async function managerLogin(branch_code: string): Promise<string> {
      const res = await app.inject({
        method: "POST",
        url: "/v1/auth/branch/login",
        payload: { branch_code, username: `${branch_code}-manager`, pin: "1234", device_name: "اختبار" }
      });
      return res.json().access_token as string;
    }

    it("حفظ الدوام يولّد فترات الأيام السبعة ويوائم الفارغة مع القالب الجديد", async () => {
      const branch = await prisma.branch.findUniqueOrThrow({ where: { branch_code: "DW-MALAZ" } });
      const token = await managerLogin("DW-MALAZ");

      // فترة مستقبلية فارغة خارج القالب — الحفظ يجب أن يحذفها (مواءمة)
      const strayStart = new Date(Date.now() + 3 * 3600_000 + 17 * 60_000);
      const stray = await prisma.branchCapacitySlot.upsert({
        where: { branch_id_slot_start: { branch_id: branch.id, slot_start: strayStart } },
        create: {
          branch_id: branch.id,
          slot_start: strayStart,
          slot_end: new Date(strayStart.getTime() + 30 * 60_000),
          capacity: 4
        },
        update: { booked: 0 }
      });

      const res = await app.inject({
        method: "POST",
        url: "/v1/merchant/scheduled/week",
        headers: authed(token),
        payload: {
          branch_id: branch.id,
          slot_minutes: 30,
          capacity: 5,
          days: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ day_of_week: d, opens_at: "10:00", closes_at: "22:00" }))
        }
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().days).toBe(7);
      expect(res.json().slots).toBeGreaterThan(0);

      const gone = await prisma.branchCapacitySlot.findUnique({ where: { id: stray.id } });
      expect(gone).toBeNull();

      const week = await app.inject({
        method: "GET",
        url: `/v1/merchant/scheduled/week?branch_id=${branch.id}`,
        headers: authed(token)
      });
      expect(week.statusCode).toBe(200);
      expect(week.json().days.length).toBe(7);
      expect(week.json().slot_minutes).toBe(30);
      expect(week.json().capacity).toBe(5);

      const slots = await app.inject({
        method: "GET",
        url: `/v1/merchant/scheduled/slots?branch_id=${branch.id}`,
        headers: authed(token)
      });
      const list = slots.json() as { capacity: number }[];
      expect(list.length).toBeGreaterThan(0);
      expect(list.some((s) => s.capacity === 5)).toBe(true);
    });

    it("الدوام الممتد بعد منتصف الليل يُقبل ويولّد فترات", async () => {
      const branch = await prisma.branch.findUniqueOrThrow({ where: { branch_code: "DW-MALAZ" } });
      const token = await managerLogin("DW-MALAZ");
      const res = await app.inject({
        method: "POST",
        url: "/v1/merchant/scheduled/week",
        headers: authed(token),
        payload: {
          branch_id: branch.id,
          slot_minutes: 60,
          capacity: 3,
          days: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ day_of_week: d, opens_at: "18:00", closes_at: "02:00" }))
        }
      });
      expect(res.statusCode).toBe(200);
      // 8 ساعات × 7 أيام أفق — بعضها مضى اليوم؛ على الأقل 6 أيام كاملة
      expect(res.json().slots).toBeGreaterThanOrEqual(6 * 8);
    });

    it("isolation: مدير تاجر آخر لا يعدّل دوام فرع غيره (403)", async () => {
      const branch = await prisma.branch.findUniqueOrThrow({ where: { branch_code: "BB-OLAYA" } });
      const foreign = await managerLogin("DW-MALAZ");
      const res = await app.inject({
        method: "POST",
        url: "/v1/merchant/scheduled/week",
        headers: authed(foreign),
        payload: { branch_id: branch.id, slot_minutes: 30, capacity: 3, days: [] }
      });
      expect(res.statusCode).toBe(403);

      const read = await app.inject({
        method: "GET",
        url: `/v1/merchant/scheduled/week?branch_id=${branch.id}`,
        headers: authed(foreign)
      });
      expect(read.statusCode).toBe(403);
    });
  });

  describe("C-33 — وسيلة الدفع", () => {
    it("method=wallet تُخزن على intent وتمر بنفس مسار sandbox", async () => {
      const token = await customerLogin();
      const c = await readyCart(token);
      const orderRes = await app.inject({
        method: "POST",
        url: "/v1/orders",
        headers: { ...authed(token), "idempotency-key": randomUUID() },
        payload: {
          cart_id: c.cartId,
          quote_id: c.quote.quote_id,
          vehicle_id: c.vehicleId,
          pickup_time: "asap"
        }
      });
      const orderId = orderRes.json().id as string;

      // الدفع بعد القبول: قبول الفرع ثم موافقة العميل على الوقت قبل أي intent
      const staffRes = await app.inject({
        method: "POST",
        url: "/v1/auth/branch/login",
        payload: {
          branch_code: c.branch.branch_code,
          username: `${c.branch.branch_code}-cashier`,
          pin: "1234",
          device_name: "اختبار"
        }
      });
      const staff = staffRes.json().access_token as string;
      await app.inject({
        method: "POST",
        url: `/v1/merchant/orders/${orderId}/accept`,
        headers: { ...authed(staff), "idempotency-key": randomUUID() },
        payload: { prep_time_override_minutes: 10 }
      });
      await app.inject({
        method: "POST",
        url: `/v1/orders/${orderId}/confirm-prep-time`,
        headers: authed(token)
      });

      const intentRes = await app.inject({
        method: "POST",
        url: `/v1/orders/${orderId}/payment-intent`,
        headers: { ...authed(token), "idempotency-key": randomUUID() },
        payload: { method: "wallet" }
      });
      expect(intentRes.statusCode).toBe(200);
      const intent = await prisma.paymentIntent.findUniqueOrThrow({ where: { order_id: orderId } });
      expect(intent.method).toBe("wallet");

      const pay = await app.inject({
        method: "POST",
        url: `/v1/dev/mock-gateway/by-order/${orderId}/pay`,
        headers: { "content-type": "application/json" },
        payload: "{}"
      });
      expect(pay.json().gateway_result).toBe("authorized");
    });
  });
});
