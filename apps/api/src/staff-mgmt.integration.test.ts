import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { config } from "dotenv";

config({ path: ["../../.env", ".env"] });
process.env.OTP_DEV_FIXED_CODE = "1234";
process.env.SMS_PROVIDER = "mock";
process.env.PAYMENT_PROVIDER = "mock";
process.env.GEO_PROVIDER = "mock";

/**
 * إدارة الطاقم M-10 (docs/16§1 «الموظفون والأدوار»):
 * منع تصعيد الصلاحيات · نطاق الفروع · العزل بين التجار · نفاذ الإيقاف فوراً.
 * تتخطى نفسها بلا DATABASE_URL.
 */
const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("Staff Management (M-10)", async () => {
  const { buildApp } = await import("./app.js");
  const { prisma } = await import("@pickly/database");

  const app = await buildApp();
  const suffix = randomUUID().slice(0, 8);
  const createdUsernames: string[] = [];

  beforeAll(async () => await app.ready());
  afterAll(async () => {
    // تنظيف ما أنشأته الاختبارات (اسم الحساب فريد لكل تاجر)
    const rows = await prisma.merchantStaff.findMany({ where: { username: { in: createdUsernames } } });
    const ids = rows.map((r) => r.id);
    const userIds = rows.map((r) => r.user_id).filter((u): u is string => u != null);
    await prisma.staffBranchAssignment.deleteMany({ where: { staff_id: { in: ids } } });
    await prisma.userSession.deleteMany({ where: { user_id: { in: userIds } } });
    await prisma.device.deleteMany({ where: { user_id: { in: userIds } } });
    await prisma.merchantStaff.deleteMany({ where: { id: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await app.close();
  });

  const authed = (token: string) => ({ authorization: `Bearer ${token}` });

  async function staffLogin(branch_code: string, username: string, pin = "1234"): Promise<string> {
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/branch/login",
      payload: { branch_code, username, pin, device_name: "اختبار" }
    });
    return res.json().access_token as string;
  }

  it("مدير الفرع يضيف كاشيراً في فرعه ويستطيع الكاشير الدخول", async () => {
    const manager = await staffLogin("BB-OLAYA", "BB-OLAYA-manager");
    const branch = await prisma.branch.findUniqueOrThrow({ where: { branch_code: "BB-OLAYA" } });
    const username = `test-cashier-${suffix}`;
    createdUsernames.push(username);

    const res = await app.inject({
      method: "POST",
      url: "/v1/merchant/staff",
      headers: authed(manager),
      payload: {
        full_name: "كاشير الاختبار",
        username,
        pin: "5678",
        role_key: "cashier",
        branch_ids: [branch.id]
      }
    });
    expect(res.statusCode).toBe(200);

    // الحساب الجديد يدخل من لوحة الفرع بالرمز الذي حدده المدير
    const login = await app.inject({
      method: "POST",
      url: "/v1/auth/branch/login",
      payload: { branch_code: "BB-OLAYA", username, pin: "5678", device_name: "جهاز الكاشير" }
    });
    expect(login.statusCode).toBe(200);
    expect(login.json().access_token).toBeTruthy();
  });

  it("مدير الفرع لا يمنح دوراً برتبته أو أعلى (دون مدراء)", async () => {
    const manager = await staffLogin("BB-OLAYA", "BB-OLAYA-manager");
    const branch = await prisma.branch.findUniqueOrThrow({ where: { branch_code: "BB-OLAYA" } });
    for (const role_key of ["branch_manager", "general_manager"]) {
      const res = await app.inject({
        method: "POST",
        url: "/v1/merchant/staff",
        headers: authed(manager),
        payload: {
          full_name: "محاولة تصعيد",
          username: `esc-${role_key}-${suffix}`,
          pin: "1234",
          role_key,
          branch_ids: [branch.id]
        }
      });
      expect(res.statusCode).toBe(403);
    }
  });

  it("مدير الفرع لا يعيّن موظفاً على فرع خارج نطاقه", async () => {
    const manager = await staffLogin("BB-OLAYA", "BB-OLAYA-manager");
    const other = await prisma.branch.findUniqueOrThrow({ where: { branch_code: "BB-NAKHEEL" } });
    const res = await app.inject({
      method: "POST",
      url: "/v1/merchant/staff",
      headers: authed(manager),
      payload: {
        full_name: "خارج النطاق",
        username: `oos-${suffix}`,
        pin: "1234",
        role_key: "cashier",
        branch_ids: [other.id]
      }
    });
    expect(res.statusCode).toBe(403);
  });

  it("قائمة الطاقم مقيدة بنطاق الفاعل (مدير العليا لا يرى طاقم النخيل)", async () => {
    const manager = await staffLogin("BB-OLAYA", "BB-OLAYA-manager");
    const res = await app.inject({ method: "GET", url: "/v1/merchant/staff", headers: authed(manager) });
    expect(res.statusCode).toBe(200);
    const usernames = (res.json() as Array<{ username: string }>).map((m) => m.username);
    expect(usernames).toContain("BB-OLAYA-cashier");
    expect(usernames).not.toContain("BB-NAKHEEL-cashier");
  });

  it("العزل: مدير تاجر لا يعدّل موظف تاجر آخر", async () => {
    const foreignManager = await staffLogin("DW-MALAZ", "DW-MALAZ-manager");
    const victim = await prisma.merchantStaff.findFirstOrThrow({ where: { username: "BB-OLAYA-cashier" } });
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/merchant/staff/${victim.id}`,
      headers: authed(foreignManager),
      payload: { status: "suspended" }
    });
    expect(res.statusCode).toBe(403);
    const after = await prisma.merchantStaff.findUniqueOrThrow({ where: { id: victim.id } });
    expect(after.status).toBe("active");
  });

  it("الإيقاف يلغي جلسات الموظف فوراً ويمنع دخوله ثم التفعيل يعيده", async () => {
    const manager = await staffLogin("BB-OLAYA", "BB-OLAYA-manager");
    const branch = await prisma.branch.findUniqueOrThrow({ where: { branch_code: "BB-OLAYA" } });
    const username = `test-suspend-${suffix}`;
    createdUsernames.push(username);

    await app.inject({
      method: "POST",
      url: "/v1/merchant/staff",
      headers: authed(manager),
      payload: { full_name: "موظف للإيقاف", username, pin: "4321", role_key: "handoff", branch_ids: [branch.id] }
    });
    const staffToken = await staffLogin("BB-OLAYA", username, "4321");
    expect(staffToken).toBeTruthy();

    const row = await prisma.merchantStaff.findFirstOrThrow({ where: { username } });
    const sus = await app.inject({
      method: "PATCH",
      url: `/v1/merchant/staff/${row.id}`,
      headers: authed(manager),
      payload: { status: "suspended" }
    });
    expect(sus.statusCode).toBe(200);

    // جلسته القائمة أُلغيت — أي نداء بالتوكن القديم يُرفض
    const afterSuspend = await app.inject({
      method: "GET",
      url: `/v1/merchant/branches`,
      headers: authed(staffToken)
    });
    expect(afterSuspend.statusCode).toBe(401);

    // ودخول جديد مرفوض ما دام معلقاً
    const relogin = await app.inject({
      method: "POST",
      url: "/v1/auth/branch/login",
      payload: { branch_code: "BB-OLAYA", username, pin: "4321", device_name: "اختبار" }
    });
    expect(relogin.statusCode).toBeGreaterThanOrEqual(400);

    // التفعيل يعيد الدخول
    await app.inject({
      method: "PATCH",
      url: `/v1/merchant/staff/${row.id}`,
      headers: authed(manager),
      payload: { status: "active" }
    });
    const back = await staffLogin("BB-OLAYA", username, "4321");
    expect(back).toBeTruthy();
  });

  it("تعديل الدور والفروع معاً + تغيير PIN", async () => {
    const manager = await staffLogin("BB-OLAYA", "BB-OLAYA-manager");
    const branch = await prisma.branch.findUniqueOrThrow({ where: { branch_code: "BB-OLAYA" } });
    const username = `test-edit-${suffix}`;
    createdUsernames.push(username);

    await app.inject({
      method: "POST",
      url: "/v1/merchant/staff",
      headers: authed(manager),
      payload: { full_name: "موظف للتعديل", username, pin: "1111", role_key: "kitchen", branch_ids: [branch.id] }
    });
    const row = await prisma.merchantStaff.findFirstOrThrow({ where: { username } });

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/merchant/staff/${row.id}`,
      headers: authed(manager),
      payload: { role_key: "handoff", branch_ids: [branch.id], pin: "2222", full_name: "اسم محدث" }
    });
    expect(res.statusCode).toBe(200);

    const after = await prisma.merchantStaff.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.role_key).toBe("merchant:handoff");
    expect(after.full_name).toBe("اسم محدث");

    // الرمز الجديد يعمل والقديم لا
    const oldPin = await app.inject({
      method: "POST",
      url: "/v1/auth/branch/login",
      payload: { branch_code: "BB-OLAYA", username, pin: "1111", device_name: "اختبار" }
    });
    expect(oldPin.statusCode).toBeGreaterThanOrEqual(400);
    const newPin = await staffLogin("BB-OLAYA", username, "2222");
    expect(newPin).toBeTruthy();
  });
});
