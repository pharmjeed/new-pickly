import { expect, test, type Page } from "@playwright/test";

/**
 * J1 Happy Path (docs/03) في المتصفح — البوابة الكبرى للمرحلة 2:
 * عميل: تسجيل ← مطعم ← منتجات ← صفحة السلة والإتمام الواحدة ← دفع sandbox ← تتبع
 * فرع: قبول ← تجهيز ← جاهز
 * عميل: انطلقت ← وصلت (يدوي — J10: بلا صلاحية موقع)
 * فرع: خرج الموظف ← تحقق بالرمز ← سلّمت
 * عميل: تم التسليم.
 */

const CUSTOMER = "http://localhost:3000";
const BRANCH = "http://localhost:3002";

// جوال عشوائي لكل تشغيل — تسجيل جديد كامل
const phone = `05${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;

test("رحلة J1 كاملة عبر الواجهات", async ({ browser }) => {
  const customerCtx = await browser.newContext({ locale: "ar-SA" });
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
  // الرئيسية صارت استكشافاً (بانرات + تصنيفات) — القائمة في /restaurants
  await c.getByTestId("all-restaurants").click();
  await c.waitForURL(/\/restaurants/);
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

  // ===== 4. الإتمام (نفس الصفحة): سيارة مصغرة (S3) + دفع sandbox =====
  await c.getByTestId("veh-color").fill("بيضاء");
  await c.getByTestId("veh-plate").fill("8241");
  await c.getByTestId("veh-save").click();
  await expect(c.getByTestId("vehicle-radio").first()).toBeChecked();
  await c.getByTestId("pay-button").click();

  // ===== 5. التتبع: الطلب وصل للفرع (P7) =====
  await c.waitForURL(/\/track\//);
  const orderCode = (await c.getByTestId("order-code").textContent())?.trim() ?? "";
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
  await expect(orderCard).toContainText("بيضاء"); // بطاقة السيارة أكبر عنصر
  // قبول بضغطة — الوقت المتوقع يُختم آلياً من «متوسط وقت التجهيز» في إعدادات المطعم
  await orderCard.getByTestId("accept-order").click();

  // العميل يرى الوقت المتوقع (من متوسط المطعم) تلقائياً — لا موافقة مطلوبة
  await expect(c.getByTestId("prep-expected")).toBeVisible();

  await b.getByTestId("tab-preparing").click();
  await expect(orderCard.getByTestId("prep-avg")).toBeVisible();
  await orderCard.getByTestId("start-preparing").click();
  await orderCard.getByTestId("mark-ready").click();

  // ===== 7. العميل: جاهز ← انطلقت ← وصلت (J10: يدوي بلا GPS) =====
  await expect(c.getByTestId("track-title")).toContainText("طلبك جاهز");
  await c.getByTestId("start-trip").click();
  await expect(c.getByTestId("track-title")).toContainText("أنت في الطريق");
  await c.getByTestId("confirm-arrival").click();
  await expect(c.getByTestId("track-title")).toContainText("وصلت؟ إحنا عرفنا.");

  // رمز الاستلام ظهر للعميل
  const handoffCode = (await c.getByTestId("handoff-code").textContent())?.trim() ?? "";
  expect(handoffCode).toMatch(/^\d{4}$/);

  // ===== 8. الفرع: وصلوا ← خرج الموظف ← تحقق بالرمز ← سلّمت =====
  await b.getByTestId("tab-arrived").click();
  await expect(orderCard).toBeVisible();
  await orderCard.getByTestId("handoff-start").click();
  await expect(c.getByTestId("track-title")).toContainText("الموظف متجه إليك");

  await orderCard.getByTestId("handoff-open-code").click();
  await orderCard.getByTestId("handoff-code-input").fill(handoffCode);
  await orderCard.getByTestId("handoff-complete").click();

  // ===== 9. الاكتمال عند الطرفين =====
  await expect(c.getByTestId("track-title")).toContainText("بالعافية!");
  await expect(c.getByTestId("completed-box")).toContainText("تم التسليم");

  await customerCtx.close();
  await branchCtx.close();
});
