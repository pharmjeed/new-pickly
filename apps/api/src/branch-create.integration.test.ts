import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config } from "dotenv";

config({ path: ["../../.env", ".env"] });
process.env.OTP_DEV_FIXED_CODE = "1234";
process.env.SMS_PROVIDER = "mock";
process.env.PAYMENT_PROVIDER = "mock";
process.env.GEO_PROVIDER = "mock";

/**
 * M-03 إنشاء فرع ذاتياً من بوابة التاجر:
 * المالك ينشئ فرعاً بموقعه، يرث منيو العلامة وينسخ حالة توفّر فرع قائم،
 * ويديره فوراً (زمن التجهيز) رغم أن رمزه لم يُحدَّث — مع عزل تجّار صارم.
 * تتخطى نفسها بلا DATABASE_URL.
 */
const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("Branch Create (M-03)", async () => {
  const { buildApp } = await import("./app.js");
  const { prisma } = await import("@pickly/database");

  const app = await buildApp();
  const authed = (token: string) => ({ authorization: `Bearer ${token}` });

  let sourceBranchId = "";
  let merchantId = "";
  let brandId = "";
  const createdBranchIds: string[] = [];

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
    sourceBranchId = branch.id;
    merchantId = branch.merchant_id;
    brandId = branch.brand_id;
  });

  afterAll(async () => {
    // إزالة أي فرع أنشأه الاختبار وتوابعه (FK-safe) — لا أثر على seed
    for (const id of createdBranchIds) {
      await prisma.branchProductAvailability.deleteMany({ where: { branch_id: id } });
      await prisma.branchHour.deleteMany({ where: { branch_id: id } });
      await prisma.geofence.deleteMany({ where: { branch_id: id } });
      await prisma.parkingSpot.deleteMany({ where: { branch_id: id } });
      await prisma.branchPickupSettings.deleteMany({ where: { branch_id: id } });
      await prisma.auditLog.deleteMany({ where: { branch_id: id } });
      await prisma.branch.deleteMany({ where: { id } });
    }
    await app.close();
  });

  it("المالك ينشئ فرعاً بموقعه وينسخ منيو فرع قائم", async () => {
    const owner = await ownerLogin("0520000001");
    // اجعل صنفاً غير متوفر في الفرع المصدر لنتحقق أن حالة التوفّر تُنسخ
    const someProduct = await prisma.branchProductAvailability.findFirst({ where: { branch_id: sourceBranchId } });
    if (someProduct) {
      await prisma.branchProductAvailability.update({
        where: { branch_id_product_id: { branch_id: sourceBranchId, product_id: someProduct.product_id } },
        data: { is_available: false }
      });
    }

    const res = await app.inject({
      method: "POST",
      url: "/v1/merchant/branches",
      headers: authed(owner),
      payload: {
        name_ar: "فرع اختبار الإنشاء",
        city: "الرياض",
        address_short: "طريق الاختبار، حي الوحدة",
        lat: 24.77,
        lng: 46.72,
        phone: "0112223344",
        prep_minutes: 22,
        copy_menu_from_branch_id: sourceBranchId
      }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { id: string; branch_code: string; default_prep_minutes: number };
    createdBranchIds.push(body.id);
    expect(body.branch_code).toMatch(/^br-[a-z0-9]{6}$/);
    expect(body.default_prep_minutes).toBe(22);

    // الفرع بنفس علامة المصدر (فيرث المنيو) وموقعه المكاني مضبوط
    const branch = await prisma.branch.findUniqueOrThrow({ where: { id: body.id } });
    expect(branch.merchant_id).toBe(merchantId);
    expect(branch.brand_id).toBe(brandId);
    const geo = await prisma.$queryRaw<Array<{ ok: boolean }>>`
      SELECT location IS NOT NULL AS ok FROM branches WHERE id = ${body.id}::uuid`;
    expect(geo[0]?.ok).toBe(true);

    // حالة توفّر الأصناف نُسخت (بما فيها الصنف الذي جعلناه غير متوفر)
    if (someProduct) {
      const copied = await prisma.branchProductAvailability.findUnique({
        where: { branch_id_product_id: { branch_id: body.id, product_id: someProduct.product_id } }
      });
      expect(copied?.is_available).toBe(false);
      // أعِد المصدر كما كان
      await prisma.branchProductAvailability.update({
        where: { branch_id_product_id: { branch_id: sourceBranchId, product_id: someProduct.product_id } },
        data: { is_available: true }
      });
    }

    // فعل الإنشاء مسجَّل في التدقيق
    const audit = await prisma.auditLog.findFirst({ where: { action: "branch_created", entity_id: body.id } });
    expect(audit).not.toBeNull();
  });

  it("المالك يدير الفرع الجديد فوراً رغم أن رمزه لم يُحدَّث (زمن التجهيز)", async () => {
    const owner = await ownerLogin("0520000001");
    const create = await app.inject({
      method: "POST",
      url: "/v1/merchant/branches",
      headers: authed(owner),
      payload: { name_ar: "فرع إدارة فورية", city: "الرياض", address_short: "حي النطاق", lat: 24.7, lng: 46.7 }
    });
    const branchId = (create.json() as { id: string }).id;
    createdBranchIds.push(branchId);

    // نفس التوكن القديم — لا يحوي الفرع الجديد؛ يجب أن يمر بفضل كامل النطاق
    const prep = await app.inject({
      method: "POST",
      url: `/v1/merchant/branches/${branchId}/prep-minutes`,
      headers: authed(owner),
      payload: { prep_minutes: 18 }
    });
    expect(prep.statusCode).toBe(200);
    const settings = await prisma.branchPickupSettings.findUniqueOrThrow({ where: { branch_id: branchId } });
    expect(settings.default_prep_minutes).toBe(18);
  });

  it("العزل: مالك تاجر آخر لا ينسخ من فرع ليس له (403)", async () => {
    const foreign = await ownerLogin("0520000002");
    const res = await app.inject({
      method: "POST",
      url: "/v1/merchant/branches",
      headers: authed(foreign),
      payload: {
        name_ar: "فرع اختراق",
        city: "الرياض",
        address_short: "عنوان",
        lat: 24.7,
        lng: 46.7,
        copy_menu_from_branch_id: sourceBranchId
      }
    });
    expect(res.statusCode).toBe(403);
  });

  it("مدير الفرع لا ينشئ فروعاً (403)", async () => {
    const manager = await staffLogin("BB-OLAYA", "BB-OLAYA-manager");
    const res = await app.inject({
      method: "POST",
      url: "/v1/merchant/branches",
      headers: authed(manager),
      payload: { name_ar: "فرع ممنوع", city: "الرياض", address_short: "عنوان", lat: 24.7, lng: 46.7 }
    });
    expect(res.statusCode).toBe(403);
  });
});
