#!/usr/bin/env node
/**
 * تحقق حيّ من تكامل ميسر — يمرّ بالمسار كاملاً كما يمرّ به العميل:
 * دخول ← سلة ← تسعيرة ← طلب ← نية دفع ← ترميز البطاقة لدى ميسر (كما يفعل
 * المتصفح تماماً) ← تأكيد الدفع ← رابط تحدي 3DS ← مزامنة النتيجة.
 *
 * التشغيل:
 *   node infra/scripts/verify-moyasar.mjs                 # جولة كاملة ببطاقة ناجحة
 *   node infra/scripts/verify-moyasar.mjs --card mada     # visa | mada | mastercard
 *   node infra/scripts/verify-moyasar.mjs --sync <order>  # بعد إكمال تحدي 3DS يدوياً
 *
 * متغيرات اختيارية: API (افتراضي https://api.thepickly.com) · PHONE
 *
 * ملاحظة: يعتمد على رمز OTP الثابت (بيئة العرض). في وضع الإنتاج الحقيقي
 * لن يعمل الدخول التلقائي — عندها جرّب من التطبيق نفسه.
 */

const API = process.env.API ?? "https://api.thepickly.com";
const PHONE = process.env.PHONE ?? "0500000177";
const OTP = process.env.OTP ?? "1234";

/** بطاقات ميسر التجريبية — تنجح جميعها؛ أي رقم آخر يعطي رفضاً (docs.moyasar.com) */
const TEST_CARDS = {
  visa: "4111111111111111",
  mastercard: "5421080101000000",
  mada: "4201320111111010"
};

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

const ok = (s) => `[32m${s}[0m`;
const bad = (s) => `[31m${s}[0m`;
const dim = (s) => `[2m${s}[0m`;

async function call(method, path, body, token, idem) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;
  if (idem) headers["Idempotency-Key"] = idem;
  const res = await fetch(API + path, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const msg = data?.error?.message_ar ?? JSON.stringify(data).slice(0, 300);
    throw new Error(`${method} ${path} → ${res.status}: ${msg}`);
  }
  return data;
}

async function login() {
  await call("POST", "/v1/auth/otp/request", { phone: PHONE });
  const auth = await call("POST", "/v1/auth/otp/verify", { phone: PHONE, code: OTP });
  return auth.access_token;
}

/** ترميز البطاقة مباشرة لدى ميسر — نسخة طبق الأصل مما يفعله المتصفح */
async function tokenizeAtMoyasar(publishableKey, pan) {
  const form = new URLSearchParams({
    publishable_api_key: publishableKey,
    save_only: "true",
    name: "Pickly Verify",
    number: pan,
    cvc: "123",
    month: "12",
    year: String(new Date().getFullYear() + 3)
  });
  const res = await fetch("https://api.moyasar.com/v1/tokens", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString()
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.id) {
    const detail =
      typeof data.errors === "string"
        ? data.errors
        : data.errors
          ? Object.values(data.errors).flat().join(" · ")
          : data.message;
    throw new Error(`ترميز البطاقة فشل: ${detail ?? res.status}`);
  }
  return data;
}

async function syncOnly(orderId) {
  const token = await login();
  const res = await call("POST", `/v1/orders/${orderId}/payment/sync`, undefined, token);
  const order = await call("GET", `/v1/orders/${orderId}`, undefined, token);
  console.log(`حالة الدفع: ${res.status}${res.message ? ` — ${res.message}` : ""}`);
  console.log(`حالة الطلب: ${order.order_status}`);
  const good = res.status === "authorized" || res.status === "captured";
  console.log(good ? ok("\n✅ الدفع تم لدى ميسر والطلب انتقل للفرع") : bad("\n⚠️ لم يكتمل بعد"));
  process.exit(good ? 0 : 1);
}

