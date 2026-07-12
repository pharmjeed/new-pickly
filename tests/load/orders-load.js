import http from "k6/http";
import { check, sleep } from "k6";

/**
 * حمل إنشاء الطلبات — هدف docs/20: 200 طلب متزامن/دقيقة.
 * التشغيل: k6 run tests/load/orders-load.js  (يتطلب API + seed محليين أو staging)
 * البيئة: BASE_URL (افتراضي http://localhost:4000)
 */
const BASE = __ENV.BASE_URL || "http://localhost:4000";

// الهدف الرسمي: RATE=200 لمدة 5m على staging (docs/20) — محلياً يُخفض عبر env
const RATE = Number(__ENV.RATE || 200);
const DURATION = __ENV.DURATION || "5m";

export const options = {
  scenarios: {
    orders: {
      executor: "constant-arrival-rate",
      rate: RATE,
      timeUnit: "1m",
      duration: DURATION,
      preAllocatedVUs: 50,
      maxVUs: 200
    }
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<800"]
  }
};

function json(res) {
  try {
    return res.json();
  } catch {
    return {};
  }
}

export default function () {
  const phone = `05${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
  const h = { "Content-Type": "application/json" };

  // تسجيل
  http.post(`${BASE}/v1/auth/otp/request`, JSON.stringify({ phone }), { headers: h });
  const verify = http.post(
    `${BASE}/v1/auth/otp/verify`,
    JSON.stringify({ phone, code: "1234" }),
    { headers: h }
  );
  const token = json(verify).access_token;
  if (!check(verify, { "auth ok": (r) => r.status === 200 && token })) return;
  const auth = { ...h, Authorization: `Bearer ${token}` };

  // سيارة + فرع + سلة
  const veh = http.post(
    `${BASE}/v1/customers/me/vehicles`,
    JSON.stringify({ color_ar: "بيضاء", plate_short: "9999" }),
    { headers: auth }
  );
  const nearby = http.get(`${BASE}/v1/branches/nearby?lat=24.70&lng=46.68&radius=30000`);
  const branch = json(nearby)[0];
  if (!check(nearby, { "nearby ok": () => Boolean(branch) })) return;

  const cart = http.post(`${BASE}/v1/carts`, JSON.stringify({ branch_id: branch.id }), {
    headers: auth
  });
  const cartId = json(cart).id;
  const menu = http.get(`${BASE}/v1/branches/${branch.id}/menu`);
  const product = json(menu).categories[0].products[0];

  http.post(
    `${BASE}/v1/carts/${cartId}/items`,
    JSON.stringify({ product_id: product.id, quantity: 1, modifier_ids: [] }),
    { headers: auth }
  );
  // POST بلا body ← بلا Content-Type (Fastify يرفض JSON فارغاً)
  const authNoBody = { Authorization: auth.Authorization };
  const quoted = http.post(`${BASE}/v1/carts/${cartId}/quote`, null, { headers: authNoBody });
  const quote = json(quoted).quote;

  // الطلب + الدفع
  const order = http.post(
    `${BASE}/v1/orders`,
    JSON.stringify({
      cart_id: cartId,
      quote_id: quote.quote_id,
      vehicle_id: json(veh).id,
      pickup_time: "asap"
    }),
    { headers: { ...auth, "Idempotency-Key": `${phone}-${Date.now()}` } }
  );
  const orderId = json(order).id;
  const ok = check(order, { "order created": (r) => r.status === 200 && orderId });
  if (!ok) return;

  http.post(`${BASE}/v1/orders/${orderId}/payment-intent`, null, {
    headers: { Authorization: auth.Authorization, "Idempotency-Key": `pi-${phone}-${Date.now()}` }
  });
  const pay = http.post(`${BASE}/v1/dev/mock-gateway/by-order/${orderId}/pay`, "{}", {
    headers: h
  });
  check(pay, { "paid": (r) => r.status === 200 });

  sleep(1);
}
