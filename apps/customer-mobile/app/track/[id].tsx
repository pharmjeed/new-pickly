/**
 * P7 ⭐ الطلب الحي — صفحة واحدة تقودها آلة الحالات (C-38→C-51):
 * - polling كل 2.5s على GET /v1/orders/{id}
 * - شريط الحالات السبع
 * - وضع قيادة داكن (ink-900) أثناء الطريق
 * - «وصلت» POST arrival (الخادم يفتح جلسة يدوية تلقائياً — J10) · Sheet الموقف POST parking-spot {free_text}
 * - عند COMPLETED تقييم بنجوم (P8)
 */
import { useCallback, useEffect, useState } from "react";
import { Linking, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { api } from "../../src/api";
import { ErrorNote, GhostButton, LimeButton, Loader } from "../../src/ui";
import { Qirtas } from "../../src/qirtas";
import {
  bw2,
  bw3,
  colors,
  dark,
  fs,
  light,
  popLime,
  popSm,
  radius,
  radiusLg,
  radiusPill,
  statusColors,
  touch
} from "../../src/theme";

interface Order {
  id: string;
  display_code: string;
  order_status: string;
  branch_id: string;
  brand_name_ar: string;
  /** الوقت المتوقع — «متوسط وقت التجهيز» المختوم عند القبول من إعدادات المطعم */
  prep_minutes: number | null;
  /** مسار التجهيز الموازي (docs/05§3) — حقيقتا التحضير والجاهزية مستقلتان عن حالة الرحلة */
  preparing_at: string | null;
  ready_at: string | null;
  vehicle: { color_ar: string; model_ar: string | null; plate_short: string } | null;
}

const STEPS = ["SUBMITTED", "ACCEPTED", "PREPARING", "READY", "ARRIVED", "COMPLETED"];
/* عناوين شريط الحالات الست — «جاهز للاستلام» لا تُضاء إلا بضغطة المطعم «جاهز» (ready_at) */
const STEP_LABELS = [
  "تم استلام الطلب",
  "تم قبول الطلب",
  "قيد التجهيز",
  "جاهز للاستلام",
  "وصلت",
  "تم التسليم"
];
const DISPLAY: Record<string, { step: string; title: string; sub: string }> = {
  CHECKOUT_PENDING: { step: "SUBMITTED", title: "لحظات…", sub: "نجهّز طلبك للدفع" },
  PAYMENT_PENDING: { step: "SUBMITTED", title: "جارٍ الدفع…", sub: "لا تغلق الصفحة" },
  PAYMENT_FAILED: { step: "SUBMITTED", title: "ما تمّ الدفع", sub: "جرّب بطاقة ثانية — طلبك محفوظ" },
  ORDER_SUBMITTED: { step: "SUBMITTED", title: "أُرسل طلبك", sub: "ننتظر تأكيد المطعم" },
  MERCHANT_PENDING: { step: "SUBMITTED", title: "أُرسل طلبك", sub: "ننتظر تأكيد المطعم" },
  MERCHANT_ACCEPTED: { step: "ACCEPTED", title: "قبل المطعم طلبك", sub: "المطعم يجهّز طلبك على وقت وصولك" },
  MERCHANT_REJECTED: {
    step: "SUBMITTED",
    title: "نعتذر — ما قدر المطعم يستقبل طلبك",
    sub: "مبلغك يرجع لك كاملاً"
  },
  PREPARING: { step: "PREPARING", title: "قيد التجهيز", sub: "خلّك مستعد للانطلاق" },
  READY: { step: "READY", title: "طلبك جاهز", sub: "خلّك في سيارتك، الباقي علينا" },
  CUSTOMER_NOTIFIED: { step: "READY", title: "طلبك جاهز", sub: "توجه للمطعم — واضغط «وصلت» عند وصولك" },
  CUSTOMER_ON_THE_WAY: { step: "READY", title: "أنت في الطريق", sub: "المطعم يعرف وقت وصولك" },
  CUSTOMER_NEARBY: { step: "READY", title: "اقتربت!", sub: "تم رصد اقترابك — أبلغنا المطعم تلقائيًا" },
  CUSTOMER_ARRIVED: { step: "ARRIVED", title: "وصلت؟ إحنا عرفنا.", sub: "الموظف في طريقه إليك" },
  HANDOFF_IN_PROGRESS: { step: "ARRIVED", title: "الموظف متجه إليك", sub: "يحمل طلبك — جهّز الرمز" },
  COMPLETED: { step: "COMPLETED", title: "بالعافية!", sub: "قيّم استلامك بضغطة" },
  CANCELLED: { step: "SUBMITTED", title: "أُلغي الطلب", sub: "مبلغك يرجع لك حسب السياسة" }
};

const DRIVE_STATES = ["CUSTOMER_ON_THE_WAY", "CUSTOMER_NEARBY"];
const ARRIVED_STATES = ["CUSTOMER_ARRIVED", "HANDOFF_IN_PROGRESS"];

/** موقف استلام يخدمه الفرع — يحدده المطعم من بوابته (مع نقطته على الخريطة إن ثُبتت) */
interface BranchSpot {
  id: string;
  label: string;
  lat: number | null;
  lng: number | null;
}

/** ملاحة خارجية لنقطة الموقف — خرائط قوقل بالاتجاهات (نمط أوبر: المتوجه يقصد النقطة المحددة) */
const navUrl = (lat: number, lng: number) =>
  `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`;

export default function TrackScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Sheet الموقف (C-48) — المواقف من تعريف الفرع لا قائمة ثابتة
  const [sheetOpen, setSheetOpen] = useState(false);
  const [branchSpots, setBranchSpots] = useState<BranchSpot[] | null>(null);
  const [spotSel, setSpotSel] = useState<string | null>(null);
  const [freeText, setFreeText] = useState("");
  const [parkingLabel, setParkingLabel] = useState<string | null>(null);
  // الموقف المؤكد بنقطته — يقود زر «التوجه لموقفك»
  const [chosenSpot, setChosenSpot] = useState<BranchSpot | null>(null);
  const [savingSpot, setSavingSpot] = useState(false);
  const [spotErr, setSpotErr] = useState<string | null>(null);

  // P8: التقييم بضغطة (BR-11)
  const [reviewDone, setReviewDone] = useState(false);
  const [savingReview, setSavingReview] = useState(false);

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

  // مواقف الفرع المعرفة من المطعم — موقف واحد أو أكثر والعميل يختار منها
  const branchId = order?.branch_id;
  useEffect(() => {
    if (!branchId) return;
    api<BranchSpot[]>("GET", `/v1/branches/${branchId}/parking-spots`)
      .then(setBranchSpots)
      .catch(() => setBranchSpots([])); // لا مواقف معرفة → الوصف النصي يكفي
  }, [branchId]);

  const confirmArrival = async () => {
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
    const chosen = branchSpots?.find((s) => s.id === spotSel) ?? null;
    const text = freeText.trim();
    if (!chosen && !text) return;
    setSavingSpot(true);
    setSpotErr(null);
    try {
      // موقف معرف من الفرع → spot_id (الخادم يتحقق أنه يخص فرع الطلب)؛ وإلا وصف حر
      await api("POST", `/v1/orders/${id}/parking-spot`, chosen ? { spot_id: chosen.id } : { free_text: text });
      setParkingLabel(chosen ? chosen.label : text);
      setChosenSpot(chosen);
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
        // الشريط لا يتقدم لـ«جاهز للاستلام» قبل ضغطة المطعم «جاهز» — الخطوة الصادقة «قيد التجهيز»
        step: order.order_status === "CUSTOMER_ARRIVED" ? baseView.step : "PREPARING",
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
  const canStart = ["MERCHANT_ACCEPTED", "PREPARING", "READY", "CUSTOMER_NOTIFIED"].includes(
    order.order_status
  );
  // «وصلت» متاح من القبول وحتى الوصول — بلا زر «انطلقت الآن»: الخادم يفتح جلسة يدوية تلقائياً (J10)
  const canArrive = canStart || driveMode;

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

        {/* الوقت المتوقع — من «متوسط وقت التجهيز» الذي يحدده المطعم في صفحته (قرار المالك 2026-07-12) */}
        {["MERCHANT_ACCEPTED", "PREPARING"].includes(order.order_status) && order.prep_minutes !== null && !order.ready_at && (
          <View
            style={[st.card, { backgroundColor: T.surface, borderColor: T.border, alignItems: "center" }]}
            testID="prep-expected"
          >
            <Text style={{ color: T.text, fontSize: fs.fs15, fontWeight: "800", textAlign: "center" }}>
              الوقت المتوقع لتجهيز طلبك
            </Text>
            <Text style={st.prepMinutes}>~{order.prep_minutes} دقيقة</Text>
            <Text style={{ color: T.text2, fontSize: fs.fs13, textAlign: "center" }}>
              متوسط وقت التجهيز لدى المطعم — انطلق بحسبه
            </Text>
          </View>
        )}

        {/* بطاقة السيارة (C-42/C-49) — فوق داكن وضع القيادة الظل ليموني */}
        {order.vehicle && (
          <View
            style={[
              st.card,
              st.vehRow,
              { backgroundColor: T.surface, borderColor: T.border },
              driveMode ? popLime : null
            ]}
          >
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

        {/* لحظة الوصول — القرطاس المتحمس (كاركتر الحالة الواحد) */}
        {arrived && (
          <View style={st.arrivedChar}>
            <Qirtas mood="excited" size={72} lines />
          </View>
        )}

        {/* التوجه لنقطة الموقف التي ثبتها المطعم — نمط أوبر: المتوجه يقصد النقطة المحددة */}
        {chosenSpot && chosenSpot.lat !== null && chosenSpot.lng !== null && !completed && (
          <GhostButton
            title={`🧭 التوجه لموقفك — ${chosenSpot.label}`}
            onPress={() => void Linking.openURL(navUrl(chosenSpot.lat!, chosenSpot.lng!))}
            style={{ marginTop: 8, backgroundColor: T.surface, borderColor: T.border }}
            textStyle={{ color: T.text }}
          />
        )}

        {/* اختيار الموقف مسبقاً — قبل الوصول، ليتوجه العميل لنقطته مباشرة */}
        {(canStart || canArrive) && !parkingLabel && branchSpots && branchSpots.length > 0 && (
          <GhostButton
            title="اختر موقفك مسبقاً — نوجهك لنقطته"
            onPress={() => {
              setSpotErr(null);
              setSheetOpen(true);
            }}
            style={{ marginTop: 8, backgroundColor: T.surface, borderColor: T.border }}
            textStyle={{ color: T.text }}
          />
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

        {canArrive && (
          <>
            <LimeButton lime title="وصلت" onPress={() => void confirmArrival()} style={{ marginTop: 12 }} />
            <Text style={[st.footNote, { color: T.text2 }]}>
              «وصلت» بيدك دائماً — اضغطه فور وقوفك عند المطعم
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
                {/* التقييم — القرطاس الغامز */}
                <Qirtas mood="wink" size={64} />
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
            <Text style={st.sheetTitle}>{arrived ? "وين وقفت؟" : "اختر موقفك"}</Text>
            <Text style={st.sheetHint}>
              {arrived
                ? "تحديد موقفك يوصل راشد لسيارتك مباشرة — بلا لف ولا اتصال."
                : "اختر موقفك الآن ونوجهك لنقطته على الخريطة — والمطعم يعرف وين تقف."}
            </Text>
            {branchSpots && branchSpots.length > 0 && (
              <>
                <View style={st.spotGrid}>
                  {branchSpots.map((sp) => {
                    const on = spotSel === sp.id;
                    return (
                      <Pressable
                        key={sp.id}
                        style={[st.spotBtn, on ? st.spotBtnOn : null]}
                        onPress={() => {
                          setSpotSel(on ? null : sp.id);
                          setFreeText("");
                        }}
                        accessibilityRole="button"
                        accessibilityState={{ selected: on }}
                      >
                        <Text style={[st.spotBtnTxt, on ? { color: colors.white } : null]}>{sp.label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
                <Text style={st.spotGridHint}>
                  {branchSpots.length === 1
                    ? "المطعم يخدم هذا الموقف — اختره ليصلك طلبك مباشرة"
                    : "المواقف التي يخدمها المطعم — اختر موقفك منها"}
                </Text>
              </>
            )}
            <Text style={st.label}>
              {branchSpots && branchSpots.length > 0 ? "أو صف مكان سيارتك للموظف" : "صف مكان سيارتك للموظف"}
            </Text>
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
  dotCur: { backgroundColor: colors.blue500, borderColor: colors.ink900 },
  dotTxt: { color: colors.white, fontSize: 10, fontWeight: "900" },
  stepLbl: { fontSize: 9, textAlign: "center" },
  stepLblCur: { fontWeight: "900" },
  title: { fontWeight: "900", textAlign: "right", marginBottom: 4 },
  sub: { fontSize: fs.fs15, textAlign: "right", marginBottom: 14 },
  card: { borderRadius: radius, borderWidth: bw2, padding: 14, marginBottom: 10 },
  arrivedChar: { alignItems: "center", marginBottom: 8 },
  prepMinutes: {
    color: colors.blue500,
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
  footNote: { fontSize: fs.fs12, textAlign: "center", marginTop: 8 },
  okBadge: {
    backgroundColor: statusColors.doneBg,
    borderRadius: radiusPill,
    borderWidth: bw2,
    borderColor: colors.ink900,
    paddingHorizontal: 12,
    paddingVertical: 5
  },
  okBadgeTxt: { color: colors.success, fontSize: fs.fs14, fontWeight: "800" },
  stars: { flexDirection: "row", gap: 6 },
  starBtn: { width: touch, height: touch, alignItems: "center", justifyContent: "center" },
  star: { color: colors.warn, fontSize: 30, lineHeight: 34 },
  dim: { flex: 1, backgroundColor: "rgba(14,27,61,0.55)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: light.surface,
    borderTopLeftRadius: radiusLg,
    borderTopRightRadius: radiusLg,
    borderTopWidth: bw3,
    borderLeftWidth: bw3,
    borderRightWidth: bw3,
    borderColor: colors.ink900,
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
  spotGrid: { flexDirection: "row-reverse", flexWrap: "wrap", gap: 8 },
  spotBtn: {
    flexGrow: 1,
    minWidth: 56,
    minHeight: touch + 4,
    borderRadius: radius,
    borderWidth: bw2,
    borderColor: colors.ink900,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: light.bg,
    paddingHorizontal: 12
  },
  spotBtnOn: { backgroundColor: colors.blue500, borderColor: colors.ink900 },
  spotBtnTxt: { color: light.text, fontSize: fs.fs17, fontWeight: "800", fontVariant: ["tabular-nums"] },
  spotGridHint: { color: light.text2, fontSize: fs.fs12, textAlign: "right", marginTop: 6, marginBottom: 10 },
  label: { color: light.text, fontSize: fs.fs14, fontWeight: "700", textAlign: "right", marginBottom: 6 },
  inp: {
    minHeight: touch + 4,
    backgroundColor: light.bg,
    borderWidth: bw2,
    borderColor: colors.ink900,
    borderRadius: radius,
    paddingHorizontal: 12,
    fontSize: fs.fs14,
    color: light.text,
    textAlign: "right"
  }
});