async function main() {
  const syncOrder = arg("sync");
  if (syncOrder) return syncOnly(syncOrder);

  const cardKey = arg("card") ?? "visa";
  const pan = TEST_CARDS[cardKey];
  if (!pan) throw new Error(`بطاقة غير معروفة: ${cardKey} — المتاح: ${Object.keys(TEST_CARDS).join(", ")}`);

  console.log(dim(`الخادم: ${API}\n`));

  const cfg = await call("GET", "/v1/content/payment-config");
  console.log(`١. البوابة: ${cfg.provider} · الطرق: ${cfg.supported_methods.join(", ")}`);
  if (cfg.provider !== "moyasar") {
    console.log(bad("\n❌ البوابة ما زالت المحاكي — اضبط PAYMENT_PROVIDER=moyasar على السيرفر وأعد تشغيل api"));
    process.exit(1);
  }
  if (!cfg.publishable_key) {
    console.log(bad("\n❌ PAYMENT_PUBLISHABLE_KEY غير مضبوط — الواجهة لن تستطيع ترميز البطاقة"));
    process.exit(1);
  }
  const live = cfg.publishable_key.startsWith("pk_live_");
  console.log(`   المفتاح: ${cfg.publishable_key.slice(0, 12)}… ${live ? bad("(حي — مال حقيقي!)") : ok("(اختباري)")}`);

  const token = await login();
  console.log("٢. الدخول ✓");

  const nearby = await call("GET", "/v1/branches/nearby?lat=24.7136&lng=46.6753&radius=50000", undefined, token);
  const branch = nearby[0];
  if (!branch) throw new Error("لا فروع قريبة — تحقق من بيانات العرض");
  const menu = await call("GET", `/v1/branches/${branch.id}/menu`, undefined, token);
  const product = menu.categories.flatMap((c) => c.products).find((p) => p.is_available !== false);
  if (!product) throw new Error("لا منتجات متاحة في الفرع");
  console.log(`٣. ${branch.brand_name_ar ?? branch.name_ar} — ${product.name_ar}`);

  const cart = await call("POST", "/v1/carts", { branch_id: branch.id }, token);
  await call("POST", `/v1/carts/${cart.id}/items`, { product_id: product.id, quantity: 1, modifier_ids: [] }, token);
  const quoted = await call("POST", `/v1/carts/${cart.id}/quote`, undefined, token);
  console.log(`٤. التسعيرة: ${(quoted.quote.total_halalas / 100).toFixed(2)} ر.س`);

  const vehicles = await call("GET", "/v1/customers/me/vehicles", undefined, token);
  const vehicle =
    vehicles[0] ??
    (await call(
      "POST",
      "/v1/customers/me/vehicles",
      { make_ar: "تويوتا", model_ar: "كامري", color_ar: "أبيض", plate_digits: "1177", plate_letters_ar: "أبج" },
      token
    ));

  const order = await call(
    "POST",
    "/v1/orders",
    { cart_id: cart.id, quote_id: quoted.quote.quote_id, vehicle_id: vehicle.id, pickup_time: "asap" },
    token,
    `verify-${Date.now()}`
  );
  console.log(`٥. الطلب: ${order.display_code}`);

  const intent = await call(
    "POST",
    `/v1/orders/${order.id}/payment-intent`,
    { method: "card", use_wallet: false },
    token,
    `pi-${order.id}`
  );
  console.log(`٦. نية الدفع: ${intent.status} · ${(intent.amount_halalas / 100).toFixed(2)} ر.س`);

  const tok = await tokenizeAtMoyasar(cfg.publishable_key, pan);
  console.log(`٧. ترميز البطاقة لدى ميسر ✓ ${tok.brand} ••••${tok.last_four} (${tok.id.slice(0, 14)}…)`);

  const confirmed = await call(
    "POST",
    `/v1/orders/${order.id}/payment/confirm`,
    { method: "card", card_token: tok.id, save_card: true },
    token,
    `confirm-${order.id}`
  );
  console.log(`٨. التأكيد: ${confirmed.status}${confirmed.message ? ` — ${confirmed.message}` : ""}`);

  if (confirmed.redirect_url) {
    console.log(ok("\n✅ ميسر أنشأت العملية وأعادت تحدي 3DS — التكامل يعمل."));
    console.log("\nافتح الرابط في المتصفح وأكمل التحقق:");
    console.log(`\n${confirmed.redirect_url}\n`);
    console.log("ثم تحقق من النتيجة:");
    console.log(dim(`node infra/scripts/verify-moyasar.mjs --sync ${order.id}`));
    return;
  }

  if (confirmed.status === "authorized" || confirmed.status === "captured") {
    const after = await call("GET", `/v1/orders/${order.id}`, undefined, token);
    console.log(ok(`\n✅ الدفع تم بلا تحدي 3DS — حالة الطلب: ${after.order_status}`));
    return;
  }

  console.log(bad(`\n❌ لم يكتمل: ${confirmed.status}`));
  process.exit(1);
}

main().catch((err) => {
  console.error(bad(`\n❌ ${err.message}`));
  process.exit(1);
});
