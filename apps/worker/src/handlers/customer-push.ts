import { prisma } from "@pickly/database";
import { EventEnvelopeSchema } from "@pickly/contracts";
import { createLogger } from "@pickly/observability";
import { markPushOnce, sendExpoMessages, unmarkPush } from "./expo-push.js";

/**
 * Push أصلي لجوال العميل (غلاف Expo) عند تقدّم طلبه — القبول/الرفض/الجاهزية/
 * انطلاق التسليم/الاسترداد: صفحة التتبع لا تعمل والتطبيق مقفل، والإشعار النظامي
 * يصل ويرن من نظام التشغيل نفسه. النصوص من قوالب notification_templates (docs/15)
 * نفسها المستخدمة لإشعارات الجرس، وidempotent عبر علامة Redis.
 */
const logger = createLogger("customer-push");

/** نصوص احتياطية إن غاب القالب من قاعدة البيانات — بصياغة seed (docs/15) حرفياً */
const FALLBACK: Record<string, { title: string; body: string }> = {
  order_accepted: { title: "قبل المطعم طلبك", body: "المطعم يجهّز طلبك على وقت وصولك" },
  order_rejected: { title: "نعتذر — ما قدر المطعم يستقبل طلبك", body: "مبلغك يرجع لك كاملاً خلال أيام قليلة" },
  order_ready: { title: "طلبك جاهز", body: "خلّك في سيارتك، الباقي علينا" },
  later_ready: { title: "طلبك جاهز — تحرك وقت ما يناسبك", body: "طلبك محفوظ لك، واضغط «أنا في الطريق» وقت ما تتحرك" },
  handoff_started: { title: "{{staff_name}} في طريقه إليك", body: "{{staff_name}} في طريقه إليك · يحمل طلبك" },
  refund_completed: { title: "تم استرجاع مبلغك", body: "أعدنا {{amount}} لوسيلة دفعك — قد يستغرق الظهور أياماً قليلة" },
  no_show_reminder: { title: "طلبك بانتظارك", body: "طلبك جاهز من فترة — إذا تأخرت أكثر قد يُلغى وفق السياسة" },
  scheduled_reminder: { title: "حان وقت التوجه", body: "اقتربت فترة استلام طلبك {{display_code}} — انطلق الآن" }
};

/**
 * إشعار نظامي لكل أجهزة العميل المسجّلة من قالب docs/15 — تستدعيه معالجات
 * التذكير (no-show/المجدول) إضافةً لمستهلك الأحداث أدناه. branch_id يميّز
 * تابلت الفرع عن جوال العميل لنفس المستخدم (الجوال الواحد قد يحمل الدورين).
 */
export async function pushCustomerTemplate(input: {
  user_id: string;
  template_key: string;
  vars: Record<string, string>;
  dedupe_key: string;
  order_id?: string | null;
}): Promise<void> {
  const devices = await prisma.device.findMany({
    where: { user_id: input.user_id, branch_id: null, push_token: { startsWith: "ExponentPushToken" } }
  });
  if (devices.length === 0) return;

  const tpl = await prisma.notificationTemplate.findUnique({ where: { key: input.template_key } });
  if (tpl && !tpl.is_active) return; // معطَّل من السوبر أدمن
  const fallback = FALLBACK[input.template_key];
  const render = (s: string) => s.replace(/\{\{(\w+)\}\}/g, (_, k: string) => input.vars[k] ?? "");
  const title = render(tpl?.title_ar ?? fallback?.title ?? input.template_key);
  const body = render(tpl?.body_ar ?? fallback?.body ?? "");

  const redisKey = `push:customer:${input.dedupe_key}`;
  const mark = await markPushOnce(redisKey);
  if (mark === "duplicate") return;

  const messages = devices.map((d) => ({
    to: d.push_token,
    title,
    body,
    sound: "default",
    priority: "high",
    channelId: "orders", // قناة أندرويد المهيأة في الغلاف (أهمية قصوى + ظهور على شاشة القفل)
    data: { order_id: input.order_id ?? null }
  }));

  try {
    await sendExpoMessages(devices, messages);
    logger.info(
      { user_id: input.user_id, template_key: input.template_key, devices: devices.length },
      "customer push sent"
    );
  } catch (err) {
    if (mark === "marked") await unmarkPush(redisKey);
    throw err;
  }
}

/** حدث نطاق ← قالب Push — ما يفعله العميل بنفسه (الإنشاء/تأكيد الاستلام) لا يحتاج تنبيهاً */
const EVENT_TEMPLATES: Record<string, string> = {
  "merchant.order_accepted": "order_accepted",
  "merchant.order_rejected": "order_rejected",
  "handoff.started": "handoff_started",
  "refund.completed": "refund_completed"
};

export async function pushCustomerOrderUpdate(raw: unknown): Promise<void> {
  const parsed = EventEnvelopeSchema.safeParse(raw);
  if (!parsed.success) return;
  const e = parsed.data;

  let template_key = e.name === "order.ready" ? "order_ready" : EVENT_TEMPLATES[e.name];
  if (!template_key) return;

  // الطلب صاحب الحدث — refund.completed حدثه على refund وحمولته بلا order_id، فنصل للطلب عبر سجل الاسترداد
  let order_id: string | null = null;
  if (e.aggregate_type === "order") order_id = e.aggregate_id;
  else if (typeof e.payload.order_id === "string") order_id = e.payload.order_id;
  else if (e.name === "refund.completed" && e.aggregate_type === "refund") {
    const refund = await prisma.refund.findUnique({ where: { id: e.aggregate_id } });
    order_id = refund?.order_id ?? null;
  }
  if (!order_id) return;

  const order = await prisma.order.findUnique({ where: { id: order_id } });
  if (!order) return;
  // «سأتحرك لاحقاً»: عند الجاهزية نطمئنه أن الطلب محفوظ ويتحرك وقت ما يناسبه (FR-C06)
  if (e.name === "order.ready" && order.pickup_time === "later") template_key = "later_ready";

  const vars: Record<string, string> = { display_code: order.display_code };
  if (template_key === "handoff_started") {
    vars.staff_name =
      typeof e.payload.staff_name === "string" && e.payload.staff_name !== "" ? e.payload.staff_name : "موظفنا";
  }
  if (template_key === "refund_completed") {
    vars.amount =
      typeof e.payload.amount_halalas === "number"
        ? `${(e.payload.amount_halalas / 100).toFixed(2)} ر.س`
        : "مبلغك";
  }

  await pushCustomerTemplate({
    user_id: order.user_id,
    template_key,
    vars,
    dedupe_key: e.event_id,
    order_id
  });
}
