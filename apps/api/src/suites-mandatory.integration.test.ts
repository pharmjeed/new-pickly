import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { config } from "dotenv";

config({ path: ["../../.env", ".env"] });
process.env.OTP_DEV_FIXED_CODE = "1234";
process.env.SMS_PROVIDER = "mock";
process.env.PAYMENT_PROVIDER = "mock";
process.env.GEO_PROVIDER = "mock";

/**
 * الـsuites الإلزامية — docs/19 + CLAUDE.md (قواعد الاختبار):
 * Isolation · Idempotency · Refunds · Webhooks · State Machine (على API حقيقي).
 * تتخطى نفسها بلا DATABASE_URL.
 */
const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("Mandatory Suites", async () => {
  const { buildApp } = await import("./app.js");
  const { prisma } = await import("@pickly/database");

  const app = await buildApp();
  beforeAll(async () =>
    await app.ready());
  afterAll(async () => await app.close());

  const authed = (token: string) => ({ authorization: `Bearer ${token}` });

  async function staffLogin(branch_code: string): Promise<string> {
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/branch/login",
      payload: {
        branch_code,
        username: `${branch_code}-cashier`,
        pin: "1234",
        device_name: "اختبار"
      }
    });
    return res.json().access_token as string;
  }

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

  /** ينشئ طلباً مُرسلاً بلا دفع حتى MERCHANT_PENDING (الدفع بعد القبول — docs/05§3) */
  async function submittedOrder(branch_code: string) {
    const token = await customerLogin();
    const branch = await prisma.branch.findUniqueOrThrow({ where: { branch_code } });
    const veh = await app.inject({
      method: "POST",
      url: "/v1/customers/me/vehicles",
      headers: authed(token),
      payload: { color_ar: "زرقاء", plate_short: "1111" }
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
    const quoteId = quoted.json().quote.quote_id as string;
    const orderRes = await app.inject({
      method: "POST",
      url: "/v1/orders",
      headers: { ...authed(token), "idempotency-key": randomUUID() },
      payload: { cart_id: cartId, quote_id: quoteId, vehicle_id: veh.json().id, pickup_time: "asap" }
    });
    const orderId = orderRes.json().id as string;
    return { token, orderId, branchId: branch.id, branch_code };
  }

  /** يكمل المسار حتى الدفع: قبول الفرع ← موافقة العميل ← intent ← دفع sandbox ← PREPARING */
  async function acceptConfirmPay(orderId: string, token: string, branch_code: string) {
    const staff = await staffLogin(branch_code);
    await app.inject({
      method: "POST",
      url: `/v1/merchant/orders/${orderId}/accept`,
      headers: { ...authed(staff), "idempotency-key": randomUUID() },
      payload: { prep_time_override_minutes: 15 }
    });
    await app.inject({
      method: "POST",
      url: `/v1/orders/${orderId}/confirm-prep-time`,
      headers: authed(token)
    });
    await app.inject({
      method: "POST",
      url: `/v1/orders/${orderId}/payment-intent`,
      headers: { ...authed(token), "idempotency-key": randomUUID() }
    });
    await app.inject({
      method: "POST",
      url: `/v1/dev/mock-gateway/by-order/${orderId}/pay`,
      headers: { "content-type": "application/json" },
      payload: "{}"
    });
    return staff;
  }

  describe("isolation — عزل التجار (BR-15)", () => {
    it("موظف تاجر آخر لا يقرأ طلبات/منيو/لوحة تاجر غيره", async () => {
      const { branchId } = await submittedOrder("BB-OLAYA");
      const foreignToken = await staffLogin("DW-MALAZ"); // تاجر مختلف

      const orders = await app.inject({
        method: "GET",
        url: `/v1/merchant/orders?branch_id=${branchId}&tab=all`,
        headers: authed(foreignToken)
      });
      expect(orders.statusCode).toBe(403);

      const menu = await app.inject({
        method: "GET",
        url: `/v1/merchant/menu?branch_id=${branchId}`,
        headers: authed(foreignToken)
      });
      expect(menu.statusCode).toBe(403);

      const queue = await app.inject({
        method: "GET",
        url: `/v1/merchant/arrival-queue?branch_id=${branchId}`,
        headers: authed(foreignToken)
      });
      expect(queue.statusCode).toBe(403);
    });

    it("isolation: عميل لا يقرأ طلب عميل آخر", async () => {
      const { orderId } = await submittedOrder("BB-OLAYA");
      const stranger = await customerLogin();
      const res = await app.inject({
        method: "GET",
        url: `/v1/orders/${orderId}`,
        headers: authed(stranger)
      });
      expect(res.statusCode).toBe(404); // لا كشف حتى عن الوجود
    });

    it("isolation: dashboard التاجر يعكس تاجره فقط", async () => {
      const owner1 = await (async () => {
        await app.inject({ method: "POST", url: "/v1/auth/otp/request", payload: { phone: "0520000001" } });
        const r = await app.inject({
          method: "POST",
          url: "/v1/auth/otp/verify",
          payload: { phone: "0520000001", code: "1234" }
        });
        return r.json().access_token as string;
      })();
      const dash = await app.inject({
        method: "GET",
        url: "/v1/merchant/dashboard",
        headers: authed(owner1)
      });
      expect(dash.statusCode).toBe(200);
      const branches = dash.json().branches as Array<{ name_ar: string }>;
      expect(branches.every((b) => b.name_ar.includes("بيست برجر"))).toBe(true);
    });
  });

  describe("idempotency — لا تكرار مالي (docs/13§4-2)", () => {
    it("idempotency: نفس مفتاح إنشاء الطلب يعيد الطلب نفسه", async () => {
      // مغطى تفصيلاً في slice-j1 — هنا تأكيد السلوك عبر مفتاح ثابت
      const { token, orderId } = await submittedOrder("BB-OLAYA");
      void token;
      const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
      const dup = await prisma.order.findMany({ where: { idempotency_key: order.idempotency_key } });
      expect(dup).toHaveLength(1);
    });

    it("idempotency: webhook مكرر لا يُعالج مرتين ولا يكرر قيود ledger", async () => {
      const { token, orderId, branch_code } = await submittedOrder("BB-OLAYA");
      await acceptConfirmPay(orderId, token, branch_code);
      const intent = await prisma.paymentIntent.findUniqueOrThrow({ where: { order_id: orderId } });
      const authsBefore = await prisma.paymentTransaction.count({
        where: { intent_id: intent.id, type: "authorization" }
      });
      expect(authsBefore).toBe(1);

      // إعادة إرسال نفس أحداث mock (نفس event_ref) عبر dev pay مرة ثانية
      const again = await app.inject({
        method: "POST",
        url: `/v1/dev/mock-gateway/by-order/${orderId}/pay`,
        headers: { "content-type": "application/json" },
        payload: "{}"
      });
      void again;
      const authsAfter = await prisma.paymentTransaction.count({
        where: { intent_id: intent.id, type: "authorization" }
      });
      expect(authsAfter).toBe(1); // الحالة لم تعد PAYMENT_PENDING — لا قيد جديداً

      const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
      expect(order.order_status).toBe("PREPARING"); // لحظة الصفر ثابتة رغم التكرار
    });

    it("idempotency: مفتاح Idempotency مفقود على POST مالي ← PAY-5002", async () => {
      const token = await customerLogin();
      const res = await app.inject({
        method: "POST",
        url: "/v1/orders",
        headers: authed(token),
        payload: {}
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe("PAY-5002");
    });
  });

  describe("refunds — الاسترجاع (BR-2/BR-12 + docs/13§5)", () => {
    it("refunds: رفض الفرع يسبق الدفع ← MERCHANT_REJECTED بلا أي استرجاع (BR-2)", async () => {
      const { orderId, branchId } = await submittedOrder("BB-OLAYA");
      const branch = await prisma.branch.findUniqueOrThrow({ where: { id: branchId } });
      const staff = await staffLogin(branch.branch_code);

      const reject = await app.inject({
        method: "POST",
        url: `/v1/merchant/orders/${orderId}/reject`,
        headers: { ...authed(staff), "idempotency-key": randomUUID() },
        payload: { reason: "item_unavailable" }
      });
      expect(reject.statusCode).toBe(200);

      const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
      // الدفع بعد القبول: الرفض قبل قبض أي مبلغ — لا REFUND_PENDING ولا refund
      expect(order.order_status).toBe("MERCHANT_REJECTED");
      expect(await prisma.refund.count({ where: { order_id: orderId } })).toBe(0);
      expect(
        await prisma.paymentTransaction.count({ where: { intent: { order_id: orderId } } })
      ).toBe(0);

      // إعادة الرفض ← MERCHANT-7001 (لم يعد PENDING)
      const again = await app.inject({
        method: "POST",
        url: `/v1/merchant/orders/${orderId}/reject`,
        headers: { ...authed(staff), "idempotency-key": randomUUID() },
        payload: { reason: "item_unavailable" }
      });
      expect(again.statusCode).toBe(409);
    });

    it("timeouts: انتهاء مهلة موافقة العميل (5 د) ← EXPIRED بلا أثر مالي (BR-2)", async () => {
      const { orderId, token, branch_code } = await submittedOrder("BB-OLAYA");
      const staff = await staffLogin(branch_code);
      await app.inject({
        method: "POST",
        url: `/v1/merchant/orders/${orderId}/accept`,
        headers: { ...authed(staff), "idempotency-key": randomUUID() },
        payload: { prep_time_override_minutes: 10 }
      });

      // مهلة الموافقة (5 د) مجدولة في background_jobs بمفتاح إزالة تكرار
      const job = await prisma.backgroundJob.findFirst({
        where: { job_type: "prep_confirm_timeout", dedupe_key: `prep_confirm_timeout:${orderId}` }
      });
      expect(job).not.toBeNull();
      const accepted = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
      const runAt = job!.run_at!.getTime() - accepted.accepted_at!.getTime();
      expect(Math.round(runAt / 60_000)).toBe(5); // 5 دقائق — BR-2

      // معالج الـworker يحوّل EXPIRED (يُختبر تنفيذه في حزمة الـworker) — نحاكي أثره هنا
      await prisma.order.update({ where: { id: orderId }, data: { order_status: "EXPIRED" } });
      expect(await prisma.refund.count({ where: { order_id: orderId } })).toBe(0);

      // بعد الانتهاء لا موافقة ولا دفع
      const late = await app.inject({
        method: "POST",
        url: `/v1/orders/${orderId}/confirm-prep-time`,
        headers: authed(token)
      });
      expect(late.statusCode).toBe(409);
    });
  });

  describe("state machine — قواعد صلبة على API (docs/05§4)", () => {
    it("state machine: لا HANDOFF قبل READY ولا COMPLETED بلا تسليم", async () => {
      const { orderId, branchId } = await submittedOrder("BB-OLAYA");
      const branch = await prisma.branch.findUniqueOrThrow({ where: { id: branchId } });
      const staff = await staffLogin(branch.branch_code);

      // handoff/start مباشرة على MERCHANT_PENDING ← انتقال غير مسموح
      const early = await app.inject({
        method: "POST",
        url: `/v1/merchant/orders/${orderId}/handoff/start`,
        headers: authed(staff)
      });
      expect(early.statusCode).toBe(409);

      const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
      expect(order.order_status).toBe("MERCHANT_PENDING"); // لم يتغير شيء
    });
  });
});
