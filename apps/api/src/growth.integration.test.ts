import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { config } from "dotenv";

config({ path: ["../../.env", ".env"] });
process.env.OTP_DEV_FIXED_CODE = "1234";
process.env.SMS_PROVIDER = "mock";
process.env.PAYMENT_PROVIDER = "mock";
process.env.GEO_PROVIDER = "mock";
process.env.FEATURE_FLAGS_REFRESH_SECONDS = "0";

/**
 * النمو (قرار المالك 2026-07-19): نقاط المكافآت + دعوة الأصدقاء + ملف العميل بالأدمن + حذف الحساب:
 * - كود الدعوة دائم، لا يقبل العميل كوده، والتسجيل مرة واحدة وقبل أول طلب مكتمل.
 * - منح النقاط ومكافأة الدعوة idempotent — الاستدعاء المكرر لا يضاعف.
 * - ملف العميل الشامل للأدمن فقط، وتسوية النقاط لا تهبط تحت الصفر.
 * - حذف الحساب يُرفض مع طلب مفتوح، وينهي الجلسات ويمنع الدخول.
 * تتخطى نفسها بلا DATABASE_URL.
 */
const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("النقاط والدعوة وملف العميل", async () => {
  const { buildApp } = await import("./app.js");
  const { prisma } = await import("@pickly/database");
  const { invalidateFlagCache } = await import("./lib/flags.js");
  const { awardOrderGrowth } = await import("./modules/growth/service.js");

  const app = await buildApp();
  beforeAll(async () => {
    await app.ready();
    for (const key of ["in_app_wallet", "loyalty_points", "referral_program"]) {
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

  async function login(phone: string): Promise<string> {
    await app.inject({ method: "POST", url: "/v1/auth/otp/request", payload: { phone } });
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/otp/verify",
      payload: { phone, code: "1234" }
    });
    return res.json().access_token as string;
  }

  const randomPhone = () => `+9665${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
  const adminLogin = () => login("+966510000001"); // مشرف عام من الseed

  async function referralOf(token: string) {
    const res = await app.inject({ method: "GET", url: "/v1/customers/me/referral", headers: authed(token) });
    expect(res.statusCode).toBe(200);
    return res.json() as {
      code: string;
      invited_count: number;
      rewarded_count: number;
      can_redeem: boolean;
      redeemed_code: string | null;
      referrer_reward_halalas: number;
      friend_reward_halalas: number;
    };
  }

  async function walletBalanceOf(token: string): Promise<number> {
    const res = await app.inject({ method: "GET", url: "/v1/customers/me/wallet", headers: authed(token) });
    expect(res.statusCode).toBe(200);
    return res.json().balance_halalas as number;
  }

  async function pointsOf(token: string): Promise<number> {
    const res = await app.inject({ method: "GET", url: "/v1/customers/me/rewards", headers: authed(token) });
    expect(res.statusCode).toBe(200);
    return res.json().points as number;
  }

  /** طلب مدفوع عبر بوابة الاختبار — يصل MERCHANT_PENDING (طلب مفتوح) */
  async function paidOrder(token: string) {
    const branch = await prisma.branch.findUniqueOrThrow({ where: { branch_code: "101" } });
    const veh = await app.inject({
      method: "POST",
      url: "/v1/customers/me/vehicles",
      headers: authed(token),
      payload: { color_ar: "بيضاء", plate_short: "7777" }
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
    const quoted = await app.inject({ method: "POST", url: `/v1/carts/${cartId}/quote`, headers: authed(token) });
    const quote = quoted.json().quote as { quote_id: string; total_halalas: number };
    const orderRes = await app.inject({
      method: "POST",
      url: "/v1/orders",
      headers: { ...authed(token), "idempotency-key": randomUUID() },
      payload: { cart_id: cartId, quote_id: quote.quote_id, vehicle_id: veh.json().id as string }
    });
    expect(orderRes.statusCode).toBe(200);
    const order = orderRes.json() as { id: string; total_halalas: number };
    const intent = await app.inject({
      method: "POST",
      url: `/v1/orders/${order.id}/payment-intent`,
      headers: { ...authed(token), "idempotency-key": randomUUID() },
      payload: { method: "apple_pay" }
    });
    expect(intent.statusCode).toBe(200);
    const pay = await app.inject({ method: "POST", url: `/v1/dev/mock-gateway/by-order/${order.id}/pay` });
    expect(pay.json().gateway_result).toBe("authorized");
    return order;
  }

  describe("دعوة الأصدقاء", () => {
    it("الكود دائم ولا يقبل العميل كوده ولا كوداً وهمياً", async () => {
      const a = await login(randomPhone());
      const ref1 = await referralOf(a);
      expect(ref1.code).toMatch(/^[A-Z0-9]{6,8}$/);
      const ref2 = await referralOf(a);
      expect(ref2.code).toBe(ref1.code); // يثبت ولا يتبدل

      const self = await app.inject({
        method: "POST",
        url: "/v1/customers/me/referral/redeem",
        headers: authed(a),
        payload: { code: ref1.code }
      });
      expect(self.statusCode).not.toBe(200);

      const fake = await app.inject({
        method: "POST",
        url: "/v1/customers/me/referral/redeem",
        headers: authed(a),
        payload: { code: "ZZZZ99" }
      });
      expect(fake.statusCode).not.toBe(200);
    });

    it("التسجيل مرة واحدة، والمكافأة تُصرف مرة واحدة عند الاكتمال (idempotent)", async () => {
      const a = await login(randomPhone());
      const b = await login(randomPhone());
      const refA = await referralOf(a);

      const redeem = await app.inject({
        method: "POST",
        url: "/v1/customers/me/referral/redeem",
        headers: authed(b),
        payload: { code: refA.code }
      });
      expect(redeem.statusCode).toBe(200);

      // تكرار التسجيل أو كود آخر بعده — مرفوض
      const again = await app.inject({
        method: "POST",
        url: "/v1/customers/me/referral/redeem",
        headers: authed(b),
        payload: { code: refA.code }
      });
      expect(again.statusCode).not.toBe(200);

      const refB = await referralOf(b);
      expect(refB.redeemed_code).toBe(refA.code);
      expect(refB.can_redeem).toBe(false);
      expect((await referralOf(a)).invited_count).toBeGreaterThanOrEqual(1);

      // لا مكافأة قبل الاكتمال
      expect(await walletBalanceOf(a)).toBe(0);
      expect(await walletBalanceOf(b)).toBe(0);

      // طلب مدفوع للمدعو ثم منح النمو مرتين — القيم لا تتضاعف
      const order = await paidOrder(b);
      await prisma.$transaction((tx) => awardOrderGrowth(tx, order.id));
      await prisma.$transaction((tx) => awardOrderGrowth(tx, order.id));

      expect(await walletBalanceOf(b)).toBe(refA.friend_reward_halalas);
      expect(await walletBalanceOf(a)).toBe(refA.referrer_reward_halalas);
      expect((await referralOf(a)).rewarded_count).toBe(1);

      // النقاط: نقطة لكل ريال افتراضياً — مرة واحدة
      expect(await pointsOf(b)).toBe(Math.floor(order.total_halalas / 100));
    });

    it("من لديه طلب مكتمل لا يسجل كود دعوة", async () => {
      const a = await login(randomPhone());
      const c = await login(randomPhone());
      const order = await paidOrder(c);
      await prisma.order.update({ where: { id: order.id }, data: { order_status: "COMPLETED" } });

      const res = await app.inject({
        method: "POST",
        url: "/v1/customers/me/referral/redeem",
        headers: authed(c),
        payload: { code: (await referralOf(a)).code }
      });
      expect(res.statusCode).not.toBe(200);
    });
  });

  describe("ملف العميل بالأدمن + تسوية النقاط", () => {
    it("الملف الشامل للأدمن فقط ويجمع المحفظة والنقاط والدعوة", async () => {
      const customer = await login(randomPhone());
      const meRes = await app.inject({ method: "GET", url: "/v1/customers/me", headers: authed(customer) });
      const customerId = meRes.json().id as string;

      const admin = await adminLogin();
      const file = await app.inject({
        method: "GET",
        url: `/v1/admin/customers/${customerId}`,
        headers: authed(admin)
      });
      expect(file.statusCode).toBe(200);
      const body = file.json();
      expect(body.wallet).toBeDefined();
      expect(body.rewards).toBeDefined();
      expect(body.referral).toBeDefined();
      expect(body.orders).toBeDefined();
      expect(body.profile).toBeDefined();

      // العميل نفسه لا يصل لمسار الأدمن
      const forbidden = await app.inject({
        method: "GET",
        url: `/v1/admin/customers/${customerId}`,
        headers: authed(customer)
      });
      expect(forbidden.statusCode).not.toBe(200);
    });

    it("تسوية النقاط بسبب — والخصم لا يهبط تحت الصفر", async () => {
      const customer = await login(randomPhone());
      const meRes = await app.inject({ method: "GET", url: "/v1/customers/me", headers: authed(customer) });
      const customerId = meRes.json().id as string;
      const admin = await adminLogin();

      const over = await app.inject({
        method: "POST",
        url: "/v1/admin/loyalty/adjust",
        headers: authed(admin),
        payload: { user_id: customerId, points: -50, reason: "اختبار خصم فوق الرصيد" }
      });
      expect(over.statusCode).not.toBe(200);

      const add = await app.inject({
        method: "POST",
        url: "/v1/admin/loyalty/adjust",
        headers: authed(admin),
        payload: { user_id: customerId, points: 120, reason: "تعويض اختباري" }
      });
      expect(add.statusCode).toBe(200);
      expect(await pointsOf(customer)).toBe(120);
    });
  });

  describe("حذف الحساب C-69", () => {
    it("يُرفض مع طلب مفتوح، وينفذ لعميل نظيف ويقطع الجلسة والدخول", async () => {
      // عميل بطلب مفتوح (MERCHANT_PENDING) — يُرفض
      const busy = await login(randomPhone());
      await paidOrder(busy);
      const rejected = await app.inject({
        method: "POST",
        url: "/v1/customers/me/delete-request",
        headers: authed(busy)
      });
      expect(rejected.statusCode).not.toBe(200);

      // عميل نظيف — ينفذ ثم تنقطع الجلسة والدخول
      const phone = randomPhone();
      const clean = await login(phone);
      const ok = await app.inject({
        method: "POST",
        url: "/v1/customers/me/delete-request",
        headers: authed(clean)
      });
      expect(ok.statusCode).toBe(200);

      const afterDelete = await app.inject({ method: "GET", url: "/v1/customers/me", headers: authed(clean) });
      expect(afterDelete.statusCode).toBe(401);

      await app.inject({ method: "POST", url: "/v1/auth/otp/request", payload: { phone } });
      const relogin = await app.inject({
        method: "POST",
        url: "/v1/auth/otp/verify",
        payload: { phone, code: "1234" }
      });
      expect(relogin.statusCode).not.toBe(200);
    });
  });
});
