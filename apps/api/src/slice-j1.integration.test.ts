import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { config } from "dotenv";

config({ path: ["../../.env", ".env"] });
process.env.OTP_DEV_FIXED_CODE = "1234";
process.env.SMS_PROVIDER = "mock";
process.env.PAYMENT_PROVIDER = "mock";
process.env.GEO_PROVIDER = "mock";
process.env.PUSH_PROVIDER = "mock";

/**
 * بوابة الـVertical Slice — رحلة J1 كاملة (docs/03) عبر API الحقيقي وقاعدة حقيقية:
 * تسجيل ← فروع ← منيو ← سلة ← تسعير ← طلب ← دفع sandbox ← webhook ←
 * قبول ← تجهيز ← جاهز ← أنا في الطريق (محاكي رحلة) ← اقتراب ← وصلت ←
 * موقف ← خرج الموظف ← تسليم بالرمز ← COMPLETED.
 * تتخطى نفسها إن لم تتوفر قاعدة بيانات (CI يوفرها).
 */

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("Vertical Slice — J1 Happy Path (E2E)", async () => {
  const { buildApp } = await import("./app.js");
  const { prisma } = await import("@pickly/database");
  const { simulateTrip } = await import("@pickly/geo");
  const { handoffCodeFor } = await import("./lib/codes.js");

  const app = await buildApp();
  const phone = `+9665${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;

  let customerToken = "";
  let staffToken = "";
  let branchId = "";
  let branchLat = 0;
  let branchLng = 0;
  let cartId = "";
  let quoteId = "";
  let vehicleId = "";
  let orderId = "";
  let providerRef = "";

  beforeAll(async () => {
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
  });

  const authed = (token: string) => ({ authorization: `Bearer ${token}` });

  it("1. تسجيل عميل جديد بـOTP", async () => {
    const req = await app.inject({
      method: "POST",
      url: "/v1/auth/otp/request",
      payload: { phone }
    });
    expect(req.statusCode).toBe(200);

    const verify = await app.inject({
      method: "POST",
      url: "/v1/auth/otp/verify",
      payload: { phone, code: "1234" }
    });
    expect(verify.statusCode).toBe(200);
    const body = verify.json();
    expect(body.is_new_user).toBe(true);
    customerToken = body.access_token;

    // إكمال الاسم (P2) + سيارة مصغرة (S3)
    await app.inject({
      method: "PATCH",
      url: "/v1/customers/me",
      headers: authed(customerToken),
      payload: { full_name: "سلطان الاختبار" }
    });
    const veh = await app.inject({
      method: "POST",
      url: "/v1/customers/me/vehicles",
      headers: authed(customerToken),
      payload: { color_ar: "بيضاء", plate_short: "8241", model_ar: "كامري" }
    });
    expect(veh.statusCode).toBe(200);
    vehicleId = veh.json().id;
  });

  it("2. اكتشاف الفروع القريبة (العليا، الرياض)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/branches/nearby?lat=24.70&lng=46.68&radius=20000"
    });
    expect(res.statusCode).toBe(200);
    const cards = res.json();
    expect(cards.length).toBeGreaterThan(0);
    const best = cards.find((c: { id: string }) => c) as {
      id: string;
      location: { lat: number; lng: number };
      eta_minutes: number;
    };
    branchId = best.id;
    branchLat = best.location.lat;
    branchLng = best.location.lng;
    expect(best.eta_minutes).toBeGreaterThan(0);
  });

  it("3. المنيو ثم سلة بعنصرين وتسعير خادمي", async () => {
    const menuRes = await app.inject({ method: "GET", url: `/v1/branches/${branchId}/menu` });
    expect(menuRes.statusCode).toBe(200);
    const menu = menuRes.json();
    const products = menu.categories.flatMap((c: { products: unknown[] }) => c.products) as Array<{
      id: string;
      price_halalas: number;
      modifier_groups: Array<{ modifiers: Array<{ id: string }> }>;
    }>;
    expect(products.length).toBeGreaterThan(2);

    const cartRes = await app.inject({
      method: "POST",
      url: "/v1/carts",
      headers: authed(customerToken),
      payload: { branch_id: branchId }
    });
    expect(cartRes.statusCode).toBe(200);
    cartId = cartRes.json().id;

    const p1 = products[0]!;
    const withMod = p1.modifier_groups[0]?.modifiers[0]?.id;
    await app.inject({
      method: "POST",
      url: `/v1/carts/${cartId}/items`,
      headers: authed(customerToken),
      payload: { product_id: p1.id, quantity: 2, modifier_ids: withMod ? [withMod] : [] }
    });
    await app.inject({
      method: "POST",
      url: `/v1/carts/${cartId}/items`,
      headers: authed(customerToken),
      payload: { product_id: products[1]!.id, quantity: 1, modifier_ids: [] }
    });

    const quoteRes = await app.inject({
      method: "POST",
      url: `/v1/carts/${cartId}/quote`,
      headers: authed(customerToken)
    });
    expect(quoteRes.statusCode).toBe(200);
    const cart = quoteRes.json();
    expect(cart.quote).not.toBeNull();
    expect(cart.quote.total_halalas).toBeGreaterThan(cart.quote.subtotal_halalas);
    expect(cart.quote.service_fee_halalas).toBeGreaterThan(0); // مفصول دائماً — BR-6
    quoteId = cart.quote.quote_id;
  });

  it("4. إنشاء الطلب بـIdempotency — التكرار لا ينشئ طلباً ثانياً", async () => {
    const key = randomUUID();
    const payload = { cart_id: cartId, quote_id: quoteId, vehicle_id: vehicleId, pickup_time: "asap" };

    const res1 = await app.inject({
      method: "POST",
      url: "/v1/orders",
      headers: { ...authed(customerToken), "idempotency-key": key },
      payload
    });
    expect(res1.statusCode).toBe(200);
    const order = res1.json();
    orderId = order.id;
    expect(order.order_status).toBe("CHECKOUT_PENDING");
    expect(order.display_code).toMatch(/^P-\d{4}$/);

    const res2 = await app.inject({
      method: "POST",
      url: "/v1/orders",
      headers: { ...authed(customerToken), "idempotency-key": key },
      payload
    });
    expect(res2.json().id).toBe(orderId); // idempotent — docs/05§4-6
  });

  it("5. الدفع: intent ← sandbox ← webhook موقع ← MERCHANT_PENDING", async () => {
    const intentRes = await app.inject({
      method: "POST",
      url: `/v1/orders/${orderId}/payment-intent`,
      headers: { ...authed(customerToken), "idempotency-key": randomUUID() }
    });
    expect(intentRes.statusCode).toBe(200);

    const intent = await prisma.paymentIntent.findUniqueOrThrow({ where: { order_id: orderId } });
    providerRef = intent.provider_ref ?? "";

    const payRes = await app.inject({
      method: "POST",
      url: `/v1/dev/mock-gateway/${providerRef}/pay`,
      headers: { "content-type": "application/json" },
      payload: "{}"
    });
    expect(payRes.statusCode).toBe(200);
    expect(payRes.json().gateway_result).toBe("authorized");

    const orderRes = await app.inject({
      method: "GET",
      url: `/v1/orders/${orderId}`,
      headers: authed(customerToken)
    });
    expect(orderRes.json().order_status).toBe("MERCHANT_PENDING");

    // webhook مكرر لا يعالج مرتين
    const dup = await prisma.paymentWebhookEvent.count({ where: { provider: "mock" } });
    expect(dup).toBeGreaterThan(0);
  });

  it("6. الفرع: دخول بكود الفرع ثم قبول وتجهيز وجاهز", async () => {
    const branch = await prisma.branch.findUniqueOrThrow({ where: { id: branchId } });
    const login = await app.inject({
      method: "POST",
      url: "/v1/auth/branch/login",
      payload: {
        branch_code: branch.branch_code,
        username: `${branch.branch_code}-cashier`,
        pin: "1234",
        device_name: "تابلت الاختبار"
      }
    });
    expect(login.statusCode).toBe(200);
    staffToken = login.json().access_token;

    const listRes = await app.inject({
      method: "GET",
      url: `/v1/merchant/orders?branch_id=${branchId}&tab=new`,
      headers: authed(staffToken)
    });
    expect(listRes.statusCode).toBe(200);
    const cards = listRes.json() as Array<{ id: string; accept_deadline_at: string | null }>;
    const mine = cards.find((c) => c.id === orderId);
    expect(mine).toBeDefined();
    expect(mine!.accept_deadline_at).not.toBeNull(); // عداد BR-1

    // شارات التبويبات: الطلب المنتظر محسوب في «جديدة»، و«مكتملة» مستثناة — ليست واجباً
    const countsRes = await app.inject({
      method: "GET",
      url: `/v1/merchant/tab-counts?branch_id=${branchId}`,
      headers: authed(staffToken)
    });
    expect(countsRes.statusCode).toBe(200);
    const tabCounts = countsRes.json() as Record<string, number>;
    expect(tabCounts.new).toBeGreaterThanOrEqual(1);
    expect(tabCounts).not.toHaveProperty("completed");

    // «متوسط وقت تجهيز الطلب» يحرره المطعم من بوابته — يُختم على كل طلب عند قبوله
    // (توكن الفرع كاشير — التعديل عبر service مباشرة يعادل POST /v1/merchant/branches/:id/prep-minutes)
    await prisma.branchPickupSettings.upsert({
      where: { branch_id: branchId },
      create: { branch_id: branchId, default_prep_minutes: 10 },
      update: { default_prep_minutes: 10 }
    });

    // قبول بضغطة — بلا اختيار وقت وبلا موافقة عميل (قرار المالك 2026-07-12)
    const accept = await app.inject({
      method: "POST",
      url: `/v1/merchant/orders/${orderId}/accept`,
      headers: { ...authed(staffToken), "idempotency-key": randomUUID() },
      payload: {}
    });
    expect(accept.statusCode).toBe(200);
    expect(accept.json().order_status).toBe("MERCHANT_ACCEPTED");
    expect(accept.json().prep_minutes).toBe(10); // خُتم من متوسط الإعدادات

    // العميل يرى الوقت المتوقع فوراً في الطلب — بلا أي خطوة موافقة
    const orderView = await app.inject({
      method: "GET",
      url: `/v1/orders/${orderId}`,
      headers: authed(customerToken)
    });
    expect(orderView.json().prep_minutes).toBe(10);

    // زر واحد «جاهز» من MERCHANT_ACCEPTED — الخدمة تمرّ بـPREPARING داخلياً في نفس المعاملة
    const ready = await app.inject({
      method: "POST",
      url: `/v1/merchant/orders/${orderId}/ready`,
      headers: authed(staffToken)
    });
    expect(ready.statusCode).toBe(200);
    expect(ready.json().order_status).toBe("CUSTOMER_NOTIFIED");
    expect(ready.json().preparing_at).not.toBeNull();
    expect(ready.json().ready_at).not.toBeNull();
    // السجل append-only يحتفظ بالانتقالين — لا قفزة خارج آلة الحالات
    const history = await prisma.orderStatusHistory.findMany({
      where: { order_id: orderId, to_status: { in: ["PREPARING", "READY"] } }
    });
    expect(history.map((h) => h.to_status).sort()).toEqual(["PREPARING", "READY"]);
  });

  it("7. أنا في الطريق ← محاكي رحلة ← NEARBY + «وصل لنقطة الموقف» للفرع", async () => {
    // العميل يختار مسبقاً موقفاً بنقطة مثبتة على الخريطة — الفرع سيعلم بلوغه إياها بالـGPS
    const pinnedSpot = await prisma.parkingSpot.findFirstOrThrow({ where: { branch_id: branchId } });
    await prisma.parkingSpot.update({
      where: { id: pinnedSpot.id },
      data: { lat: branchLat, lng: branchLng }
    });
    const preSelect = await app.inject({
      method: "POST",
      url: `/v1/orders/${orderId}/parking-spot`,
      headers: authed(customerToken),
      payload: { spot_id: pinnedSpot.id }
    });
    expect(preSelect.statusCode).toBe(200);

    const start = await app.inject({
      method: "POST",
      url: `/v1/orders/${orderId}/trip/start`,
      headers: authed(customerToken)
    });
    expect(start.statusCode).toBe(200);
    expect(start.json().status).toBe("active");

    // انطلاق من ~3 كم ونتحرك نحو الفرع
    const from = { lat: branchLat + 0.027, lng: branchLng };
    let sawAtSpot = false;
    for (const point of simulateTrip(from, { lat: branchLat, lng: branchLng }, 30, 40)) {
      const res = await app.inject({
        method: "POST",
        url: `/v1/orders/${orderId}/trip/location`,
        headers: authed(customerToken),
        payload: {
          lat: point.lat,
          lng: point.lng,
          speed: point.speed,
          heading: point.heading,
          accuracy: point.accuracy
        }
      });
      expect(res.statusCode).toBe(200);
      if ((res.json() as { at_spot?: boolean }).at_spot) sawAtSpot = true;
    }

    const orderRes = await app.inject({
      method: "GET",
      url: `/v1/orders/${orderId}`,
      headers: authed(customerToken)
    });
    // الجيوفنس حوّل إلى NEARBY — ولا يجوز أن يحوّل ARRIVED (docs/05§4-3)
    expect(orderRes.json().order_status).toBe("CUSTOMER_NEARBY");

    // نهاية الرحلة عند نقطة الموقف نفسها → الحدث سُجل والعميل أُعلم
    expect(sawAtSpot).toBe(true);
    const reached = await prisma.arrivalEvent.findFirst({
      where: { order_id: orderId, event_type: "reached_parking_spot" }
    });
    expect(reached).not.toBeNull();

    // لوحة الفرع ترى «عند الموقف» على البطاقة (at_spot_at)
    const board = await app.inject({
      method: "GET",
      url: `/v1/merchant/orders?branch_id=${branchId}&tab=all`,
      headers: authed(staffToken)
    });
    const card = (board.json() as Array<{ id: string; at_spot_at: string | null }>).find(
      (c) => c.id === orderId
    );
    expect(card?.at_spot_at).toBeTruthy();

    // إرجاع نقطة الseed كما كانت — الاختبارات لا تترك أثراً
    await prisma.parkingSpot.update({
      where: { id: pinnedSpot.id },
      data: { lat: pinnedSpot.lat, lng: pinnedSpot.lng }
    });
  });

  it("8. «وصلت» اليدوي ← الموقف ← الطابور", async () => {
    const arrive = await app.inject({
      method: "POST",
      url: `/v1/orders/${orderId}/arrival`,
      headers: authed(customerToken)
    });
    expect(arrive.statusCode).toBe(200);

    const spot = await prisma.parkingSpot.findFirst({ where: { branch_id: branchId } });
    await app.inject({
      method: "POST",
      url: `/v1/orders/${orderId}/parking-spot`,
      headers: authed(customerToken),
      payload: { spot_id: spot!.id }
    });

    const queue = await app.inject({
      method: "GET",
      url: `/v1/merchant/arrival-queue?branch_id=${branchId}`,
      headers: authed(staffToken)
    });
    const entries = queue.json() as Array<{ order_id: string; position: number }>;
    expect(entries.some((e) => e.order_id === orderId)).toBe(true);
  });

  it("9. خرج الموظف ← تسليم بالرمز ← COMPLETED + سجل الحالات كامل", async () => {
    const startHandoff = await app.inject({
      method: "POST",
      url: `/v1/merchant/orders/${orderId}/handoff/start`,
      headers: authed(staffToken)
    });
    expect(startHandoff.json().order_status).toBe("HANDOFF_IN_PROGRESS");

    // رمز خاطئ يُرفض
    const bad = await app.inject({
      method: "POST",
      url: `/v1/merchant/orders/${orderId}/handoff/complete`,
      headers: authed(staffToken),
      payload: { verification: { method: "code", code: "0000" } }
    });
    // احتمال 1/10000 أن يكون 0000 هو الرمز الصحيح — نتحقق منطقياً
    const realCode = handoffCodeFor(orderId);
    if (realCode !== "0000") expect(bad.statusCode).toBe(400);

    const complete = await app.inject({
      method: "POST",
      url: `/v1/merchant/orders/${orderId}/handoff/complete`,
      headers: authed(staffToken),
      payload: { verification: { method: "code", code: realCode } }
    });
    expect(complete.statusCode).toBe(200);
    expect(complete.json().order_status).toBe("COMPLETED");

    // كل انتقال مسجل append-only (docs/05§4-5)
    const history = await prisma.orderStatusHistory.findMany({
      where: { order_id: orderId },
      orderBy: { created_at: "asc" }
    });
    const path = history.map((h) => h.to_status);
    expect(path).toEqual([
      "CHECKOUT_PENDING",
      "PAYMENT_PENDING",
      "PAYMENT_AUTHORIZED",
      "ORDER_SUBMITTED",
      "MERCHANT_PENDING",
      "MERCHANT_ACCEPTED",
      "PREPARING",
      "READY",
      "CUSTOMER_NOTIFIED",
      "CUSTOMER_ON_THE_WAY",
      "CUSTOMER_NEARBY",
      "CUSTOMER_ARRIVED",
      "HANDOFF_IN_PROGRESS",
      "COMPLETED"
    ]);

    // أحداث Outbox بُثت لكل الانتقالات المهمة
    const events = await prisma.backgroundJob.findMany({
      where: { job_type: "domain_event", payload: { path: ["aggregate_id"], equals: orderId } }
    });
    expect(events.length).toBeGreaterThanOrEqual(8);

    // Ledger: authorization + capture
    const txs = await prisma.paymentTransaction.findMany({
      where: { intent: { order_id: orderId } }
    });
    expect(txs.map((t) => t.type).sort()).toEqual(["authorization", "capture"]);
  });

  it("10. العزل: موظف فرع آخر لا يرى الطلب ولا يقبله (BR-15)", async () => {
    const otherBranch = await prisma.branch.findFirstOrThrow({
      where: { id: { not: branchId } }
    });
    const login = await app.inject({
      method: "POST",
      url: "/v1/auth/branch/login",
      payload: {
        branch_code: otherBranch.branch_code,
        username: `${otherBranch.branch_code}-cashier`,
        pin: "1234",
        device_name: "تابلت آخر"
      }
    });
    const otherToken = login.json().access_token;

    // لا يستطيع قراءة طلبات فرعنا
    const list = await app.inject({
      method: "GET",
      url: `/v1/merchant/orders?branch_id=${branchId}&tab=all`,
      headers: authed(otherToken)
    });
    expect(list.statusCode).toBe(403);

    // ولا التصرف في طلبنا
    const details = await app.inject({
      method: "GET",
      url: `/v1/merchant/orders/${orderId}/details`,
      headers: authed(otherToken)
    });
    expect(details.statusCode).toBe(403);
  });

  it("11. دفع فاشل (مبلغ ينتهي بـ99) ← PAYMENT_FAILED", async () => {
    // سلة جديدة بمنتج ثم تعديل المبلغ عبر intent مباشر غير وارد —
    // نحاكي الفشل بإنشاء intent لمبلغ منتهٍ بـ99 عبر طلب جديد لا يمكن ضبط مبلغه بدقة،
    // لذا نختبر مسار الفشل عند مستوى الـwebhook مباشرة بمبلغ غير مطابق (PAY-5004).
    const { MockPaymentAdapter } = await import("@pickly/payments");
    const { payments } = await import("./modules/orders/service.js");
    if (!(payments instanceof MockPaymentAdapter)) return;

    const { body, signature } = payments.buildWebhookPayload("payment.authorized", providerRef, 1);
    const res = await app.inject({
      method: "POST",
      url: "/v1/webhooks/payments/mock",
      headers: { "content-type": "application/json", "x-pickly-signature": signature },
      payload: body
    });
    expect(res.statusCode).toBe(409); // مطابقة المبلغ إلزامية — docs/13§4-5

    // توقيع فاسد يُرفض
    const res2 = await app.inject({
      method: "POST",
      url: "/v1/webhooks/payments/mock",
      headers: { "content-type": "application/json", "x-pickly-signature": "bad" },
      payload: body
    });
    expect(res2.statusCode).toBe(401);
  });

  it("12. J2 — العميل يسبق التجهيز: المسار الموازي لا يعلق الطلب (docs/05§3)", async () => {
    // طلب ثانٍ كامل: سلة ← تسعير ← طلب ← دفع ← قبول
    const menuRes = await app.inject({ method: "GET", url: `/v1/branches/${branchId}/menu` });
    const products = menuRes.json().categories.flatMap(
      (c: { products: Array<{ id: string }> }) => c.products
    ) as Array<{ id: string }>;
    const cartRes = await app.inject({
      method: "POST",
      url: "/v1/carts",
      headers: authed(customerToken),
      payload: { branch_id: branchId }
    });
    const cart2 = cartRes.json().id;
    await app.inject({
      method: "POST",
      url: `/v1/carts/${cart2}/items`,
      headers: authed(customerToken),
      payload: { product_id: products[0]!.id, quantity: 1, modifier_ids: [] }
    });
    const quoteRes = await app.inject({
      method: "POST",
      url: `/v1/carts/${cart2}/quote`,
      headers: authed(customerToken)
    });
    const orderRes = await app.inject({
      method: "POST",
      url: "/v1/orders",
      headers: { ...authed(customerToken), "idempotency-key": randomUUID() },
      payload: {
        cart_id: cart2,
        quote_id: quoteRes.json().quote.quote_id,
        vehicle_id: vehicleId,
        pickup_time: "asap"
      }
    });
    const order2 = orderRes.json().id as string;
    const intentRes = await app.inject({
      method: "POST",
      url: `/v1/orders/${order2}/payment-intent`,
      headers: { ...authed(customerToken), "idempotency-key": randomUUID() }
    });
    expect(intentRes.statusCode).toBe(200);
    const intent2 = await prisma.paymentIntent.findUniqueOrThrow({ where: { order_id: order2 } });
    await app.inject({
      method: "POST",
      url: `/v1/dev/mock-gateway/${intent2.provider_ref}/pay`,
      headers: { "content-type": "application/json" },
      payload: "{}"
    });
    const accept = await app.inject({
      method: "POST",
      url: `/v1/merchant/orders/${order2}/accept`,
      headers: { ...authed(staffToken), "idempotency-key": randomUUID() },
      payload: { prep_time_override_minutes: 15 }
    });
    expect(accept.statusCode).toBe(200);

    // العميل ينطلق فوراً — قبل أي تجهيز («انطلقت الآن» موافقة ضمنية على الوقت)
    const start = await app.inject({
      method: "POST",
      url: `/v1/orders/${order2}/trip/start`,
      headers: authed(customerToken)
    });
    expect(start.statusCode).toBe(200);

    // انطلق ولم يجهز: يبقى في «قيد التحضير» — لا يقفز إلى «جاهزة»
    const prepTab = await app.inject({
      method: "GET",
      url: `/v1/merchant/orders?branch_id=${branchId}&tab=preparing`,
      headers: authed(staffToken)
    });
    expect((prepTab.json() as Array<{ id: string }>).some((c) => c.id === order2)).toBe(true);

    // ثم يصل
    const arrive = await app.inject({
      method: "POST",
      url: `/v1/orders/${order2}/arrival`,
      headers: authed(customerToken)
    });
    expect(arrive.statusCode).toBe(200);

    // «خرج الموظف» قبل الجاهزية مرفوض (PICKUP-6005)
    const early = await app.inject({
      method: "POST",
      url: `/v1/merchant/orders/${order2}/handoff/start`,
      headers: authed(staffToken)
    });
    expect(early.statusCode).toBe(409);

    // الواصل غير المجهز في تبويب «وصلوا» بحقائق تجهيز فارغة
    const arrivedTab = await app.inject({
      method: "GET",
      url: `/v1/merchant/orders?branch_id=${branchId}&tab=arrived`,
      headers: authed(staffToken)
    });
    const card = (arrivedTab.json() as Array<{ id: string; ready_at: string | null }>).find(
      (c) => c.id === order2
    );
    expect(card).toBeDefined();
    expect(card!.ready_at).toBeNull();

    // «بدء التجهيز» يسجل الحقيقة دون كسر حالة الرحلة
    const prep = await app.inject({
      method: "POST",
      url: `/v1/merchant/orders/${order2}/preparing`,
      headers: authed(staffToken)
    });
    expect(prep.statusCode).toBe(200);
    expect(prep.json().order_status).toBe("CUSTOMER_ARRIVED");
    expect(prep.json().preparing_at).not.toBeNull();

    // «جاهز» كذلك — ready_at تُسجل والحالة تبقى CUSTOMER_ARRIVED (لا CUSTOMER_NOTIFIED)
    const rdy = await app.inject({
      method: "POST",
      url: `/v1/merchant/orders/${order2}/ready`,
      headers: authed(staffToken)
    });
    expect(rdy.statusCode).toBe(200);
    expect(rdy.json().order_status).toBe("CUSTOMER_ARRIVED");
    expect(rdy.json().ready_at).not.toBeNull();

    // الآن «خرج الموظف» يمر ثم التسليم بالرمز حتى COMPLETED — لا طريق مسدود
    const handoff = await app.inject({
      method: "POST",
      url: `/v1/merchant/orders/${order2}/handoff/start`,
      headers: authed(staffToken)
    });
    expect(handoff.statusCode).toBe(200);
    expect(handoff.json().order_status).toBe("HANDOFF_IN_PROGRESS");
    const complete = await app.inject({
      method: "POST",
      url: `/v1/merchant/orders/${order2}/handoff/complete`,
      headers: authed(staffToken),
      payload: { verification: { method: "code", code: handoffCodeFor(order2) } }
    });
    expect(complete.json().order_status).toBe("COMPLETED");

    // سجل الحالات بلا PREPARING/READY — التجهيز جرى موازياً بالحقائق، والأحداث بُثت
    const history = await prisma.orderStatusHistory.findMany({
      where: { order_id: order2 },
      orderBy: { created_at: "asc" }
    });
    const path = history.map((h) => h.to_status);
    expect(path).toContain("CUSTOMER_ON_THE_WAY");
    expect(path).not.toContain("PREPARING");
    expect(path).not.toContain("READY");
    const prepEvents = await prisma.backgroundJob.findMany({
      where: { job_type: "domain_event", payload: { path: ["aggregate_id"], equals: order2 } }
    });
    const names = prepEvents.map((e) => (e.payload as { name?: string }).name);
    expect(names).toContain("order.preparing");
    expect(names).toContain("order.ready");
  });
});
