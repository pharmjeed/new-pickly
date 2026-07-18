import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config } from "dotenv";

config({ path: ["../../.env", ".env"] });
process.env.OTP_DEV_FIXED_CODE = "1234";
process.env.SMS_PROVIDER = "mock";
process.env.PAYMENT_PROVIDER = "mock";
process.env.GEO_PROVIDER = "mock";

/**
 * ملف التاجر الكامل — GET /v1/admin/merchants/{id} (A-04ب):
 * كل ما يخص التاجر في رد واحد، بلا كشف IBAN الكامل (docs/16§4).
 * تتخطى نفسها بلا DATABASE_URL.
 */
const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("ملف التاجر الكامل من لوحة السوبر أدمن", async () => {
  const { buildApp } = await import("./app.js");
  const { prisma } = await import("@pickly/database");
  const { verifyPin } = await import("@pickly/auth");

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

  it("يرجع الملف كاملاً: البيانات، الفروع بأكوادها، الفريق، المؤشرات، وسجل القرارات", async () => {
    const adminToken = await adminLogin();
    const list = await app.inject({ method: "GET", url: "/v1/admin/merchants", headers: authed(adminToken) });
    expect(list.statusCode).toBe(200);
    const merchants = list.json() as Array<{ id: string; name_ar: string }>;
    expect(merchants.length).toBeGreaterThan(0);
    const first = merchants[0]!;

    const res = await app.inject({
      method: "GET",
      url: `/v1/admin/merchants/${first.id}`,
      headers: authed(adminToken)
    });
    expect(res.statusCode).toBe(200);
    const file = res.json() as {
      id: string;
      name_ar: string;
      status: string;
      brands: unknown[];
      branches: Array<{ branch_code: string; brand: string; city: string }>;
      staff: Array<{ username: string; role_key: string }>;
      bank_accounts: Array<Record<string, unknown>>;
      stats: { orders_total: number; sales_halalas: number };
      recent_orders: unknown[];
      settlements: unknown[];
      audit_trail: unknown[];
    };

    expect(file.id).toBe(first.id);
    expect(file.name_ar).toBe(first.name_ar);
    expect(Array.isArray(file.brands)).toBe(true);
    expect(Array.isArray(file.branches)).toBe(true);
    expect(Array.isArray(file.staff)).toBe(true);
    expect(Array.isArray(file.recent_orders)).toBe(true);
    expect(Array.isArray(file.settlements)).toBe(true);
    expect(Array.isArray(file.audit_trail)).toBe(true);
    expect(file.stats.orders_total).toBeGreaterThanOrEqual(0);
    expect(file.stats.sales_halalas).toBeGreaterThanOrEqual(0);
    for (const b of file.branches) {
      expect(b.branch_code.length).toBeGreaterThan(0);
      expect(b.brand.length).toBeGreaterThan(0);
    }
    // لا كشف IBAN الكامل أو المشفر — آخر 4 فقط (docs/16§4)
    for (const acc of file.bank_accounts) {
      expect(acc).not.toHaveProperty("iban_encrypted");
      expect(String(acc.iban_short).length).toBeLessThanOrEqual(4);
    }
  });

  it("يعرض كلمة مرور الموظف للسوبر أدمن ويغيّرها بسبب ثم يستعيدها", async () => {
    const adminToken = await adminLogin();
    const list = await app.inject({ method: "GET", url: "/v1/admin/merchants", headers: authed(adminToken) });
    const merchants = list.json() as Array<{ id: string }>;

    // أول تاجر له فريق — تجار الاختبارات الأخرى قد يكونون بلا موظفين
    let merchantId: string | null = null;
    let staff: Array<{ id: string; pin?: string | null }> = [];
    for (const m of merchants) {
      const res = await app.inject({ method: "GET", url: `/v1/admin/merchants/${m.id}`, headers: authed(adminToken) });
      const file = res.json() as { staff: Array<{ id: string; pin?: string | null }> };
      if (file.staff.length > 0) {
        merchantId = m.id;
        staff = file.staff;
        break;
      }
    }
    expect(merchantId).not.toBeNull();

    // المفتاح موجود لكل موظف (السوبر أدمن يرى العمود) — وبيئة الاختبار تعبّئ رمز التطوير 1234 كسولاً
    for (const s of staff) expect(s.pin !== undefined).toBe(true);

    const target = staff[0]!;
    const change = await app.inject({
      method: "POST",
      url: `/v1/admin/merchants/${merchantId}/staff/${target.id}/pin`,
      headers: authed(adminToken),
      payload: { pin: "9876", reason: "اختبار تغيير كلمة المرور" }
    });
    expect(change.statusCode).toBe(200);

    // الرمز الجديد ظاهر في الملف، والتجزئة تحقّقه، والفعل دخل التدقيق
    const after = await app.inject({
      method: "GET",
      url: `/v1/admin/merchants/${merchantId}`,
      headers: authed(adminToken)
    });
    const afterStaff = (after.json() as { staff: Array<{ id: string; pin?: string | null }> }).staff;
    expect(afterStaff.find((s) => s.id === target.id)?.pin).toBe("9876");

    const row = await prisma.merchantStaff.findUniqueOrThrow({ where: { id: target.id } });
    expect(await verifyPin("9876", row.pin_hash)).toBe(true);
    const auditEntry = await prisma.auditLog.findFirst({
      where: { action: "staff_pin_reset", entity_id: target.id },
      orderBy: { created_at: "desc" }
    });
    expect(auditEntry?.reason).toBe("اختبار تغيير كلمة المرور");

    // استعادة رمز التطوير حتى لا تتأثر اختبارات دخول الفرع الأخرى
    const restore = await app.inject({
      method: "POST",
      url: `/v1/admin/merchants/${merchantId}/staff/${target.id}/pin`,
      headers: authed(adminToken),
      payload: { pin: "1234", reason: "استعادة رمز التطوير بعد الاختبار" }
    });
    expect(restore.statusCode).toBe(200);
  });

  it("يرجع 404 لتاجر غير موجود", async () => {
    const adminToken = await adminLogin();
    const res = await app.inject({
      method: "GET",
      url: "/v1/admin/merchants/00000000-0000-4000-8000-000000000000",
      headers: authed(adminToken)
    });
    expect(res.statusCode).toBe(404);
  });

  it("يمنع غير الأدمن من قراءة الملف", async () => {
    const customerToken = await loginByPhone(
      `+9665${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`
    );
    const list = await app.inject({ method: "GET", url: "/v1/admin/merchants", headers: authed(await adminLogin()) });
    const merchants = list.json() as Array<{ id: string }>;
    const res = await app.inject({
      method: "GET",
      url: `/v1/admin/merchants/${merchants[0]!.id}`,
      headers: authed(customerToken)
    });
    expect(res.statusCode).toBe(403);
  });
});
