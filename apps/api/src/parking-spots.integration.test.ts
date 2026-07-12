import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config } from "dotenv";

config({ path: ["../../.env", ".env"] });
process.env.OTP_DEV_FIXED_CODE = "1234";
process.env.SMS_PROVIDER = "mock";
process.env.PAYMENT_PROVIDER = "mock";
process.env.GEO_PROVIDER = "mock";

/**
 * مواقف الاستلام (parking_spots) — يحددها المطعم من بوابته والعميل يختار منها فقط:
 * CRUD للتاجر (إضافة/إيقاف/حذف بتدقيق) + الظهور العام للفعّالة فقط + عزل التجار.
 * تتخطى نفسها بلا DATABASE_URL.
 */
const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("Parking Spots — مواقف الفرع", async () => {
  const { buildApp } = await import("./app.js");
  const { prisma } = await import("@pickly/database");

  const app = await buildApp();
  const authed = (token: string) => ({ authorization: `Bearer ${token}` });
  const LABEL = "موقف-اختبار-9";

  let branchId = "";

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
    branchId = branch.id;
  });

  afterAll(async () => {
    // الاختبارات لا تترك أثراً — حذف موقف الاختبار إن بقي
    await prisma.parkingSpot.deleteMany({ where: { branch_id: branchId, label: LABEL } });
    await app.close();
  });

  it("المدير يقرأ مواقف فرعه (الseed يبذرها)", async () => {
    const manager = await staffLogin("BB-OLAYA", "BB-OLAYA-manager");
    const res = await app.inject({
      method: "GET",
      url: `/v1/merchant/branches/${branchId}/parking-spots`,
      headers: authed(manager)
    });
    expect(res.statusCode).toBe(200);
    const spots = res.json() as Array<{ id: string; label: string; is_active: boolean }>;
    expect(spots.length).toBeGreaterThan(0);
    expect(spots[0]).toHaveProperty("label");
  });

  it("إضافة موقف → يظهر للعميل في المسار العام؛ التكرار مرفوض", async () => {
    const manager = await staffLogin("BB-OLAYA", "BB-OLAYA-manager");
    const created = await app.inject({
      method: "POST",
      url: `/v1/merchant/branches/${branchId}/parking-spots`,
      headers: authed(manager),
      payload: { label: LABEL }
    });
    expect(created.statusCode).toBe(200);
    const spot = created.json() as { id: string; label: string };
    expect(spot.label).toBe(LABEL);

    // العميل يرى الموقف الجديد بلا مصادقة (اكتشاف عام)
    const publicRes = await app.inject({ method: "GET", url: `/v1/branches/${branchId}/parking-spots` });
    expect(publicRes.statusCode).toBe(200);
    const publicSpots = publicRes.json() as Array<{ id: string; label: string }>;
    expect(publicSpots.some((s) => s.id === spot.id)).toBe(true);

    // نفس التسمية مرة ثانية → رفض
    const dup = await app.inject({
      method: "POST",
      url: `/v1/merchant/branches/${branchId}/parking-spots`,
      headers: authed(manager),
      payload: { label: LABEL }
    });
    expect(dup.statusCode).toBeGreaterThanOrEqual(400);
  });

  it("إيقاف الموقف يخفيه عن العميل، وإعادة تفعيله تعيده", async () => {
    const manager = await staffLogin("BB-OLAYA", "BB-OLAYA-manager");
    const spot = await prisma.parkingSpot.findUniqueOrThrow({
      where: { branch_id_label: { branch_id: branchId, label: LABEL } }
    });

    const off = await app.inject({
      method: "PATCH",
      url: `/v1/merchant/parking-spots/${spot.id}`,
      headers: authed(manager),
      payload: { is_active: false }
    });
    expect(off.statusCode).toBe(200);

    const hidden = (await app.inject({ method: "GET", url: `/v1/branches/${branchId}/parking-spots` })).json() as Array<{ id: string }>;
    expect(hidden.some((s) => s.id === spot.id)).toBe(false);

    const on = await app.inject({
      method: "PATCH",
      url: `/v1/merchant/parking-spots/${spot.id}`,
      headers: authed(manager),
      payload: { is_active: true }
    });
    expect(on.statusCode).toBe(200);
    const visible = (await app.inject({ method: "GET", url: `/v1/branches/${branchId}/parking-spots` })).json() as Array<{ id: string }>;
    expect(visible.some((s) => s.id === spot.id)).toBe(true);
  });

  it("عزل التجار: مدير تاجر آخر لا يقرأ ولا يعدل ولا يحذف مواقف غير فرعه", async () => {
    const foreign = await staffLogin("DW-MALAZ", "DW-MALAZ-manager");
    const spot = await prisma.parkingSpot.findUniqueOrThrow({
      where: { branch_id_label: { branch_id: branchId, label: LABEL } }
    });

    const read = await app.inject({
      method: "GET",
      url: `/v1/merchant/branches/${branchId}/parking-spots`,
      headers: authed(foreign)
    });
    expect(read.statusCode).toBeGreaterThanOrEqual(400);

    const add = await app.inject({
      method: "POST",
      url: `/v1/merchant/branches/${branchId}/parking-spots`,
      headers: authed(foreign),
      payload: { label: "تسلل" }
    });
    expect(add.statusCode).toBeGreaterThanOrEqual(400);

    const patch = await app.inject({
      method: "PATCH",
      url: `/v1/merchant/parking-spots/${spot.id}`,
      headers: authed(foreign),
      payload: { is_active: false }
    });
    expect(patch.statusCode).toBeGreaterThanOrEqual(400);

    const del = await app.inject({
      method: "DELETE",
      url: `/v1/merchant/parking-spots/${spot.id}`,
      headers: authed(foreign)
    });
    expect(del.statusCode).toBeGreaterThanOrEqual(400);

    // الموقف سليم لم يمس
    const still = await prisma.parkingSpot.findUnique({ where: { id: spot.id } });
    expect(still?.is_active).toBe(true);
  });

  it("الحذف يزيل الموقف نهائياً من قائمتي التاجر والعميل", async () => {
    const manager = await staffLogin("BB-OLAYA", "BB-OLAYA-manager");
    const spot = await prisma.parkingSpot.findUniqueOrThrow({
      where: { branch_id_label: { branch_id: branchId, label: LABEL } }
    });
    const del = await app.inject({
      method: "DELETE",
      url: `/v1/merchant/parking-spots/${spot.id}`,
      headers: authed(manager)
    });
    expect(del.statusCode).toBe(200);
    const publicSpots = (await app.inject({ method: "GET", url: `/v1/branches/${branchId}/parking-spots` })).json() as Array<{ id: string }>;
    expect(publicSpots.some((s) => s.id === spot.id)).toBe(false);
  });
});
