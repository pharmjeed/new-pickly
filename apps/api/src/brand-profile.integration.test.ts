import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config } from "dotenv";

config({ path: ["../../.env", ".env"] });
process.env.OTP_DEV_FIXED_CODE = "1234";
process.env.SMS_PROVIDER = "mock";
process.env.PAYMENT_PROVIDER = "mock";
process.env.GEO_PROVIDER = "mock";

/**
 * M-02 الملف التعريفي — هوية العلامة (الشعار/الغلاف/الاسم/المطبخ):
 * القراءة للأدوار الإدارية، والتعديل للمالك/المدير العام فقط، مع عزل التجار.
 * تتخطى نفسها بلا DATABASE_URL.
 */
const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("Brand Profile (M-02)", async () => {
  const { buildApp } = await import("./app.js");
  const { prisma } = await import("@pickly/database");

  const app = await buildApp();
  const authed = (token: string) => ({ authorization: `Bearer ${token}` });
  const TINY_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==";

  let brandId = "";
  let original: { name_ar: string; name_en: string | null; cuisine_ar: string | null; logo_url: string | null } = {
    name_ar: "",
    name_en: null,
    cuisine_ar: null,
    logo_url: null
  };

  async function ownerLogin(phone: string): Promise<string> {
    await app.inject({ method: "POST", url: "/v1/auth/otp/request", payload: { phone } });
    const res = await app.inject({ method: "POST", url: "/v1/auth/otp/verify", payload: { phone, code: "1234" } });
    return res.json().access_token as string;
  }

  async function staffLogin(branch_code: string, username: string): Promise<string> {
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/branch/login",
      payload: { branch_code, username, pin: "1234", device_name: "اختبار" }
    });
    return res.json().access_token as string;
  }

  beforeAll(async () => {
    await app.ready();
    const branch = await prisma.branch.findUniqueOrThrow({ where: { branch_code: "BB-OLAYA" } });
    const brand = await prisma.brand.findUniqueOrThrow({ where: { id: branch.brand_id } });
    brandId = brand.id;
    original = {
      name_ar: brand.name_ar,
      name_en: brand.name_en,
      cuisine_ar: brand.cuisine_ar,
      logo_url: brand.logo_url
    };
  });

  afterAll(async () => {
    // إرجاع بيانات seed كما كانت — الاختبارات لا تترك أثراً
    await prisma.brand.update({ where: { id: brandId }, data: original });
    await app.close();
  });

  it("المالك يقرأ ملفه: العلامة بشعارها وحقولها", async () => {
    const owner = await ownerLogin("0520000001");
    const res = await app.inject({ method: "GET", url: "/v1/merchant/profile", headers: authed(owner) });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { brands: Array<{ id: string; name_ar: string }> };
    expect(body.brands.map((b) => b.id)).toContain(brandId);
  });

  it("المالك يعدّل الاسم والمطبخ والشعار وتنعكس في الملف وبطاقة العميل", async () => {
    const owner = await ownerLogin("0520000001");
    const patch = await app.inject({
      method: "PATCH",
      url: `/v1/merchant/brands/${brandId}`,
      headers: authed(owner),
      payload: { name_ar: "بيست برجر المطوّر", cuisine_ar: "برجر فاخر", logo_data_url: TINY_PNG }
    });
    expect(patch.statusCode).toBe(200);

    const res = await app.inject({ method: "GET", url: "/v1/merchant/profile", headers: authed(owner) });
    const brand = (res.json() as { brands: Array<{ id: string; name_ar: string; cuisine_ar: string | null; logo_url: string | null }> }).brands.find(
      (b) => b.id === brandId
    );
    expect(brand?.name_ar).toBe("بيست برجر المطوّر");
    expect(brand?.cuisine_ar).toBe("برجر فاخر");
    expect(brand?.logo_url).toBe(TINY_PNG);

    // فعل إداري مسجَّل في التدقيق
    const audit = await prisma.auditLog.findFirst({
      where: { action: "brand_profile_updated", entity_id: brandId },
      orderBy: { created_at: "desc" }
    });
    expect(audit).not.toBeNull();
  });

  it("إزالة الشعار بـ\"\" تصفّر logo_url", async () => {
    const owner = await ownerLogin("0520000001");
    const patch = await app.inject({
      method: "PATCH",
      url: `/v1/merchant/brands/${brandId}`,
      headers: authed(owner),
      payload: { logo_data_url: "" }
    });
    expect(patch.statusCode).toBe(200);
    const brand = await prisma.brand.findUniqueOrThrow({ where: { id: brandId } });
    expect(brand.logo_url).toBeNull();
  });

  it("مدير الفرع لا يعدّل هوية العلامة (403)", async () => {
    const manager = await staffLogin("BB-OLAYA", "BB-OLAYA-manager");
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/merchant/brands/${brandId}`,
      headers: authed(manager),
      payload: { name_ar: "اختراق الاسم" }
    });
    expect(res.statusCode).toBe(403);
  });

  it("العزل: مالك تاجر آخر لا يعدّل علامة غيره (403)", async () => {
    const foreign = await ownerLogin("0520000002");
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/merchant/brands/${brandId}`,
      headers: authed(foreign),
      payload: { name_ar: "استيلاء" }
    });
    expect(res.statusCode).toBe(403);
  });

  it("صيغة صورة غير data URL تُرفض (400)", async () => {
    const owner = await ownerLogin("0520000001");
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/merchant/brands/${brandId}`,
      headers: authed(owner),
      payload: { logo_data_url: "https://evil.example/logo.png" }
    });
    expect(res.statusCode).toBe(400);
  });
});
