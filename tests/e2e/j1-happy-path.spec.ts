import { expect, test, type Page } from "@playwright/test";

/**
 * J1 Happy Path (docs/03) في المتصفح — البوابة الكبرى للمرحلة 2:
 * عميل: تسجيل ← مطعم ← منتجات ← صفحة السلة والإتمام الواحدة ← دفع sandbox ← تتبع
 * فرع: قبول ← تجهيز ← جاهز
 * عميل: داخل نطاق الوصول (500م) ← سحب «وصلت» يدوياً (J10: الخادم يفتح الجلسة اليدوية تلقائياً)
 * فرع: تم التسليم (بضغطة واحدة بلا رمز)
 * عميل: تم التسليم.
 */

const CUSTOMER = "http://localhost:3000";
const BRANCH = "http://localhost:3002";

// موقع فرع بيست برجر — العليا (seed) — نضع العميل عنده ليُفتح سحب «وصلت»
const OLAYA = { latitude: 24.6949, longitude: 46.6853 };

// جوال عشوائي لكل تشغيل — تسجيل جديد كامل
const phone = `05${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;

test("رحلة J1 كاملة عبر الواجهات", async ({ browser }) => {
  const customerCtx = await browser.newContext({
    locale: "ar-SA",
    permissions: ["geolocation"],
    geolocation: OLAYA // العميل عند الفرع → داخل نصف قطر الوصول
  });
  const branchCtx = await browser.newContext({ locale: "ar-SA" });
  const c: Page = await customerCtx.newPage();
  const b: Page = await branchCtx.newPage();

  // ===== 1. تسجيل العميل (P2) =====
  await c.goto(`${CUSTOMER}/auth`);
  await c.getByTestId("phone-input").fill(phone);
  await c.getByTestId("phone-submit").click();
  await c.getByTestId("otp-input").fill("1234"); // OTP_DEV_FIXED_CODE
  await c.getByTestId("otp-submit").click();
  await c.getByTestId("name-input").fill("سلطان الاختبار");
  await c.getByTestId("name-submit").click();
  await c.waitForURL(`${CUSTOMER}/`);

  // ===== 2. اختيار أقرب فرع (بيست برجر — العليا) وإضافة منتجين (P3→P4) =====
  // الرئيسية تعرض قائمة «قريب منك» الأقرب فالأقرب تحت التصنيفات — أول بطاقة أقرب فرع
  const firstCard = c.getByTestId("branch-card").first();
  await expect(firstCard).toContainText("بيست برجر");
  await firstCard.click();
  await expect(c.getByTestId("product-card").first()).toBeVisible();
  // الضغط على البطاقة يفتح ورقة التخصيص دائماً، والتأكيد داخلها يضيف للسلة
  await c.getByTestId("product-card").first().click();
  await c.getByTestId("add-product").click();
  await expect(c.getByTestId("go-cart")).toBeVisible();
  await c.getByTestId("product-card").nth(1).click();
  await c.getByTestId("add-product").click();
  await expect(c.getByTestId("add-product")).toBeHidden();

  // ===== 3. السلة والإتمام صفحة واحدة (P5+P6): «عرض السلة» يفتح /checkout مباشرة =====
  await c.getByTestId("go-cart").click();
  await expect(c.getByTestId("cart-item").first()).toBeVisible();
  await expect(c.getByTestId("quote-box")).toContainText("رسم خدمة بيكلي"); // BR-6 مفصول

  // ===== 4. الإتمام (نفس الصفحة): «أضف سيارة جديدة» من كتالوج السيارات + دفع sandbox =====
  await c.getByTestId("veh-make").selectOption("فورد");
  await c.getByTestId("veh-plate").fill("8241");
  await c.getByTestId("veh-letters").fill("حعن");
  await c.getByTestId("veh-color").selectOption("أبيض");
  await c.getByTestId("veh-model").selectOption("فوكس");
  await c.getByTestId("veh-save").click();
  await expect(c.getByTestId("vehicle-radio").first()).toBeChecked();
  await c.getByTestId("pay-button").click();

  // ===== 5. التتبع: الطلب وصل للفرع (P7) =====
  await c.waitForURL(/\/track\//);
  // الكود P-XXXX لم يعد معروضاً في صفحة التتبع — نقرؤه من API الطلب مباشرة
  const orderId = new URL(c.url()).pathname.split("/").pop() ?? "";
  const orderCode = await c.evaluate(async (id) => {
    const res = await fetch(`/api/v1/orders/${id}`, {
      headers: { Authorization: `Bearer ${localStorage.getItem("pk_access") ?? ""}` }
    });
    const o = (await res.json()) as { display_code: string };
    return o.display_code;
  }, orderId);
  expect(orderCode).toMatch(/^P-\d{4}$/);
  await expect(c.getByTestId("track-title")).toContainText("أُرسل طلبك");

  // ===== 6. لوحة الفرع: دخول + قبول + تجهيز + جاهز (B-01→B-03) =====
  await b.goto(BRANCH);
  await b.getByTestId("branch-code").fill("BB-OLAYA");
  await b.getByTestId("username").fill("BB-OLAYA-cashier");
  await b.getByTestId("pin").fill("1234");
  await b.getByTestId("login-submit").click();
  await b.waitForURL(/\/board/);

  const orderCard = b.getByTestId("order-card").filter({ hasText: orderCode });
  await expect(orderCard).toBeVisible();
  await expect(orderCard).toContainText("أبيض"); // بطاقة السيارة أكبر عنصر — اللون كما اختير من الكتالوج
  // قبول بضغطة — الوقت المتوقع يُختم آلياً من «متوسط وقت التجهيز» في إعدادات المطعم
  await orderCard.getByTestId("accept-order").click();

  // العميل يرى الوقت المتوقع (من متوسط المطعم) تلقائياً — لا موافقة مطلوبة
  await expect(c.getByTestId("prep-expected")).toBeVisible();

  // «التشغيل» تبويب جامع — البطاقة تبقى مكانها وتتغيّر أزرارها بلا تنقّل
  await expect(orderCard.getByTestId("prep-avg")).toBeVisible();
  // زر واحد «جاهز» — يُشعر العميل والبطاقة تبقى في نفس القائمة الموحّدة
  await orderCard.getByTestId("mark-ready").click();
  await expect(orderCard).toBeVisible();

  // ===== 7. العميل: جاهز ← داخل النطاق ← سحب «وصلت» (J10: الخادم يفتح الجلسة اليدوية تلقائياً) =====
  await expect(c.getByTestId("track-title")).toContainText("طلبك جاهز");
  // الموقع عند الفرع → العنصر يتفعّل ويطلب السحب
  await expect(c.getByTestId("arrive-swipe-hint")).toContainText("نطاق الاستلام");
  const knob = c.getByTestId("arrive-swipe-knob");
  const swipe = c.getByTestId("arrive-swipe");
  const kb = await knob.boundingBox();
  const sb = await swipe.boundingBox();
  if (!kb || !sb) throw new Error("arrive swipe not rendered");
  const cy = kb.y + kb.height / 2;
  await c.mouse.move(kb.x + kb.width / 2, cy);
  await c.mouse.down();
  await c.mouse.move(sb.x + sb.width - 8, cy, { steps: 12 });
  await c.mouse.up();
  await expect(c.getByTestId("track-title")).toContainText("وصلت؟ إحنا عرفنا.");

  // ===== 8. الفرع: الوصول يظهر على نفس البطاقة (شارة «🚘 وصل» + وميض)
  //          ← «تم التسليم» بضغطة واحدة بلا رمز، بلا تنقّل =====
  await expect(orderCard.getByTestId("arrived-badge")).toBeVisible();
  // التبويب المعروض ما زال «التشغيل» الجامع — كل شيء في مكانه
  await expect(b.getByTestId("tab-active")).toHaveAttribute("aria-selected", "true");
  await orderCard.getByTestId("handoff-complete").click();

  // ===== 9. الاكتمال عند الطرفين =====
  await expect(c.getByTestId("track-title")).toContainText("بالعافية!");
  await expect(c.getByTestId("completed-box")).toContainText("تم التسليم");

  await customerCtx.close();
  await branchCtx.close();
});
