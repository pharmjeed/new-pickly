/**
 * P7 ⭐ الطلب الحي — صفحة واحدة تقودها آلة الحالات (C-38→C-51):
 * - polling كل 2.5s على GET /v1/orders/{id}
 * - شريط الحالات السبع
 * - وضع قيادة داكن (ink-900) أثناء الطريق
 * - «انطلقت الآن» POST trip/start + إرسال المواقع من expo-location كل 8s
 *   (foreground فقط — الخلفية تتطلب dev build + Task Manager لاحقاً)
 * - «وصلت» POST arrival · Sheet الموقف POST parking-spot {free_text}
 * - بطاقة رمز الاستلام الليمونية · عند COMPLETED تقييم بنجوم (P8)
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as Location from "expo-location";
import { api } from "../../src/api";
import { ErrorNote, GhostButton, LimeButton, Loader } from "../../src/ui";
import { colors, dark, fs, light, radius, radiusPill, touch } from "../../src/theme";

interface Order {
  id: string;
  display_code: string;
  order_status: string;
  brand_name_ar: string;
  handoff_code: string | null;
  total_halalas: number;
  prep_minutes: number | null;
  /** موافقة العميل على وقت التجهيز المتوقع — شرط الانتقال للدفع (docs/05§3) */
  prep_time_confirmed_at: string | null;
  /** مهلتا 5 دقائق: الموافقة على الوقت ثم الدفع (docs/06 BR-2) */
  prep_confirm_deadline_at: string | null;
  payment_deadline_at: string | null;
  /** مسار التجهيز الموازي (docs/05§3) — حقيقتا التحضير والجاهزية مستقلتان عن حالة الرحلة */
  preparing_at: string | null;
  ready_at: string | null;
  vehicle: { color_ar: string; model_ar: string | null; plate_short: string } | null;
}

const STEPS = ["SUBMITTED", "ACCEPTED", "PREPARING", "READY", "ON_THE_WAY", "ARRIVED", "COMPLETED"];
/* عناوين شريط الحالات السبع — حرفياً من P7 */
const STEP_LABELS = [
  "تم استلام الطلب",
  "تم قبول الطلب",
  "قيد التجهيز",
  "جاهز للاستلام",
  "في طريقك",
  "وصلت",
  "تم التسليم"
];
const DISPLAY: Record<string, { step: string; title: string; sub: string }> = {
  CHECKOUT_PENDING: { step: "SUBMITTED", title: "لحظات…", sub: "نرسل طلبك للمطعم" },
  PAYMENT_PENDING: { step: "ACCEPTED", title: "أكمل الدفع ليبدأ التجهيز", sub: "المطعم بانتظار دفعك — المهلة 5 دقائق" },
  PAYMENT_FAILED: { step: "ACCEPTED", title: "ما تمّ الدفع", sub: "جرّب مرة ثانية خلال المهلة — طلبك محفوظ" },
  ORDER_SUBMITTED: { step: "SUBMITTED", title: "أُرسل طلبك", sub: "ننتظر تأكيد المطعم — لا دفع حتى الآن" },
  MERCHANT_PENDING: { step: "SUBMITTED", title: "أُرسل طلبك", sub: "ننتظر تأكيد المطعم — لا دفع حتى الآن" },
  MERCHANT_ACCEPTED: { step: "ACCEPTED", title: "قبل المطعم طلبك", sub: "وافق على وقت التجهيز وادفع ليبدأ المطعم" },
  MERCHANT_REJECTED: {
    step: "SUBMITTED",
    title: "نعتذر — ما قدر المطعم يستقبل طلبك",
    sub: "لم يُدفع أي مبلغ — أعد الطلب من مطعم آخر"
  },
  EXPIRED: { step: "SUBMITTED", title: "انتهت مهلة الطلب", sub: "لم يُدفع أي مبلغ — أعد الطلب متى شئت" },
  PREPARING: { step: "PREPARING", title: "قيد التجهيز", sub: "تم دفعك — انطلق بحسب الوقت المتفق" },
  READY: { step: "READY", title: "طلبك جاهز", sub: "خلّك في سيارتك، الباقي علينا" },
  CUSTOMER_NOTIFIED: { step: "READY", title: "طلبك جاهز", sub: "اضغط «انطلقت الآن» حين تتحرك" },
  CUSTOMER_ON_THE_WAY: { step: "ON_THE_WAY", title: "أنت في الطريق", sub: "المطعم يعرف وقت وصولك" },
  CUSTOMER_NEARBY: { step: "ON_THE_WAY", title: "اقتربت!", sub: "تم رصد اقترابك — أبلغنا المطعم تلقائيًا" },
  CUSTOMER_ARRIVED: { step: "ARRIVED", title: "وصلت؟ إحنا عرفنا.", sub: "الموظف في طريقه إليك" },
  HANDOFF_IN_PROGRESS: { step: "ARRIVED", title: "الموظف متجه إليك", sub: "يحمل طلبك — جهّز الرمز" },
  COMPLETED: { step: "COMPLETED", title: "بالعافية!", sub: "قيّم استلامك بضغطة" },
  CANCELLED: { step: "SUBMITTED", title: "أُلغي الطلب", sub: "إن كان دُفع مبلغ فسيرجع حسب السياسة" }
};

