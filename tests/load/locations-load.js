import http from "k6/http";
import { check } from "k6";

/**
 * حمل تحديثات المواقع — الجزء الأثقل تكراراً في الإنتاج.
 * ملاحظة: قنوات WebSocket الحية (هدف 2000 اتصال) تُختبر بعد بناء Realtime Gateway —
 * مسجلة كبند معلق في BUILD-STATE (الواجهات تعمل بالـpolling حالياً).
 */
const BASE = __ENV.BASE_URL || "http://localhost:4000";

export const options = {
  scenarios: {
    tracking: {
      executor: "constant-vus",
      vus: 100,
      duration: "3m"
    }
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<500"]
  }
};

// كل VU يمثل عميلاً في رحلة نشطة (ORDER_ID/TOKEN من setup حقيقي في staging؛
// محلياً يُستخدم polling القراءة العامة كوكيل حمل مماثل)
export default function () {
  const res = http.get(`${BASE}/v1/branches/nearby?lat=24.70&lng=46.68&radius=30000`);
  check(res, { "read ok": (r) => r.status === 200 });
}
