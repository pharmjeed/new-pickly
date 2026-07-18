import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config } from "dotenv";

config({ path: ["../../.env", ".env"] });
process.env.OTP_DEV_FIXED_CODE = "1234";
process.env.SMS_PROVIDER = "mock";
process.env.PAYMENT_PROVIDER = "mock";
process.env.GEO_PROVIDER = "mock";

/**
 * إنشاء تاجر من السوبر أدمن — POST /v1/admin/merchants:
 * تاجر معتمد + علامة + مالك بدور merchant:owner يدخل بوابته بجواله عبر OTP.
 * تتخطى نفسها بلا DATABASE_URL.
 */
const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("إنشاء تاجر من لوحة السوبر أدمن", async () => {
  const { buildApp } = await import("./app.js");
  const { prisma } = await import("@pickly/database");

  const app = await buildApp();
  beforeAll(async () => await app.ready());
  afterAll(async () => await app.close());

  const authed = (token: string) => ({ authorization: `Bearer ${token}` });

  async function loginByPhone(phone: string): Promise<string> {
    await app.inject({ method: "POST", url: "/v1/auth/otp/request", payload: { phone } });
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/otp/verify",
      payload: { phone, code: "1234" }
    });
    return res.json().access_token as string;
  }

  const adminLogin = () => loginByPhone("+966510000001"); // مشرف عام من الseed

  const suffix = String(Math.floor(Math.random() * 1e8)).padStart(8, "0");
  const merchantName = `شركة اختبار الإنشاء ${suffix}`;
  const ownerPhoneLocal = `05${suffix.slice(0, 8)}`;
  const ownerPhoneE164 = `+9665${suffix.slice(0, 8)}`;

  it("ينشئ تاجراً معتمداً بعلامة ومالك، ويطبّع الجوال، والمالك يدخل بوابته", async () => {
    const adminToken = await adminLogin();
    const res = await app.inject({
      method: "POST",
      url: "/v1/admin/merchants",
      headers: authed(adminToken),
      payload: {
        name_ar: merchantName,
        cuisine_ar: "برجر",
        owner_name: "مالك تجريبي",
        owner_phone: ownerPhoneLocal,
        reason: "اختبار تكاملي لإنشاء تاجر"
      }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { id: string; owner_phone: string };
    expect(body.owner_phone).toBe(ownerPhoneE164);

    const merchant = await prisma.merchant.findUniqueOrThrow({ where: { id: body.id } });
    expect(merchant.status).toBe("approved");
    expect(merchant.plan_key).toBe("pilot_basic");

    // العلامة ترث اسم التاجر عند غياب brand_name_ar
    const brand = await prisma.brand.findFirstOrThrow({ where: { merchant_id: body.id } });
    expect(brand.name_ar).toBe(merchantName);
    expect(brand.cuisine_ar).toBe("برجر");

    // المالك: دور merchant:owner بنطاق التاجر + دخول ناجح لبوابته
    const owner = await prisma.user.findUniqueOrThrow({ where: { phone: ownerPhoneE164 } });
    const role = await prisma.role.findUniqueOrThrow({ where: { key: "merchant:owner" } });
    const link = await prisma.userRole.findFirst({
      where: { user_id: owner.id, role_id: role.id, merchant_id: body.id }
    });
    expect(link).not.toBeNull();

    const ownerToken = await loginByPhone(ownerPhoneE164);
    const branches = await app.inject({
      method: "GET",
      url: "/v1/merchant/branches",
      headers: authed(ownerToken)
    });
    expect(branches.statusCode).toBe(200);

    // الفعل دخل سجل التدقيق (BR-15)
    const auditEntry = await prisma.auditLog.findFirst({
      where: { action: "merchant_created", entity_id: body.id }
    });
    expect(auditEntry?.reason).toBe("اختبار تكاملي لإنشاء تاجر");
  });

  it("يرفض تكرار اسم التاجر", async () => {
    const adminToken = await adminLogin();
    const res = await app.inject({
      method: "POST",
      url: "/v1/admin/merchants",
      headers: authed(adminToken),
      payload: {
        name_ar: merchantName,
        owner_name: "مالك آخر",
        owner_phone: `05${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`,
        reason: "تكرار اسم"
      }
    });
    expect(res.statusCode).toBe(400);
  });

  it("عميل قائم يصبح مالكاً بنفس جواله ويحتفظ بواجهتي العميل والتاجر معاً", async () => {
    const customerPhone = `+9665${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
    await loginByPhone(customerPhone); // ينشئ حساب عميل
    const adminToken = await adminLogin();
    const res = await app.inject({
      method: "POST",
      url: "/v1/admin/merchants",
      headers: authed(adminToken),
      payload: {
        name_ar: `شركة عميل صار تاجراً ${Math.floor(Math.random() * 1e6)}`,
        owner_name: "عميل تاجر",
        owner_phone: customerPhone,
        reason: "قرار المالك: العميل يصبح تاجراً بلا مانع"
      }
    });
    expect(res.statusCode).toBe(200);

    // نفس التوكن بعد الدور الجديد يفتح البوابة ويظل عميلاً
    const dualToken = await loginByPhone(customerPhone);
    const portal = await app.inject({
      method: "GET",
      url: "/v1/merchant/branches",
      headers: authed(dualToken)
    });
    expect(portal.statusCode).toBe(200);
    const vehicle = await app.inject({
      method: "POST",
      url: "/v1/customers/me/vehicles",
      headers: authed(dualToken),
      payload: { color_ar: "بيضاء", plate_letters_ar: "ح د ص", plate_digits: "7777" }
    });
    expect(vehicle.statusCode).toBeLessThan(300);
  });

  it("يرفض جوالاً مرتبطاً بتاجر آخر", async () => {
    const adminToken = await adminLogin();
    const res = await app.inject({
      method: "POST",
      url: "/v1/admin/merchants",
      headers: authed(adminToken),
      payload: {
        name_ar: `شركة جوال مكرر ${Math.floor(Math.random() * 1e6)}`,
        owner_name: "مالك ثانٍ",
        owner_phone: ownerPhoneE164, // مالك التاجر المنشأ في الاختبار الأول
        reason: "جوال مالك قائم"
      }
    });
    expect(res.statusCode).toBe(400);
  });

  it("يمنع غير الأدمن من الإنشاء", async () => {
    const customerToken = await loginByPhone(
      `+9665${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`
    );
    const res = await app.inject({
      method: "POST",
      url: "/v1/admin/merchants",
      headers: authed(customerToken),
      payload: {
        name_ar: "شركة غير مصرح",
        owner_name: "مالك",
        owner_phone: "0511111111",
        reason: "محاولة غير مصرح بها"
      }
    });
    expect(res.statusCode).toBe(403);
  });
});