const DRIVE_STATES = ["CUSTOMER_ON_THE_WAY", "CUSTOMER_NEARBY"];
const ARRIVED_STATES = ["CUSTOMER_ARRIVED", "HANDOFF_IN_PROGRESS"];
const PARKING_SPOTS = [1, 2, 3, 4, 5];

export default function TrackScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [eta, setEta] = useState<number | null>(null);
  const tripTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Sheet الموقف (C-48)
  const [sheetOpen, setSheetOpen] = useState(false);
  const [spotSel, setSpotSel] = useState<number | null>(null);
  const [freeText, setFreeText] = useState("");
  const [parkingLabel, setParkingLabel] = useState<string | null>(null);
  const [savingSpot, setSavingSpot] = useState(false);
  const [spotErr, setSpotErr] = useState<string | null>(null);

  // P8: التقييم بضغطة (BR-11)
  const [reviewDone, setReviewDone] = useState(false);
  const [savingReview, setSavingReview] = useState(false);

  // ساعة العدادات التنازلية (مهلتا 5 د — BR-2)
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const countdown = (deadline: string | null): string | null => {
    if (!deadline || now === null) return null;
    const s = Math.max(0, Math.floor((Date.parse(deadline) - now) / 1000));
    return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  };

  // موافقة العميل على وقت التجهيز — تفتح الدفع (docs/05§3)، أو رفض الوقت = إلغاء بلا رسوم
  const [confirmingPrep, setConfirmingPrep] = useState(false);
  const [prepErr, setPrepErr] = useState<string | null>(null);
  const confirmPrep = async () => {
    setConfirmingPrep(true);
    setPrepErr(null);
    try {
      await api("POST", `/v1/orders/${id}/confirm-prep-time`);
      await refresh();
    } catch (e) {
      setPrepErr((e as Error).message);
    } finally {
      setConfirmingPrep(false);
    }
  };
  const declinePrep = async () => {
    setConfirmingPrep(true);
    setPrepErr(null);
    try {
      await api("POST", `/v1/orders/${id}/cancel`, { reason: "wait_too_long" }, { idempotent: true });
      await refresh();
    } catch (e) {
      setPrepErr((e as Error).message);
    } finally {
      setConfirmingPrep(false);
    }
  };

  // الدفع — لا يبدأ التجهيز قبله؛ بوابة sandbox بنفس مسار الإنتاج (webhook موقع)
  const [paying, setPaying] = useState(false);
  const [payErr, setPayErr] = useState<string | null>(null);
  const payNow = async () => {
    setPaying(true);
    setPayErr(null);
    try {
      await api("POST", `/v1/orders/${id}/payment-intent`, { method: "card" }, { idempotent: true });
      const pay = await api<{ gateway_result: string }>("POST", `/v1/dev/mock-gateway/by-order/${id}/pay`);
      if (pay.gateway_result !== "authorized") {
        setPayErr("ما تمّ الدفع. جرّب مرة ثانية — طلبك محفوظ ضمن المهلة");
      }
      await refresh();
    } catch (e) {
      setPayErr((e as Error).message);
    } finally {
      setPaying(false);
    }
  };

  const refresh = useCallback(async () => {
    if (!id) return;
    try {
      const o = await api<Order>("GET", `/v1/orders/${id}`);
      setOrder(o);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);

  // polling كل 2.5 ثانية
  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 2500);
    return () => clearInterval(t);
  }, [refresh]);

  // تنظيف مؤقت الرحلة عند مغادرة الشاشة
  useEffect(
    () => () => {
      if (tripTimer.current) clearInterval(tripTimer.current);
    },
    []
  );

  const sendLocation = useCallback(async () => {
    try {
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const res = await api<{ eta_minutes: number | null }>("POST", `/v1/orders/${id}/trip/location`, {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        speed: pos.coords.speed,
        heading: pos.coords.heading,
        accuracy: pos.coords.accuracy
      });
      if (res.eta_minutes !== null) setEta(res.eta_minutes);
    } catch {
      /* التتبع تحسين لا شرط (docs/14§8) */
    }
  }, [id]);

  const startTrip = async () => {
    try {
      await api("POST", `/v1/orders/${id}/trip/start`);
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    // إرسال الموقع كل 8 ثوانٍ — foreground فقط (الخلفية عبر dev build لاحقاً)
    let granted = false;
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      granted = perm.status === Location.PermissionStatus.GRANTED;
    } catch {
      granted = false;
    }
    if (granted && !tripTimer.current) {
      void sendLocation();
      tripTimer.current = setInterval(() => void sendLocation(), 8000);
    }
    await refresh();
  };

  const confirmArrival = async () => {
    if (tripTimer.current) {
      clearInterval(tripTimer.current);
      tripTimer.current = null;
    }
    try {
      await api("POST", `/v1/orders/${id}/arrival`);
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    await refresh();
    // بعد تأكيد الوصول → «وين وقفت؟» (C-47 → C-48)
    setSpotErr(null);
    setSheetOpen(true);
  };

  const submitParking = async () => {
    const text = spotSel !== null ? `الموقف ${spotSel}` : freeText.trim();
    if (!text) return;
    setSavingSpot(true);
    setSpotErr(null);
    try {
      await api("POST", `/v1/orders/${id}/parking-spot`, { free_text: text });
      setParkingLabel(text);
      setSheetOpen(false);
    } catch (e) {
      setSpotErr((e as Error).message);
    } finally {
      setSavingSpot(false);
    }
  };

  const submitReview = async (stars: number) => {
    setSavingReview(true);
    try {
      await api("POST", `/v1/orders/${id}/review`, { rating_overall: stars });
      setReviewDone(true);
    } catch {
      /* التقييم اختياري — لا نزعج */
    } finally {
      setSavingReview(false);
    }
  };

  if (error && !order) {
    return (
      <SafeAreaView style={st.screen}>
        <View style={{ padding: 16 }}>
          <ErrorNote text={error} />
          <GhostButton title="رجوع" onPress={() => router.back()} />
        </View>
      </SafeAreaView>
    );
  }
  if (!order) {
    return (
      <SafeAreaView style={st.screen}>
        <Loader />
      </SafeAreaView>
    );
  }

  const baseView = DISPLAY[order.order_status] ?? DISPLAY.MERCHANT_PENDING!;
  // رحلتك قد تسبق التجهيز (docs/05§3) — النص يصدُق: الطلب ما زال يُجهَّز
  const journeyBeforeReady =
    ["CUSTOMER_ON_THE_WAY", "CUSTOMER_NEARBY", "CUSTOMER_ARRIVED"].includes(order.order_status) &&
    !order.ready_at;
  const view = journeyBeforeReady
    ? {
        ...baseView,
        sub:
          order.order_status === "CUSTOMER_ARRIVED"
            ? "طلبك يُجهَّز الآن — نطلع لك فور جاهزيته"
            : "المطعم يجهّز طلبك على وقت وصولك"
      }
    : baseView;
  const stepIdx = STEPS.indexOf(view.step);
  const completed = order.order_status === "COMPLETED";
  // صدق شريط الخطوات: «قيد التجهيز» و«جاهز» تُعلَّمان بحقائق التجهيز لا بموقع الرحلة
  const stepDone = (i: number): boolean => {
    if (completed) return true;
    if (i >= stepIdx) return false;
    if (STEPS[i] === "PREPARING") return Boolean(order.preparing_at ?? order.ready_at);
    if (STEPS[i] === "READY") return Boolean(order.ready_at);
    return true;
  };
  const driveMode = DRIVE_STATES.includes(order.order_status); // وضع القيادة الداكن
  const arrived = ARRIVED_STATES.includes(order.order_status);
  // الرحلة بعد الدفع حصراً (docs/05§4-1) — PREPARING تعني أن الدفع تم
  const canStart = ["PREPARING", "READY", "CUSTOMER_NOTIFIED"].includes(order.order_status);
  const canArrive = DRIVE_STATES.includes(order.order_status);

  // رموز دلالية بحسب الوضع — القيادة: ink-900 (08§7)
  const T = driveMode
    ? { bg: dark.bg, surface: dark.surface, text: dark.text, text2: dark.text2, border: dark.border }
    : { bg: light.bg, surface: light.surface, text: light.text, text2: light.text2, border: light.border };

  return (
    <SafeAreaView style={[st.screen, { backgroundColor: T.bg }]} edges={["top"]}>
      <StatusBar style={driveMode ? "light" : "dark"} />
      <ScrollView contentContainerStyle={st.body}>
        <View style={st.headRow}>
          <Pressable
            style={st.back}
            onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)/home"))}
            accessibilityRole="button"
          >
            <Text style={[st.backTxt, { color: T.text2 }]}>‹</Text>
          </Pressable>
          <Text style={[st.code, { color: T.text2 }]}>{order.display_code}</Text>
        </View>

        {/* شريط الحالات السبع */}
        <View style={st.steps} accessibilityLabel="حالة الطلب">
          {STEP_LABELS.map((lb, i) => {
            const done = stepDone(i);
            const cur = !completed && i === stepIdx;
            return (
              <View key={lb} style={st.step}>
                <View
                  style={[
                    st.dot,
                    { borderColor: T.border },
                    done ? st.dotDone : null,
                    cur ? st.dotCur : null
                  ]}
                >
                  <Text style={st.dotTxt}>{done ? "✓" : cur ? "●" : ""}</Text>
                </View>
                <Text
                  style={[st.stepLbl, { color: done || cur ? T.text : T.text2 }, cur ? st.stepLblCur : null]}
                  numberOfLines={2}
                >
                  {lb}
                </Text>
              </View>
            );
          })}
        </View>

        {error && <ErrorNote text={error} />}

        <Text style={[st.title, { color: T.text, fontSize: driveMode ? fs.fs34 : fs.fs24 }]}>
          {view.title}
        </Text>
        <Text style={[st.sub, { color: T.text2 }]}>{view.sub}</Text>

        {/* 1) موافقة العميل على وقت التجهيز — مهلة 5 د، والدفع بعدها (docs/05§3) */}
        {order.order_status === "MERCHANT_ACCEPTED" && order.prep_minutes !== null && !order.prep_time_confirmed_at && (
          <View style={[st.card, { backgroundColor: T.surface, borderColor: T.border, alignItems: "center" }]}>
            <Text style={{ color: T.text, fontSize: fs.fs15, fontWeight: "800", textAlign: "center" }}>
              المطعم حدّد الوقت المتوقع لتجهيز طلبك
            </Text>
            <Text style={st.prepMinutes}>{order.prep_minutes} دقيقة</Text>
            <Text style={{ color: T.text2, fontSize: fs.fs13, textAlign: "center", marginBottom: 8 }}>
              يناسبك؟ وافق وادفع ليبدأ التجهيز
              {countdown(order.prep_confirm_deadline_at) ? ` — المهلة ${countdown(order.prep_confirm_deadline_at)}` : ""}
            </Text>
            {prepErr && <ErrorNote text={prepErr} />}
            <LimeButton
              title="يناسبني — أكمل للدفع"
              disabled={confirmingPrep}
              onPress={() => void confirmPrep()}
              style={{ alignSelf: "stretch" }}
            />
            <Pressable
              disabled={confirmingPrep}
              onPress={() => void declinePrep()}
              accessibilityRole="button"
              style={{ marginTop: 10, minHeight: touch, justifyContent: "center" }}
            >
              <Text style={{ color: colors.error, fontSize: fs.fs14, textAlign: "center" }}>
                لا يناسبني — إلغاء الطلب بلا رسوم
              </Text>
            </Pressable>
          </View>
        )}

        {/* 2) الدفع — بعد الموافقة، مهلة 5 د؛ نجاحه يبدأ التجهيز فوراً */}
        {((order.order_status === "MERCHANT_ACCEPTED" && order.prep_time_confirmed_at) ||
          ["PAYMENT_PENDING", "PAYMENT_FAILED"].includes(order.order_status)) && (
          <View style={[st.card, { backgroundColor: T.surface, borderColor: T.border, alignItems: "center" }]}>
            <View style={st.okBadge}>
              <Text style={st.okBadgeTxt}>✓ وافقت على {order.prep_minutes} دقيقة</Text>
            </View>
            <Text style={{ color: T.text, fontSize: fs.fs15, fontWeight: "800", textAlign: "center", marginTop: 8 }}>
              ادفع الآن ليبدأ المطعم التجهيز
            </Text>
            <Text style={{ color: T.text2, fontSize: fs.fs13, textAlign: "center", marginVertical: 6 }}>
              {order.order_status === "PAYMENT_FAILED" ? "ما تمّ الدفع — جرّب مرة ثانية" : "التجهيز لا يبدأ قبل دفعك"}
              {countdown(order.payment_deadline_at) ? ` — المهلة ${countdown(order.payment_deadline_at)}` : ""}
            </Text>
            {payErr && <ErrorNote text={payErr} />}
            <LimeButton
              title={paying ? "جارٍ الدفع…" : `ادفع الآن — ${(order.total_halalas / 100).toFixed(2)} ر.س`}
              disabled={paying}
              onPress={() => void payNow()}
              style={{ alignSelf: "stretch" }}
            />
          </View>
        )}

        {/* بطاقة ETA الكبيرة — وضع القيادة (C-45) */}
        {driveMode && eta !== null && (
          <View style={[st.card, { backgroundColor: T.surface, borderColor: T.border }]}>
            <Text style={st.etaValue}>{eta} دقيقة</Text>
            <Text style={{ color: T.text2, fontSize: fs.fs14, textAlign: "center" }}>
              حتى وصولك — {order.brand_name_ar}
            </Text>
          </View>
        )}

        {/* بطاقة السيارة (C-42/C-49) */}
        {order.vehicle && (
          <View style={[st.card, st.vehRow, { backgroundColor: T.surface, borderColor: T.border }]}>
            <View style={{ flex: 1 }}>
              <Text style={[st.vehName, { color: T.text }]}>
                {[order.vehicle.model_ar, order.vehicle.color_ar, order.vehicle.plate_short]
                  .filter(Boolean)
                  .join(" · ")}
              </Text>
              <Text style={{ color: T.text2, fontSize: fs.fs13, textAlign: "right" }}>
                الموظف يعرف سيارتك مسبقًا
              </Text>
            </View>
            {parkingLabel && (
              <View style={st.spotBadge}>
                <Text style={st.spotBadgeTxt}>{parkingLabel}</Text>
              </View>
            )}
          </View>
        )}

        {/* بطاقة رمز الاستلام الليمونية (C-50/C-51) */}
        {order.handoff_code && arrived && (
          <View style={st.codeCard}>
            <Text style={st.codeLabel}>رمز الاستلام</Text>
            <Text style={st.codeDigits}>{order.handoff_code}</Text>
          </View>
        )}

        {/* الموقف — يفتح Sheet «وين وقفت؟» (C-48) */}
        {arrived && !parkingLabel && (
          <GhostButton
            title="وين وقفت؟"
            onPress={() => {
              setSpotErr(null);
              setSheetOpen(true);
            }}
            style={{ marginTop: 8, backgroundColor: T.surface, borderColor: T.border }}
            textStyle={{ color: T.text }}
          />
        )}

        {canStart && (
          <LimeButton title="انطلقت الآن" onPress={() => void startTrip()} style={{ marginTop: 12 }} />
        )}
        {canArrive && (
          <>
            <LimeButton title="وصلت" onPress={() => void confirmArrival()} style={{ marginTop: 12 }} />
            <Text style={[st.footNote, { color: T.text2 }]}>
              «وصلت» بيدك دائماً — ما نحوّل حالتك بالـGPS وحده أبداً
            </Text>
          </>
        )}

        {completed && (
          <View style={[st.card, { backgroundColor: T.surface, borderColor: T.border, alignItems: "center" }]}>
            <View style={st.okBadge}>
              <Text style={st.okBadgeTxt}>تم التسليم ✓</Text>
            </View>
            {!reviewDone ? (
              <View style={{ marginTop: 12, alignItems: "center" }}>
                <View style={st.stars}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <Pressable
                      key={n}
                      disabled={savingReview}
                      onPress={() => void submitReview(n)}
                      accessibilityRole="button"
                      accessibilityLabel={`${n} من 5`}
                      style={st.starBtn}
                    >
                      <Text style={st.star}>★</Text>
                    </Pressable>
                  ))}
                </View>
                <Text style={{ color: T.text2, fontSize: fs.fs13, marginTop: 4 }}>قيّم استلامك بضغطة</Text>
              </View>
            ) : (
              <Text style={{ color: T.text2, fontSize: fs.fs14, marginTop: 10 }}>
                شكراً لك — تقييمك يطوّر التجربة 🌟
              </Text>
            )}
          </View>
        )}
      </ScrollView>

      {/* Sheet الموقف (C-48): موقف مرقم 1–5 أو وصف حر */}
      <Modal visible={sheetOpen} transparent animationType="slide" onRequestClose={() => setSheetOpen(false)}>
        <View style={st.dim}>
          <Pressable style={{ flex: 1 }} onPress={() => setSheetOpen(false)} />
          <View style={st.sheet}>
            <View style={st.grab} />
            <Text style={st.sheetTitle}>وين وقفت؟</Text>
            <Text style={st.sheetHint}>تحديد موقفك يوصل راشد لسيارتك مباشرة — بلا لف ولا اتصال.</Text>
            <View style={st.spotGrid}>
              {PARKING_SPOTS.map((n) => {
                const on = spotSel === n;
                return (
                  <Pressable
                    key={n}
                    style={[st.spotBtn, on ? st.spotBtnOn : null]}
                    onPress={() => {
                      setSpotSel(on ? null : n);
                      setFreeText("");
                    }}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                  >
                    <Text style={[st.spotBtnTxt, on ? { color: colors.ink900 } : null]}>{n}</Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={st.spotGridHint}>مواقف «استلام بيكلي» المرقمة — خلف الواجهة</Text>
            <Text style={st.label}>صف مكان سيارتك للموظف</Text>
            <TextInput
              style={st.inp}
              value={freeText}
              placeholder="على يمين البوابة الخلفية، جنب شاحنة التوريد"
              placeholderTextColor={colors.gray}
              onChangeText={(v) => {
                setFreeText(v);
                setSpotSel(null);
              }}
            />
            {spotErr && <ErrorNote text={spotErr} />}
            <LimeButton
              title="تأكيد الموقف"
              disabled={savingSpot || (spotSel === null && freeText.trim() === "")}
              onPress={() => void submitParking()}
              style={{ marginTop: 10 }}
            />
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  screen: { flex: 1, backgroundColor: light.bg },
  body: { padding: 16, paddingBottom: 40 },
  headRow: { flexDirection: "row-reverse", alignItems: "center", gap: 8, marginBottom: 8 },
  back: { width: touch, height: touch, alignItems: "center", justifyContent: "center" },
  backTxt: { fontSize: fs.fs24, fontWeight: "800" },
  code: { fontSize: fs.fs14, fontVariant: ["tabular-nums"] },
  steps: { flexDirection: "row-reverse", justifyContent: "space-between", gap: 2, marginBottom: 16 },
  step: { flex: 1, alignItems: "center", gap: 4 },
  dot: {
    width: 22,
    height: 22,
    borderRadius: radiusPill,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center"
  },
  dotDone: { backgroundColor: colors.success, borderColor: colors.success },
  dotCur: { backgroundColor: colors.lime500, borderColor: colors.lime500 },
  dotTxt: { color: colors.ink900, fontSize: 10, fontWeight: "900" },
  stepLbl: { fontSize: 9, textAlign: "center" },
  stepLblCur: { fontWeight: "900" },
  title: { fontWeight: "900", textAlign: "right", marginBottom: 4 },
  sub: { fontSize: fs.fs15, textAlign: "right", marginBottom: 14 },
  card: { borderRadius: radius, borderWidth: 1, padding: 14, marginBottom: 10 },
  etaValue: {
    color: colors.lime500,
    fontSize: fs.fs32,
    fontWeight: "900",
    textAlign: "center",
    fontVariant: ["tabular-nums"]
  },
  prepMinutes: {
    color: colors.lime900,
    fontSize: fs.fs32,
    fontWeight: "900",
    textAlign: "center",
    marginVertical: 4,
    fontVariant: ["tabular-nums"]
  },
  vehRow: { flexDirection: "row-reverse", alignItems: "center", gap: 10 },
  vehName: { fontSize: fs.fs15, fontWeight: "800", textAlign: "right" },
  spotBadge: {
    backgroundColor: colors.lime100,
    borderRadius: radiusPill,
    paddingHorizontal: 10,
    paddingVertical: 4
  },
  spotBadgeTxt: { color: colors.lime900, fontSize: fs.fs12, fontWeight: "800" },
  codeCard: {
    backgroundColor: colors.lime500,
    borderRadius: radius,
    padding: 18,
    alignItems: "center",
    marginBottom: 10
  },
  codeLabel: { color: colors.lime900, fontSize: fs.fs13, fontWeight: "800", marginBottom: 4 },
  codeDigits: {
    color: colors.ink900,
    fontSize: fs.bPlate,
    fontWeight: "900",
    letterSpacing: 10,
    fontVariant: ["tabular-nums"]
  },
  footNote: { fontSize: fs.fs12, textAlign: "center", marginTop: 8 },
  okBadge: {
    backgroundColor: "#E2F3ED",
    borderRadius: radiusPill,
    paddingHorizontal: 12,
    paddingVertical: 5
  },
  okBadgeTxt: { color: colors.success, fontSize: fs.fs14, fontWeight: "800" },
  stars: { flexDirection: "row", gap: 6 },
  starBtn: { width: touch, height: touch, alignItems: "center", justifyContent: "center" },
  star: { color: colors.warn, fontSize: 30, lineHeight: 34 },
  dim: { flex: 1, backgroundColor: "rgba(16,36,27,0.55)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: light.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 16,
    paddingBottom: 28
  },
  grab: {
    width: 44,
    height: 4,
    borderRadius: radiusPill,
    backgroundColor: light.border,
    alignSelf: "center",
    marginBottom: 10
  },
  sheetTitle: { color: light.text, fontSize: fs.fs20, fontWeight: "900", textAlign: "right" },
  sheetHint: { color: light.text2, fontSize: fs.fs13, textAlign: "right", marginTop: 4, marginBottom: 12 },
  spotGrid: { flexDirection: "row-reverse", gap: 8 },
  spotBtn: {
    flex: 1,
    minHeight: touch + 4,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: light.border,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: light.bg
  },
  spotBtnOn: { backgroundColor: colors.lime500, borderColor: colors.lime500 },
  spotBtnTxt: { color: light.text, fontSize: fs.fs17, fontWeight: "800", fontVariant: ["tabular-nums"] },
  spotGridHint: { color: light.text2, fontSize: fs.fs12, textAlign: "right", marginTop: 6, marginBottom: 10 },
  label: { color: light.text, fontSize: fs.fs14, fontWeight: "700", textAlign: "right", marginBottom: 6 },
  inp: {
    minHeight: touch + 4,
    backgroundColor: light.bg,
    borderWidth: 1,
    borderColor: light.border,
    borderRadius: radius,
    paddingHorizontal: 12,
    fontSize: fs.fs14,
    color: light.text,
    textAlign: "right"
  }
});
