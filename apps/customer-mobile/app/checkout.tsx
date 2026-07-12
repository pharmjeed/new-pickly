/**
 * P6: الإتمام — صفحة تمرير واحدة: وقت + سيارة + مراجعة (C-28→C-37).
 * الدفع بعد القبول (docs/05§3): الإرسال هنا **بلا دفع** — الفرع يقبل بوقت تجهيز،
 * والعميل يوافق ويدفع من صفحة التتبع خلال مهلتي 5 دقائق.
 * وقت الاستلام FR-C06: أقرب وقت / مجدول بفترات وسعة (BR-5).
 * GET/POST /v1/customers/me/vehicles (S3: لون + آخر 4)
 * POST /v1/orders (idempotent) → /track/{id}
 */
import { useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { api, fmtSar } from "../src/api";
import { clearCart, getCartId, getQuoteId, setLastOrderId } from "../src/session";
import { Badge, Card, ErrorNote, LimeButton, Loader } from "../src/ui";
import { colors, fs, light, radius, radiusPill, shadow2, touch } from "../src/theme";

interface Vehicle {
  id: string;
  make_ar: string | null;
  model_ar: string | null;
  color_ar: string;
  plate_short: string;
  is_default: boolean;
}
interface Cart {
  id: string;
  branch_id: string;
  items: Array<{
    id: string;
    name_ar: string;
    quantity: number;
    line_total_halalas: number;
    modifiers: Array<{ name_ar: string }>;
  }>;
  quote: {
    quote_id: string;
    subtotal_halalas: number;
    discount_halalas: number;
    vat_halalas: number;
    service_fee_halalas: number;
    total_halalas: number;
  } | null;
}
interface OrderCreated {
  id: string;
  display_code: string;
  total_halalas: number;
}

interface Slot {
  id: string;
  slot_start: string;
  slot_end: string;
  remaining: number;
}

type PickupTime = "asap" | "scheduled";

const slotLabel = (iso: string): string =>
  new Date(iso).toLocaleString("ar-SA", { weekday: "short", hour: "2-digit", minute: "2-digit" });

export default function CheckoutScreen() {
  const [vehicles, setVehicles] = useState<Vehicle[] | null>(null);
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [color, setColor] = useState("");
  const [plate, setPlate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cart, setCart] = useState<Cart | null>(null);
  const [done, setDone] = useState<OrderCreated | null>(null);
  const [donePickup, setDonePickup] = useState<PickupTime>("asap");
  const [flags, setFlags] = useState<Record<string, boolean>>({});
  const [pickupTime, setPickupTime] = useState<PickupTime>("asap");
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [slotId, setSlotId] = useState<string | null>(null);
  const [slotsError, setSlotsError] = useState<string | null>(null);

  const cartId = getCartId();
  const quoteId = getQuoteId();
  const total = cart?.quote?.total_halalas ?? null;

  useEffect(() => {
    api<Record<string, boolean>>("GET", "/v1/feature-flags")
      .then(setFlags)
      .catch(() => undefined); // الأعلام ميزة تكيف — الافتراضي إخفاء المؤجل
  }, []);

  // BR-5: فترات الفرع تُجلب عند اختيار الجدولة
  useEffect(() => {
    if (pickupTime !== "scheduled" || !cart) return;
    setSlots(null);
    setSlotsError(null);
    api<Slot[]>("GET", `/v1/branches/${cart.branch_id}/slots`)
      .then((s) => {
        setSlots(s);
        if (s.length === 0) setSlotsError("لا فترات متاحة حالياً — جرّب لاحقاً أو اختر أقرب وقت");
      })
      .catch((e: Error) => setSlotsError(e.message));
  }, [pickupTime, cart]);

  useEffect(() => {
    api<Vehicle[]>("GET", "/v1/customers/me/vehicles")
      .then((vs) => {
        setVehicles(vs);
        const def = vs.find((v) => v.is_default) ?? vs[0];
        if (def) setVehicleId(def.id);
        else setShowAdd(true); // بلا سيارات؟ الإضافة تظهر مباشرة
      })
      .catch((e: Error) => setError(e.message));
    if (cartId) {
      api<Cart>("GET", `/v1/carts/${cartId}`)
        .then(setCart)
        .catch(() => undefined);
    }
  }, [cartId]);

  // النجاح حالة ختامية — ثم ننتقل للتتبع تلقائياً
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => router.replace(`/track/${done.id}` as never), 1400);
    return () => clearTimeout(t);
  }, [done]);

  const addVehicle = async () => {
    setBusy(true);
    setError(null);
    try {
      // إضافة سيارة مصغرة — S3: حقلان فقط
      const v = await api<Vehicle>("POST", "/v1/customers/me/vehicles", {
        color_ar: color,
        plate_short: plate
      });
      setVehicles((vs) => [...(vs ?? []), v]);
      setVehicleId(v.id);
      setShowAdd(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  /** الإرسال بلا دفع — الدفع يأتي بعد قبول الفرع وموافقتك على الوقت (docs/05§3) */
  const submitOrder = async () => {
    if (!cartId || !quoteId || !vehicleId) return;
    if (pickupTime === "scheduled" && !slotId) return;
    setBusy(true);
    setError(null);
    try {
      const order = await api<OrderCreated>(
        "POST",
        "/v1/orders",
        {
          cart_id: cartId,
          quote_id: quoteId,
          vehicle_id: vehicleId,
          pickup_time: pickupTime,
          ...(pickupTime === "scheduled" && slotId ? { slot_id: slotId } : {})
        },
        { idempotent: true }
      );
      clearCart();
      await setLastOrderId(order.id);
      setDonePickup(pickupTime);
      setDone(order); // C-37: نجاح الإرسال
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  /* ===== C-37: نجاح الطلب — حالة ختامية ===== */
  if (done) {
    return (
      <SafeAreaView style={st.screen}>
        <View style={st.success}>
          <View style={st.bigic}>
            <Text style={{ color: colors.lime900, fontSize: fs.fs34, fontWeight: "900" }}>✓</Text>
          </View>
          <Text style={st.bigTitle}>أُرسل طلبك — بلا دفع حتى الآن</Text>
          <Card style={{ alignSelf: "stretch", gap: 8 }}>
            <View style={st.kv}>
              <Text style={st.k}>رقم الطلب</Text>
              <Text style={[st.v, { fontWeight: "800" }]}>{done.display_code}</Text>
            </View>
            <View style={st.kv}>
              <Text style={st.k}>الحالة</Text>
              <Badge
                label={donePickup === "scheduled" ? "محجوز لفترتك — ندخله للمطعم وقت الفترة" : "أُرسل للمطعم — بانتظار القبول"}
                tone="warn"
              />
            </View>
            <View style={st.kv}>
              <Text style={st.k}>الإجمالي — يُدفع بعد قبول المطعم وموافقتك</Text>
              <Text style={st.v}>{fmtSar(done.total_halalas)}</Text>
            </View>
          </Card>
          <LimeButton
            title="متابعة الطلب مباشرة"
            onPress={() => router.replace(`/track/${done.id}` as never)}
            style={{ alignSelf: "stretch", marginTop: 16 }}
          />
          <Text style={st.sandNote}>ننقلك لمتابعة الطلب الآن…</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={st.screen} edges={["top"]}>
      <View style={st.head}>
        <Pressable style={st.back} onPress={() => router.back()} accessibilityRole="button">
          <Text style={st.backTxt}>‹</Text>
        </Pressable>
        <Text style={st.title}>إتمام الطلب</Text>
        <Badge label="صفحة واحدة" tone="lime" />
      </View>

      <ScrollView contentContainerStyle={st.body}>
        {!showAdd && error && <ErrorNote text={error} />}

        {/* ===== وقت الاستلام — FR-C06: أقرب وقت / مجدول (C-28) ===== */}
        <Text style={st.section}>وقت الاستلام</Text>
        <Pressable
          style={[st.optCard, pickupTime === "asap" ? st.optSel : null]}
          onPress={() => setPickupTime("asap")}
          accessibilityRole="radio"
          accessibilityState={{ selected: pickupTime === "asap" }}
        >
          <View style={[st.rdot, pickupTime === "asap" ? st.rdotOn : null]} />
          <View style={{ flex: 1 }}>
            <Text style={st.optTitle}>أقرب وقت</Text>
            <Text style={st.optDesc}>المطعم يجهّز طلبك على وقت وصولك</Text>
          </View>
          <Badge label="موصى به" tone="lime" />
        </Pressable>
        {flags["scheduled_orders"] ? (
          <Pressable
            style={[st.optCard, pickupTime === "scheduled" ? st.optSel : null]}
            onPress={() => setPickupTime("scheduled")}
            accessibilityRole="radio"
            accessibilityState={{ selected: pickupTime === "scheduled" }}
          >
            <View style={[st.rdot, pickupTime === "scheduled" ? st.rdotOn : null]} />
            <View style={{ flex: 1 }}>
              <Text style={st.optTitle}>جدولة لوقت لاحق</Text>
              <Text style={st.optDesc}>فترات بسعة يحددها الفرع (BR-5) — الدفع يؤكد الحجز</Text>
            </View>
          </Pressable>
        ) : (
          <View style={[st.optCard, st.optDis]}>
            <View style={st.rdot} />
            <View style={{ flex: 1 }}>
              <Text style={st.optTitle}>جدولة لوقت لاحق</Text>
              <Text style={st.optDesc}>فترات بسعة يحددها الفرع (BR-5)</Text>
            </View>
            <Badge label="قريباً" tone="soft" />
          </View>
        )}

        {/* فترات BR-5 — تظهر عند اختيار الجدولة */}
        {pickupTime === "scheduled" && (
          <View style={{ gap: 8 }}>
            {!slots && !slotsError && <Loader />}
            {slotsError && <ErrorNote text={slotsError} />}
            {slots && slots.length > 0 && (
              <>
                <View style={st.slotGrid}>
                  {slots.map((s) => {
                    const on = slotId === s.id;
                    return (
                      <Pressable
                        key={s.id}
                        style={[st.slotChip, on ? st.slotChipSel : null]}
                        onPress={() => setSlotId(s.id)}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: on }}
                      >
                        <Text style={[st.slotTxt, on ? st.slotTxtSel : null]}>{slotLabel(s.slot_start)}</Text>
                        <Text style={st.slotSub}>{s.remaining} متاح</Text>
                      </Pressable>
                    );
                  })}
                </View>
                <Text style={st.privacy}>آخر تعديل أو إلغاء مجاني: قبل ساعة من الفترة (BR-5).</Text>
              </>
            )}
          </View>
        )}

        {/* ===== السيارة — شرائح + إضافة عبر Sheet (C-30 · S3) ===== */}
        <View style={st.sectionRow}>
          <Text style={st.section}>السيارة</Text>
          <Pressable onPress={() => setShowAdd(true)} accessibilityRole="button" style={{ minHeight: 32 }}>
            <Text style={st.link}>+ إضافة — حقلان (S3)</Text>
          </Pressable>
        </View>
        {!vehicles && !error && <Loader />}
        {vehicles?.map((v) => {
          const name = [v.model_ar ?? v.make_ar, v.color_ar].filter(Boolean).join(" · ");
          const on = vehicleId === v.id;
          return (
            <Pressable
              key={v.id}
              style={[st.optCard, on ? st.optSel : null]}
              onPress={() => setVehicleId(v.id)}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
            >
              <View style={[st.rdot, on ? st.rdotOn : null]} />
              <View style={{ flex: 1 }}>
                <Text style={st.optTitle}>{name || v.color_ar}</Text>
                {v.is_default && <Text style={st.optDesc}>الافتراضية</Text>}
              </View>
              <Text style={st.plate}>•••• {v.plate_short}</Text>
            </Pressable>
          );
        })}
        <Text style={st.privacy}>اللوحات مشفرة ولا تظهر كاملة إلا لموظف التسليم أثناء طلبك النشط فقط.</Text>

        {/* ===== الدفع بعد القبول (docs/05§3) — لا دفع في هذه الخطوة ===== */}
        <Text style={st.section}>الدفع</Text>
        <View style={[st.optCard, st.optSel]}>
          <View style={{ flex: 1 }}>
            <Text style={st.optTitle}>الدفع بعد قبول المطعم</Text>
            <Text style={st.optDesc}>
              المطعم يحدد وقت التجهيز المتوقع — توافق عليه ثم تدفع من صفحة المتابعة، ولا يبدأ التجهيز
              قبل دفعك
            </Text>
          </View>
          <Badge label="بلا دفع الآن" tone="lime" />
        </View>
        <Text style={st.privacy}>لا دفع نقدياً · Tokenization فقط — لا نخزن رقم بطاقتك أبداً.</Text>

        {/* ===== مراجعة الطلب (C-35) ===== */}
        {cart && cart.items.length > 0 && (
          <>
            <Text style={st.section}>مراجعة الطلب</Text>
            <Card style={{ gap: 6 }}>
              <Text style={st.itemsTitle}>المنتجات ({cart.items.length})</Text>
              {cart.items.map((i) => (
                <View key={i.id} style={st.kv}>
                  <Text style={st.k} numberOfLines={2}>
                    {i.quantity}× {i.name_ar}
                    {i.modifiers.length > 0 && ` — ${i.modifiers.map((m) => m.name_ar).join("، ")}`}
                  </Text>
                  <Text style={st.v}>{fmtSar(i.line_total_halalas)}</Text>
                </View>
              ))}
            </Card>
            {cart.quote && (
              <Card style={{ gap: 6 }}>
                <View style={st.kv}>
                  <Text style={st.k}>المجموع الفرعي</Text>
                  <Text style={st.v}>{fmtSar(cart.quote.subtotal_halalas)}</Text>
                </View>
                {cart.quote.discount_halalas > 0 && (
                  <View style={st.kv}>
                    <Text style={[st.k, { color: colors.success }]}>الخصم</Text>
                    <Text style={[st.v, { color: colors.success }]}>
                      −{fmtSar(cart.quote.discount_halalas)}
                    </Text>
                  </View>
                )}
                {/* رسم الخدمة مفصول وواضح دائماً — BR-6 */}
                <View style={st.kv}>
                  <Text style={st.k}>رسوم خدمة بيكلي</Text>
                  <Text style={st.v}>{fmtSar(cart.quote.service_fee_halalas)}</Text>
                </View>
                <View style={[st.kv, st.totRow]}>
                  <Text style={st.totK}>الإجمالي</Text>
                  <Text style={st.totV}>{fmtSar(cart.quote.total_halalas)}</Text>
                </View>
                <Text style={{ fontSize: fs.fs12, color: light.text2, textAlign: "right" }}>
                  الأسعار شاملة ضريبة القيمة المضافة
                </Text>
              </Card>
            )}
            <Text style={st.privacy}>
              سياسة الإلغاء: كل ما قبل الدفع بلا أي رسوم (لم يُدفع شيء) · بعد الدفع وبدء التحضير لا
              يُسترجع ثمن الطلب · رسوم الخدمة تُسترجع وفق المصفوفة.
            </Text>
          </>
        )}

        <Text style={st.sandNote}>لا دفع في هذه الخطوة — الدفع بعد قبول المطعم وموافقتك على وقت التجهيز</Text>
      </ScrollView>

      {/* CTA الإرسال */}
      <View style={st.footbar}>
        <LimeButton
          title={busy ? "جارٍ الإرسال…" : "أرسل الطلب — الدفع بعد القبول"}
          trailing={!busy && total != null ? fmtSar(total) : undefined}
          disabled={busy || !vehicleId || !cartId || (pickupTime === "scheduled" && !slotId)}
          onPress={() => void submitOrder()}
        />
      </View>

      {/* Sheet إضافة سيارة (C-30 · S3: حقلان) */}
      <Modal visible={showAdd} transparent animationType="slide" onRequestClose={() => setShowAdd(false)}>
        <View style={st.dim}>
          <Pressable style={{ flex: 1 }} onPress={() => setShowAdd(false)} />
          <View style={st.sheet}>
            <View style={st.grab} />
            <Text style={st.sheetTitle}>إضافة سيارة</Text>
            {error && <ErrorNote text={error} />}
            <Text style={st.label}>اللون *</Text>
            <TextInput
              style={st.inp}
              placeholder="مثال: بيضاء"
              placeholderTextColor={colors.gray}
              value={color}
              onChangeText={setColor}
            />
            <Text style={st.label}>آخر 4 أرقام اللوحة *</Text>
            <TextInput
              style={[st.inp, { textAlign: "center", letterSpacing: 6, fontVariant: ["tabular-nums"] }]}
              keyboardType="number-pad"
              maxLength={4}
              placeholder="0000"
              placeholderTextColor={colors.gray}
              value={plate}
              onChangeText={(v) => setPlate(v.replace(/\D/g, "").slice(0, 4))}
            />
            <Text style={st.privacy}>خصوصيتك: اللوحة تُشفَّر ولا تُعرض كاملة أبداً خارج طلبك التشغيلي.</Text>
            <LimeButton
              title="حفظ السيارة"
              disabled={busy || color.length < 2 || plate.length < 1}
              onPress={() => void addVehicle()}
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
  head: { flexDirection: "row-reverse", alignItems: "center", gap: 8, padding: 16, paddingBottom: 8 },
  back: { width: touch, height: touch, alignItems: "center", justifyContent: "center" },
  backTxt: { color: light.text, fontSize: fs.fs24, fontWeight: "800" },
  title: { color: light.text, fontSize: fs.fs20, fontWeight: "900", flex: 1, textAlign: "right" },
  body: { padding: 16, gap: 8, paddingBottom: 110 },
  section: {
    color: light.text,
    fontSize: fs.fs17,
    fontWeight: "900",
    textAlign: "right",
    marginTop: 12,
    marginBottom: 2
  },
  sectionRow: {
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 12
  },
  link: { color: colors.lime900, fontSize: fs.fs13, fontWeight: "700" },
  optCard: {
    backgroundColor: light.surface,
    borderWidth: 1,
    borderColor: light.border,
    borderRadius: radius,
    padding: 12,
    minHeight: touch,
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 10
  },
  optSel: { borderColor: colors.lime500, backgroundColor: colors.lime100 },
  optDis: { opacity: 0.55 },
  optTitle: { color: light.text, fontSize: fs.fs15, fontWeight: "800", textAlign: "right" },
  optDesc: { color: light.text2, fontSize: fs.fs12, textAlign: "right", marginTop: 2 },
  rdot: {
    width: 20,
    height: 20,
    borderRadius: radiusPill,
    borderWidth: 2,
    borderColor: light.border
  },
  rdotOn: { borderColor: colors.lime900, backgroundColor: colors.lime500 },
  /* فترات BR-5 */
  slotGrid: { flexDirection: "row-reverse", flexWrap: "wrap", gap: 8 },
  slotChip: {
    alignItems: "center",
    gap: 2,
    backgroundColor: light.surface,
    borderWidth: 1.5,
    borderColor: light.border,
    borderRadius: 12,
    paddingVertical: 9,
    paddingHorizontal: 12,
    minWidth: 104
  },
  slotChipSel: { borderColor: colors.lime900, backgroundColor: colors.lime100 },
  slotTxt: { color: light.text, fontSize: fs.fs13, textAlign: "center" },
  slotTxtSel: { fontWeight: "800" },
  slotSub: { color: light.text2, fontSize: fs.fs12 },
  plate: { color: light.text, fontSize: fs.fs15, fontWeight: "800", fontVariant: ["tabular-nums"] },
  privacy: { color: light.text2, fontSize: fs.fs12, textAlign: "right", lineHeight: 18 },
  itemsTitle: { color: light.text, fontSize: fs.fs15, fontWeight: "900", textAlign: "right" },
  kv: { flexDirection: "row-reverse", justifyContent: "space-between", gap: 8 },
  k: { color: light.text2, fontSize: fs.fs14, flexShrink: 1, textAlign: "right" },
  v: { color: light.text, fontSize: fs.fs14, fontVariant: ["tabular-nums"] },
  totRow: { borderTopWidth: 1, borderTopColor: light.border, paddingTop: 8 },
  totK: { color: light.text, fontSize: fs.fs16, fontWeight: "900" },
  totV: { color: light.text, fontSize: fs.fs16, fontWeight: "900", fontVariant: ["tabular-nums"] },
  sandNote: { color: light.text2, fontSize: fs.fs12, textAlign: "center", marginTop: 8 },
  footbar: { position: "absolute", bottom: 16, left: 16, right: 16, ...shadow2 },
  success: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 12 },
  bigic: {
    width: 84,
    height: 84,
    borderRadius: radiusPill,
    backgroundColor: colors.lime100,
    alignItems: "center",
    justifyContent: "center"
  },
  bigTitle: { color: light.text, fontSize: fs.fs24, fontWeight: "900" },
  dim: { flex: 1, backgroundColor: "rgba(16,36,27,0.55)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: light.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 16,
    paddingBottom: 28,
    gap: 6
  },
  grab: {
    width: 44,
    height: 4,
    borderRadius: radiusPill,
    backgroundColor: light.border,
    alignSelf: "center",
    marginBottom: 8
  },
  sheetTitle: { color: light.text, fontSize: fs.fs20, fontWeight: "900", textAlign: "right", marginBottom: 6 },
  label: { color: light.text, fontSize: fs.fs14, fontWeight: "700", textAlign: "right", marginTop: 4 },
  inp: {
    minHeight: touch + 4,
    backgroundColor: light.bg,
    borderWidth: 1,
    borderColor: light.border,
    borderRadius: radius,
    paddingHorizontal: 12,
    fontSize: fs.fs16,
    color: light.text,
    textAlign: "right"
  }
});
