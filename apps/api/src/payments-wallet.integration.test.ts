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
 * طرق الدفع المدارة + محفظة بيكلي (قرار المالك 2026-07-12 — docs/01§1):
 * - القائمة من السوبر أدمن (payments.methods) والعميل يقرأ الفعّالة فقط بترتيبها.
 * - intent بطريقة موقوفة يُرفض PAY-5001.
 * - إيداع/خصم أدمن بسبب مُدقق، والرصيد لا يهبط تحت الصفر (PAY-5006).
 * - دفع جزئي من المحفظة (الباقي عبر البوابة) ودفع كامل (تفويض فوري بلا بوابة).
 * - عزل المحفظة بين المستخدمين + قيود Ledger (wallet_redemption).
 * تتخطى نفسها بلا DATABASE_URL.
 */
const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("طرق الدفع + محفظة بيكلي", async () => {
  const { buildApp } = await import("./app.js");
  const { prisma } = await import("@pickly/database");
  const { invalidateFlagCache } = await import("./lib/flags.js");

  const app = await buildApp();
  beforeAll(async () => {
    await app.ready();
    for (const key of ["wallet_payments", "in_app_wallet"]) {
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
  const customerLogin = () => login(randomPhone());
  const adminLogin = () => login("+966510000001"); // مشرف عام من الseed

  /** سلة مسعرة جاهزة للطلب */
  async function readyCart(token: string, branch_code = "BB-OLAYA") {
    const branch = await prisma.branch.findUniqueOrThrow({ where: { branch_code } });
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
    const quoted = await app.inject({
      method: "POST",
      url: `/v1/carts/${cartId}/quote`,
      headers: authed(token)
    });
    return {
      branch,
      cartId,
      quote: quoted.json().quote as { quote_id: string; total_halalas: number },
      vehicleId: veh.json().id as string
    };
  }

  async function createOrder(token: string) {
    const c = await readyCart(token);
    const res = await app.inject({
      method: "POST",
      url: "/v1/orders",
      headers: { ...authed(token), "idempotency-key": randomUUID() },
      payload: { cart_id: c.cartId, quote_id: c.quote.quote_id, vehicle_id: c.vehicleId }
    });
    expect(res.statusCode).toBe(200);
    return { order: res.json() as { id: string; total_halalas: number }, ...c };
  }

  /** إيداع أدمن لمحفظة عميل بجواله — يعيد user_id */
  async function adminCredit(adminToken: string, phone: string, amount_halalas: number) {
    const view = await app.inject({
      method: "GET",
      url: `/v1/admin/wallet?phone=${encodeURIComponent(phone)}`,
      headers: authed(adminToken)
    });
    expect(view.statusCode).toBe(200);
    const user_id = view.json().user_id as string;
    const res = await app.inject({
      method: "POST",
      url: "/v1/admin/wallet/adjust",
      headers: authed(adminToken),
      payload: { user_id, amount_halalas, reason: "تعويض اختباري" }
    });
    expect(res.statusCode).toBe(200);
    return user_id;
  }

  describe("طرق الدفع من السوبر أدمن", () => {
    it("العميل يقرأ الفعّالة فقط بترتيب الأدمن، والموقوفة تُرفض في intent برمز PAY-5001", async () => {
      const admin = await adminLogin();
      // stc_pay موقوفة + بطاقة أولاً + شارة «جديد» على Apple Pay
      const save = await app.inject({
        method: "POST",
        url: "/v1/admin/payments/methods",
        headers: authed(admin),
        payload: {
          methods: [
            { key: "card", name_ar: "بطاقة — مدى وفيزا وماستركارد", desc_ar: null, badge_ar: null, is_active: true },
            { key: "apple_pay", name_ar: "Apple Pay", desc_ar: null, badge_ar: "جديد", is_active: true },
            { key: "stc_pay", name_ar: "stc pay", desc_ar: null, badge_ar: null, is_active: false }
          ],
          reason: "ترتيب اختباري"
        }
      });
      expect(save.statusCode).toBe(200);

      const pub = await app.inject({ method: "GET", url: "/v1/content/payment-methods" });
      const list = pub.json() as Array<{ key: string; badge_ar: string | null }>;
      expect(list.map((m) => m.key)).toEqual(["card", "apple_pay"]);
      expect(list[1]?.badge_ar).toBe("جديد");

      // intent بطريقة موقوفة → PAY-5001
      const token = await customerLogin();
      const { order } = await createOrder(token);
      const bad = await app.inject({
        method: "POST",
        url: `/v1/orders/${order.id}/payment-intent`,
        headers: { ...authed(token), "idempotency-key": randomUUID() },
        payload: { method: "stc_pay" }
      });
      expect(bad.statusCode).toBe(402);
      expect(bad.json().error.code).toBe("PAY-5001");

      // إعادة التفعيل الكامل حتى لا تتأثر بقية الاختبارات
      await app.inject({
        method: "POST",
        url: "/v1/admin/payments/methods",
        headers: authed(admin),
        payload: {
          methods: [
            { key: "apple_pay", name_ar: "Apple Pay", desc_ar: null, badge_ar: null, is_active: true },
            { key: "card", name_ar: "بطاقة — مدى وفيزا وماستركارد", desc_ar: null, badge_ar: null, is_active: true },
            { key: "stc_pay", name_ar: "stc pay", desc_ar: null, badge_ar: null, is_active: true }
          ],
          reason: "إعادة الافتراضي"
        }
      });
    });
  });

  describe("بطاقاتي — Tokenization فقط (قرار المالك 2026-07-12)", () => {
    it("الإضافة تحفظ token/brand/last4 فقط، والدفع بالبطاقة المحفوظة يصل MERCHANT_PENDING، وبطاقة غيري تُرفض", async () => {
      const token = await customerLogin();

      // رقم غير صحيح (Luhn) → يُرفض قبل الحفظ
      const bad = await app.inject({
        method: "POST",
        url: "/v1/customers/me/cards",
        headers: authed(token),
        payload: { card_number: "4111111111111112", exp_month: 12, exp_year: 30, cvv: "123" }
      });
      expect(bad.statusCode).toBe(400);

      const add = await app.inject({
        method: "POST",
        url: "/v1/customers/me/cards",
        headers: authed(token),
        payload: {
          card_number: "4111 1111 1111 1111",
          exp_month: 12,
          exp_year: 30,
          cvv: "123",
          holder_name: "ABDULMAJEED ALTURKI",
          set_default: true
        }
      });
      expect(add.statusCode).toBe(200);
      const card = add.json() as { id: string; brand: string; last4: string; is_default: boolean; expired: boolean };
      expect(card.brand).toBe("visa");
      expect(card.last4).toBe("1111");
      expect(card.is_default).toBe(true);
      expect(card.expired).toBe(false);

      // لا PAN في القاعدة — token البوابة فقط
      const stored = await prisma.customerCard.findUniqueOrThrow({ where: { id: card.id } });
      expect(stored.token.startsWith("mock_card_")).toBe(true);
      expect(JSON.stringify(stored)).not.toContain("4111111111111111");

      const list = await app.inject({ method: "GET", url: "/v1/customers/me/cards", headers: authed(token) });
      expect((list.json() as unknown[]).length).toBe(1);

      // الدفع بالبطاقة المحفوظة
      const { order } = await createOrder(token);
      const intent = await app.inject({
        method: "POST",
        url: `/v1/orders/${order.id}/payment-intent`,
        headers: { ...authed(token), "idempotency-key": randomUUID() },
        payload: { method: "card", card_id: card.id }
      });
      expect(intent.statusCode).toBe(200);
      const pay = await app.inject({ method: "POST", url: `/v1/dev/mock-gateway/by-order/${order.id}/pay` });
      expect(pay.json().gateway_result).toBe("authorized");
      const fresh = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(fresh.order_status).toBe("MERCHANT_PENDING");

      // عزل: بطاقة مستخدم آخر تُرفض PAY-5001
      const tokenB = await customerLogin();
      const { order: orderB } = await createOrder(tokenB);
      const foreign = await app.inject({
        method: "POST",
        url: `/v1/orders/${orderB.id}/payment-intent`,
        headers: { ...authed(tokenB), "idempotency-key": randomUUID() },
        payload: { method: "card", card_id: card.id }
      });
      expect(foreign.statusCode).toBe(402);
      expect(foreign.json().error.code).toBe("PAY-5001");

      // بطاقة منتهية الصلاحية تُرفض عند الدفع
      const me = await app.inject({ method: "GET", url: "/v1/customers/me", headers: authed(token) });
      const expiredCard = await prisma.customerCard.create({
        data: {
          user_id: me.json().id as string,
          provider: "mock",
          token: `mock_card_${randomUUID()}`,
          brand: "visa",
          last4: "9999",
          exp_month: 1,
          exp_year: 2024
        }
      });
      const { order: order2 } = await createOrder(token);
      const expiredRes = await app.inject({
        method: "POST",
        url: `/v1/orders/${order2.id}/payment-intent`,
        headers: { ...authed(token), "idempotency-key": randomUUID() },
        payload: { method: "card", card_id: expiredCard.id }
      });
      expect(expiredRes.statusCode).toBe(402);

      // الحذف الناعم — تختفي من القائمة
      const del = await app.inject({
        method: "DELETE",
        url: `/v1/customers/me/cards/${card.id}`,
        headers: authed(token)
      });
      expect(del.statusCode).toBe(200);
      const after = await app.inject({ method: "GET", url: "/v1/customers/me/cards", headers: authed(token) });
      expect((after.json() as Array<{ id: string }>).some((c) => c.id === card.id)).toBe(false);
    });
  });

  describe("محفظة بيكلي", () => {
    it("إيداع الأدمن يظهر للعميل، والخصم فوق الرصيد يُرفض PAY-5006، والمحفظة معزولة بين المستخدمين", async () => {
      const admin = await adminLogin();
      const phoneA = randomPhone();
      const tokenA = await login(phoneA);
      const tokenB = await customerLogin();

      const userA = await adminCredit(admin, phoneA, 25_00);

      const walletA = await app.inject({ method: "GET", url: "/v1/customers/me/wallet", headers: authed(tokenA) });
      expect(walletA.json().balance_halalas).toBe(25_00);
      expect(walletA.json().entries[0].entry_type).toBe("credit");

      // العزل: رصيد B لا يتأثر بإيداع A
      const walletB = await app.inject({ method: "GET", url: "/v1/customers/me/wallet", headers: authed(tokenB) });
      expect(walletB.json().balance_halalas).toBe(0);

      // خصم يتجاوز الرصيد → PAY-5006
      const over = await app.inject({
        method: "POST",
        url: "/v1/admin/wallet/adjust",
        headers: authed(admin),
        payload: { user_id: userA, amount_halalas: -30_00, reason: "خصم فوق الرصيد" }
      });
      expect(over.statusCode).toBe(403);
      expect(over.json().error.code).toBe("PAY-5006");
    });

    it("دفع جزئي: المحفظة تُحسم والباقي عبر البوابة، ويصل الطلب MERCHANT_PENDING بقيد wallet_redemption", async () => {
      const admin = await adminLogin();
      const phone = randomPhone();
      const token = await login(phone);
      await adminCredit(admin, phone, 10_00); // 10 ر.س — أقل من أي إجمالي

      const { order } = await createOrder(token);
      const intentRes = await app.inject({
        method: "POST",
        url: `/v1/orders/${order.id}/payment-intent`,
        headers: { ...authed(token), "idempotency-key": randomUUID() },
        payload: { method: "card", use_wallet: true }
      });
      expect(intentRes.statusCode).toBe(200);
      const intent = intentRes.json() as {
        amount_halalas: number;
        wallet_applied_halalas: number;
        status: string;
      };
      expect(intent.wallet_applied_halalas).toBe(10_00);
      expect(intent.amount_halalas).toBe(order.total_halalas - 10_00);
      expect(intent.status).toBe("requires_payment");

      // الرصيد حُجز فوراً
      const midWallet = await app.inject({ method: "GET", url: "/v1/customers/me/wallet", headers: authed(token) });
      expect(midWallet.json().balance_halalas).toBe(0);

      // إتمام البوابة → webhook → MERCHANT_PENDING
      const pay = await app.inject({ method: "POST", url: `/v1/dev/mock-gateway/by-order/${order.id}/pay` });
      expect(pay.json().gateway_result).toBe("authorized");
      const fresh = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(fresh.order_status).toBe("MERCHANT_PENDING");

      // Ledger: قيد wallet_redemption بحصة المحفظة
      const ledger = await prisma.paymentTransaction.findFirst({
        where: { type: "wallet_redemption", intent: { order_id: order.id } }
      });
      expect(ledger?.amount_halalas).toBe(10_00);
      expect(ledger?.debit_account).toBe("customer_wallet");
    });

    it("تغطية كاملة: تفويض فوري بلا بوابة، و«تحديث الصفحة» يعيد نفس الرد (idempotent)", async () => {
      const admin = await adminLogin();
      const phone = randomPhone();
      const token = await login(phone);
      await adminCredit(admin, phone, 500_00); // 500 ر.س — تغطي أي وجبة اختبارية

      const { order } = await createOrder(token);
      const key = randomUUID();
      const intentRes = await app.inject({
        method: "POST",
        url: `/v1/orders/${order.id}/payment-intent`,
        headers: { ...authed(token), "idempotency-key": key },
        payload: { method: "apple_pay", use_wallet: true }
      });
      expect(intentRes.statusCode).toBe(200);
      const intent = intentRes.json() as {
        amount_halalas: number;
        wallet_applied_halalas: number;
        status: string;
        provider: string;
      };
      expect(intent.status).toBe("authorized");
      expect(intent.amount_halalas).toBe(0);
      expect(intent.wallet_applied_halalas).toBe(order.total_halalas);
      expect(intent.provider).toBe("pickly_wallet");

      // الطلب دخل مسار الفرع دون أي نداء بوابة
      const fresh = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(fresh.order_status).toBe("MERCHANT_PENDING");

      // الرصيد صُرف بالكامل بقيد صرف واحد
      const wallet = await app.inject({ method: "GET", url: "/v1/customers/me/wallet", headers: authed(token) });
      expect(wallet.json().balance_halalas).toBe(500_00 - order.total_halalas);

      // Idempotency: نفس المفتاح يعيد نفس الرد دون صرف جديد
      const replay = await app.inject({
        method: "POST",
        url: `/v1/orders/${order.id}/payment-intent`,
        headers: { ...authed(token), "idempotency-key": key },
        payload: { method: "apple_pay", use_wallet: true }
      });
      expect(replay.statusCode).toBe(200);
      expect(replay.json().status).toBe("authorized");
      const walletAfter = await app.inject({ method: "GET", url: "/v1/customers/me/wallet", headers: authed(token) });
      expect(walletAfter.json().balance_halalas).toBe(500_00 - order.total_halalas);
    });
  });
});
