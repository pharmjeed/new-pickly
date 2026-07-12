import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config } from "dotenv";

config({ path: ["../../.env", ".env"] });
process.env.OTP_DEV_FIXED_CODE = "1234";
process.env.SMS_PROVIDER = "mock";
process.env.PAYMENT_PROVIDER = "mock";
process.env.GEO_PROVIDER = "mock";

/**
 * تبويبات العميل — العروض (C-17) + طلباتي (C-56/W-09) + المفضلة (C-18/C-64):
 * GET /v1/offers العام · GET /v1/customers/me/orders · دورة المفضلة كاملة،
 * مع عزل صارم بين عميلين (بيانات عميل لا تظهر لغيره).
 * تتخطى نفسها بلا DATABASE_URL.
 */
const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("تبويبات العميل — العروض وطلباتي والمفضلة", async () => {
  const { buildApp } = await import("./app.js");
  const { prisma } = await import("@pickly/database");

  const app = await buildApp();
  const authed = (token: string) => ({ authorization: `Bearer ${token}` });

  const randPhone = () => `+9665${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
  async function customerLogin(): Promise<{ token: string; userId: string }> {
    const phone = randPhone();
    await app.inject({ method: "POST", url: "/v1/auth/otp/request", payload: { phone } });
    const verify = await app.inject({
      method: "POST",
      url: "/v1/auth/otp/verify",
      payload: { phone, code: "1234" }
    });
    const token = verify.json().access_token as string;
    const me = await app.inject({ method: "GET", url: "/v1/customers/me", headers: authed(token) });
    return { token, userId: me.json().id as string };
  }

  let tokenA = "";
  let userA = "";
  let tokenB = "";
  let brandId = "";
  let branchId = "";
  let merchantId = "";
  const couponIds: string[] = [];
  const orderIds: string[] = [];

  beforeAll(async () => {
    await app.ready();
    const branch = await prisma.branch.findUniqueOrThrow({ where: { branch_code: "BB-OLAYA" } });
    branchId = branch.id;
    brandId = branch.brand_id;
    merchantId = branch.merchant_id;
    ({ token: tokenA, userId: userA } = await customerLogin());
    ({ token: tokenB } = await customerLogin());
  });

  afterAll(async () => {
    // الاختبارات لا تترك أثراً
    await prisma.favorite.deleteMany({ where: { brand_id: brandId, user_id: userA } });
    if (orderIds.length > 0) {
      await prisma.orderItem.deleteMany({ where: { order_id: { in: orderIds } } });
      await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    }
    if (couponIds.length > 0) await prisma.coupon.deleteMany({ where: { id: { in: couponIds } } });
    await app.close();
    await prisma.$disconnect();
  });

  // ===== العروض C-17 =====

  it("العروض: الكوبون الساري يظهر للجميع بلا مصادقة، والمنتهي وغير الفعّال لا يظهران", async () => {
    const mk = (code: string, extra: object) =>
      prisma.coupon.create({
        data: { code, type: "percent", value: 1000, is_active: true, ...extra }
      });
    const live = await mk(`TABS-LIVE-${Date.now()}`, { min_order_halalas: 3000 });
    const merchant = await mk(`TABS-M-${Date.now()}`, { merchant_id: merchantId });
    const ended = await mk(`TABS-ENDED-${Date.now()}`, { ends_at: new Date(Date.now() - 3600_000) });
    const off = await mk(`TABS-OFF-${Date.now()}`, { is_active: false });
    couponIds.push(live.id, merchant.id, ended.id, off.id);

    const res = await app.inject({ method: "GET", url: "/v1/offers" });
    expect(res.statusCode).toBe(200);
    const offers = res.json() as Array<{ id: string; code: string; merchant_name_ar: string | null }>;
    const ids = offers.map((o) => o.id);

    expect(ids).toContain(live.id);
    expect(ids).toContain(merchant.id);
    expect(ids).not.toContain(ended.id);
    expect(ids).not.toContain(off.id);

    // كوبون بيكلي عام بلا اسم مطعم؛ كوبون المطعم يحمل اسم علامته
    expect(offers.find((o) => o.id === live.id)?.merchant_name_ar).toBeNull();
    expect(offers.find((o) => o.id === merchant.id)?.merchant_name_ar).toBeTruthy();
  });

  // ===== طلباتي C-56 / W-09 =====

  it("طلباتي: طلبات العميل وحده تظهر، ومسودات ما قبل الدفع لا تظهر", async () => {
    const mkOrder = (status: "MERCHANT_PENDING" | "PAYMENT_PENDING", code: string) =>
      prisma.order.create({
        data: {
          display_code: code,
          user_id: userA,
          merchant_id: merchantId,
          branch_id: branchId,
          order_status: status,
          subtotal_halalas: 5000,
          vat_halalas: 750,
          service_fee_halalas: 0,
          total_halalas: 5750,
          handoff_code_hash: "test-hash",
          idempotency_key: `tabs-${code}-${Date.now()}`,
          items: {
            create: [
              { name_ar_snapshot: "برجر اختبار", quantity: 2, unit_price_halalas_snapshot: 2500, line_total_halalas: 5000 }
            ]
          }
        }
      });
    const visible = await mkOrder("MERCHANT_PENDING", `T-${Math.floor(Math.random() * 9000) + 1000}`);
    const draft = await mkOrder("PAYMENT_PENDING", `T-${Math.floor(Math.random() * 9000) + 1000}`);
    orderIds.push(visible.id, draft.id);

    const res = await app.inject({ method: "GET", url: "/v1/customers/me/orders", headers: authed(tokenA) });
    expect(res.statusCode).toBe(200);
    const orders = res.json() as Array<{
      id: string;
      brand_name_ar: string;
      items_count: number;
      items_preview_ar: string | null;
      total_halalas: number;
    }>;
    const mine = orders.find((o) => o.id === visible.id);
    expect(mine).toBeDefined();
    expect(mine?.items_count).toBe(2);
    expect(mine?.items_preview_ar).toContain("برجر اختبار");
    expect(mine?.total_halalas).toBe(5750);
    expect(mine?.brand_name_ar).toBeTruthy();
    // المسودة قبل الدفع لا تظهر
    expect(orders.map((o) => o.id)).not.toContain(draft.id);

    // العزل: عميل آخر لا يرى طلبات غيره
    const other = await app.inject({ method: "GET", url: "/v1/customers/me/orders", headers: authed(tokenB) });
    expect(other.statusCode).toBe(200);
    expect((other.json() as Array<{ id: string }>).map((o) => o.id)).not.toContain(visible.id);

    // وبلا مصادقة → 401
    const anon = await app.inject({ method: "GET", url: "/v1/customers/me/orders" });
    expect(anon.statusCode).toBe(401);
  });

  // ===== المفضلة C-18 / C-64 =====

  it("المفضلة: إضافة (idempotent) ← قراءة بأقرب فرع ← عزل ← حذف", async () => {
    // إضافة مرتين — القلب المكرر لا يفشل ولا يكرر
    for (let i = 0; i < 2; i++) {
      const put = await app.inject({
        method: "PUT",
        url: `/v1/customers/me/favorites/${brandId}`,
        headers: authed(tokenA)
      });
      expect(put.statusCode).toBe(200);
    }
    expect(await prisma.favorite.count({ where: { user_id: userA, brand_id: brandId } })).toBe(1);

    // القراءة بموقع — تعود العلامة بأقرب فرع نشط ومسافته
    const res = await app.inject({
      method: "GET",
      url: "/v1/customers/me/favorites?lat=24.7&lng=46.68",
      headers: authed(tokenA)
    });
    expect(res.statusCode).toBe(200);
    const favs = res.json() as Array<{
      brand_id: string;
      name_ar: string;
      branch_id: string | null;
      distance_meters: number | null;
    }>;
    const fav = favs.find((f) => f.brand_id === brandId);
    expect(fav).toBeDefined();
    expect(fav?.name_ar).toBeTruthy();
    expect(fav?.branch_id).toBeTruthy();
    expect(fav?.distance_meters).toBeGreaterThanOrEqual(0);

    // العزل: مفضلة عميل لا تظهر لغيره
    const other = await app.inject({ method: "GET", url: "/v1/customers/me/favorites", headers: authed(tokenB) });
    expect((other.json() as Array<{ brand_id: string }>).map((f) => f.brand_id)).not.toContain(brandId);

    // علامة غير موجودة → خطأ كتالوج
    const bogus = await app.inject({
      method: "PUT",
      url: "/v1/customers/me/favorites/00000000-0000-4000-8000-000000000000",
      headers: authed(tokenA)
    });
    expect(bogus.statusCode).toBeGreaterThanOrEqual(400);

    // الحذف — تختفي من القائمة
    const del = await app.inject({
      method: "DELETE",
      url: `/v1/customers/me/favorites/${brandId}`,
      headers: authed(tokenA)
    });
    expect(del.statusCode).toBe(200);
    const after = await app.inject({ method: "GET", url: "/v1/customers/me/favorites", headers: authed(tokenA) });
    expect((after.json() as Array<{ brand_id: string }>).map((f) => f.brand_id)).not.toContain(brandId);
  });
});
