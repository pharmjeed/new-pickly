import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config } from "dotenv";

config({ path: ["../../.env", ".env"] });
process.env.OTP_DEV_FIXED_CODE = "1234";
process.env.SMS_PROVIDER = "mock";

/**
 * السيارات: كتالوج الماركات/الموديلات (قاعدة بيانات السيارات) +
 * دورة اللوحة السعودية الكاملة (حروف + أرقام مشفرة AES-GCM):
 * إضافة ← قراءة مفكوكة للمالك ← تعديل ← حذف ناعم مع انتقال الافتراضية.
 * تتخطى نفسها إن لم تتوفر قاعدة بيانات (CI يوفرها).
 */

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("Vehicles — الكتالوج واللوحة الكاملة", async () => {
  const { buildApp } = await import("./app.js");
  const { prisma } = await import("@pickly/database");

  const app = await buildApp();
  const phone = `+9665${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
  let token = "";
  let vehicleId = "";
  let secondId = "";

  beforeAll(async () => {
    await app.ready();
    await app.inject({ method: "POST", url: "/v1/auth/otp/request", payload: { phone } });
    const verify = await app.inject({
      method: "POST",
      url: "/v1/auth/otp/verify",
      payload: { phone, code: "1234" }
    });
    token = verify.json().access_token;
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  const authed = { get authorization() { return `Bearer ${token}`; } };

  it("الكتالوج: ماركات وموديلات وألوان", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/vehicle-catalog" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.makes.length).toBeGreaterThan(10);
    const toyota = body.makes.find((m: { key: string }) => m.key === "toyota") as {
      name_ar: string;
      models: Array<{ name_ar: string }>;
    };
    expect(toyota.name_ar).toBe("تويوتا");
    expect(toyota.models.map((m) => m.name_ar)).toContain("كامري");
    expect(body.colors.length).toBeGreaterThan(5);
  });

  it("إضافة سيارة بلوحة كاملة — الحروف تعود مفكوكة للمالك", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/customers/me/vehicles",
      headers: authed,
      payload: {
        make_ar: "فورد",
        model_ar: "فوكس",
        color_ar: "أزرق",
        plate_digits: "3689",
        plate_letters_ar: "حعن"
      }
    });
    expect(res.statusCode).toBe(200);
    const v = res.json();
    vehicleId = v.id;
    expect(v.plate_digits).toBe("3689");
    expect(v.plate_letters_ar).toBe("ح ع ن");
    expect(v.plate_short).toBe("3689");
    expect(v.is_default).toBe(true);

    // المخزن مشفر — لا لوحة نصية في قاعدة البيانات
    const row = await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicleId } });
    expect(row.plate_encrypted).toBeTruthy();
    expect(row.plate_encrypted).not.toContain("3689");
    expect(row.plate_encrypted).not.toContain("ح");
  });

  it("التوافق القديم: plate_short يكفي للأرقام — والحروف تبقى إلزامية", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/customers/me/vehicles",
      headers: authed,
      payload: { color_ar: "بيضاء", plate_short: "8241", plate_letters_ar: "كوب", set_default: false }
    });
    expect(res.statusCode).toBe(200);
    secondId = res.json().id;
    expect(res.json().plate_digits).toBe("8241");
  });

  it("حروف اللوحة إلزامية: بلا حروف أو بأقل من 3 تُرفض", async () => {
    const missing = await app.inject({
      method: "POST",
      url: "/v1/customers/me/vehicles",
      headers: authed,
      payload: { color_ar: "بيضاء", plate_digits: "9999" }
    });
    expect(missing.statusCode).toBe(400);

    const partial = await app.inject({
      method: "POST",
      url: "/v1/customers/me/vehicles",
      headers: authed,
      payload: { color_ar: "بيضاء", plate_digits: "9999", plate_letters_ar: "حع" }
    });
    expect(partial.statusCode).toBe(400);
  });

  it("تعديل السيارة (ضغط مطول): لون وموديل ولوحة", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/customers/me/vehicles/${vehicleId}`,
      headers: authed,
      payload: { color_ar: "أسود", model_ar: "إكسبلورر", plate_digits: "1122", plate_letters_ar: "أبد" }
    });
    expect(res.statusCode).toBe(200);
    const v = res.json();
    expect(v.color_ar).toBe("أسود");
    expect(v.model_ar).toBe("إكسبلورر");
    expect(v.plate_digits).toBe("1122");
    expect(v.plate_letters_ar).toBe("أ ب د");
  });

  it("حذف الافتراضية: إخفاء ناعم وانتقال الافتراضية للمتبقية", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/customers/me/vehicles/${vehicleId}`,
      headers: authed
    });
    expect(res.statusCode).toBe(200);

    const list = await app.inject({ method: "GET", url: "/v1/customers/me/vehicles", headers: authed });
    const vehicles = list.json() as Array<{ id: string; is_default: boolean }>;
    expect(vehicles.map((v) => v.id)).not.toContain(vehicleId);
    expect(vehicles.find((v) => v.id === secondId)?.is_default).toBe(true);
  });

  it("العزل: لا تعديل لسيارة عميل آخر", async () => {
    const otherPhone = `+9665${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
    await app.inject({ method: "POST", url: "/v1/auth/otp/request", payload: { phone: otherPhone } });
    const verify = await app.inject({
      method: "POST",
      url: "/v1/auth/otp/verify",
      payload: { phone: otherPhone, code: "1234" }
    });
    const otherToken = verify.json().access_token as string;

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/customers/me/vehicles/${secondId}`,
      headers: { authorization: `Bearer ${otherToken}` },
      payload: { color_ar: "أحمر" }
    });
    expect(res.statusCode).toBe(400); // SYS-9004 — لا وجود للسيارة ضمن نطاق هذا العميل
  });
});
