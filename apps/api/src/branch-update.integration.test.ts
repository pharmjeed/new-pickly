import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config } from "dotenv";

config({ path: ["../../.env", ".env"] });
process.env.OTP_DEV_FIXED_CODE = "1234";
process.env.SMS_PROVIDER = "mock";
process.env.PAYMENT_PROVIDER = "mock";
process.env.GEO_PROVIDER = "mock";

/**
 * M-03 تعديل فرع قائم من بوابة التاجر (PATCH /v1/merchant/branches/:id):
 * المالك يعدّل الاسم/العنوان/الجوال وينقل موقع الفرع على الخريطة —
 * وعمود PostGIS يتبع الإحداثيات الجديدة (منه تُحسب مسافة وصول العميل).
 * مع عزل تجّار صارم ونطاق فروع للأدوار المقيّدة.
 * تتخطى نفسها بلا DATABASE_URL.
 */
const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("Branch Update (M-03)", async () => {
  const { buildApp } = await import("./app.js");
  const { prisma } = await import("@pickly/database");

  const app = await buildApp();
  const authed = (token: string) => ({ authorization: `Bearer ${token}` });

  let branchId = "";
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
    // فرع مستقل للاختبار — لا نحرّك فروع السييد
    const owner = await ownerLogin("0520000001");
    const res = await app.inject({
      method: "POST",
      url: "/v1/merchant/branches",
      headers: authed(owner),
      payload: {
        name_ar: "فرع قبل التعديل",
        city: "الرياض",
        address_short: "العنوان القديم",
        lat: 24.7,
        lng: 46.7
      }
    });
    branchId = (res.json() as { id: string }).id;
    createdBranchIds.push(branchId);
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

  it("المالك يعدّل الاسم والعنوان وينقل الموقع — وPostGIS يتبع الإحداثيات", async () => {
    const owner = await ownerLogin("0520000001");
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/merchant/branches/${branchId}`,
      headers: authed(owner),
      payload: {
        name_ar: "فرع بعد التعديل",
        address_short: "العنوان الجديد",
        phone: "0119998877",
        lat: 24.81,
        lng: 46.61
      }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { name_ar: string; lat: number; lng: number };
    expect(body.name_ar).toBe("فرع بعد التعديل");
    expect(body.lat).toBeCloseTo(24.81, 5);

    const fresh = await prisma.branch.findUniqueOrThrow({ where: { id: branchId } });
    expect(fresh.name_ar).toBe("فرع بعد التعديل");
    expect(fresh.address_short).toBe("العنوان الجديد");
    expect(fresh.phone).toBe("0119998877");
    expect(fresh.city).toBe("الرياض"); // ما لم يُمرَّر يبقى كما هو
    expect(fresh.lat).toBeCloseTo(24.81, 5);
    expect(fresh.lng).toBeCloseTo(46.61, 5);

    // العمود المكاني تحرّك مع الإحداثيات — منه تُحسب مسافة الوصول
    const geo = await prisma.$queryRaw<Array<{ lat: number; lng: number }>>`
      SELECT ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng
      FROM branches WHERE id = ${branchId}::uuid`;
    expect(geo[0]?.lat).toBeCloseTo(24.81, 5);
    expect(geo[0]?.lng).toBeCloseTo(46.61, 5);

    // فعل التعديل مسجَّل في التدقيق ببيانات قبل/بعد
    const audit = await prisma.auditLog.findFirst({
      where: { action: "branch_updated", entity_id: branchId }
    });
    expect(audit).not.toBeNull();
  });

  it("إحداثية واحدة بلا شريكتها تُرفض (400)", async () => {
    const owner = await ownerLogin("0520000001");
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/merchant/branches/${branchId}`,
      headers: authed(owner),
      payload: { lat: 24.9 }
    });
    expect(res.statusCode).toBe(400);
  });

  it("العزل: مالك تاجر آخر لا يعدّل فرعاً ليس له (403)", async () => {
    const foreign = await ownerLogin("0520000002");
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/merchant/branches/${branchId}`,
      headers: authed(foreign),
      payload: { name_ar: "فرع مخترق" }
    });
    expect(res.statusCode).toBe(403);
    const untouched = await prisma.branch.findUniqueOrThrow({ where: { id: branchId } });
    expect(untouched.name_ar).not.toBe("فرع مخترق");
  });

  it("مدير فرع مقيّد لا يعدّل فرعاً خارج نطاق رمزه (403)", async () => {
    const manager = await staffLogin("BB-OLAYA", "BB-OLAYA-manager");
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/merchant/branches/${branchId}`,
      headers: authed(manager),
      payload: { name_ar: "خارج النطاق" }
    });
    expect(res.statusCode).toBe(403);
  });
});
