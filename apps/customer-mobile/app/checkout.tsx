/**
 * P5+P6: السلة والإتمام — صفحة تمرير واحدة: سلة + وقت + سيارة + دفع + فاتورة (C-26→C-37).
 * السلة C-26 مدموجة هنا (قرار المالك 2026-07-12): حذف عنصر → إعادة تسعير فورية،
 * والتسعير خادمي حصراً (BR-6) — app/cart.tsx تحوّل إلى هنا.
 * وقت الاستلام FR-C06: أقرب وقت / مجدول بفترات وسعة (BR-5).
 * الدفع C-33: بطاقة أو محفظة (Apple Pay/STC Pay) — بوابة sandbox بنفس مسار الإنتاج.
 * السيارة: بطاقة لوحة سعودية (حروف + أرقام) + إضافة/تعديل من كتالوج الماركات والموديلات
 * GET /v1/vehicle-catalog · GET/POST/PATCH/DELETE /v1/customers/me/vehicles
 * POST /v1/orders (idempotent) → payment-intent → mock-gateway pay → /track/{id}
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { api, ApiError, fmtSar } from "../src/api";
import { clearCart, getCartId, getQuoteId, setLastOrderId, setQuoteId } from "../src/session";
import { Badge, Card, ErrorNote, GhostButton, LimeButton, Loader } from "../src/ui";
import { colors, fs, light, radius, radiusPill, shadow2, touch } from "../src/theme";

/** عدّاد السعر المتحرك — يصعد بسلاسة عند كل إعادة تسعير، ويحترم «تقليل الحركة» */
function useCountUp(halalas: number): number {
  const [shown, setShown] = useState(0);
  const fromRef = useRef(0);
  useEffect(() => {
    let raf = 0;
    let cancelled = false;
    void AccessibilityInfo.isReduceMotionEnabled().then((reduce) => {
      if (cancelled) return;
      if (reduce) {
        fromRef.current = halalas;
        setShown(halalas);
        return;
      }
      const from = fromRef.current;
      const t0 = Date.now();
      const step = () => {
        const k = Math.min((Date.now() - t0) / 600, 1);
        const eased = 1 - (1 - k) ** 3;
        const v = Math.round(from + (halalas - from) * eased);
        fromRef.current = v;
        setShown(v);
        if (k < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [halalas]);
  return shown;
}

/** النبض الحي — هالة ليمونية تتمدد وتتلاشى خلف زر الدفع */
function PulseRing() {
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    let loop: Animated.CompositeAnimation | null = null;
    let cancelled = false;
    void AccessibilityInfo.isReduceMotionEnabled().then((reduce) => {
      if (reduce || cancelled) return;
      loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, { toValue: 1, duration: 1500, useNativeDriver: true }),
          Animated.timing(pulse, { toValue: 0, duration: 0, useNativeDriver: true }),
          Animated.delay(700)
        ])
      );
      loop.start();
    });
    return () => {
      cancelled = true;
      loop?.stop();
    };
  }, [pulse]);
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        st.pulseRing,
        {
          opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] }),
          transform: [
            { scaleX: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.05] }) },
            { scaleY: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.35] }) }
          ]
        }
      ]}
    />
  );
}

interface Vehicle {
  id: string;
  make_ar: string | null;
  model_ar: string | null;
  color_ar: string;
  plate_short: string;
  plate_letters_ar: string | null;
  plate_digits: string;
  is_default: boolean;
}

/* كتالوج السيارات — GET /v1/vehicle-catalog (قاعدة بيانات الماركات والموديلات) */
interface CatalogModel {
  name_ar: string;
  name_en: string;
}
interface CatalogMake {
  key: string;
  name_ar: string;
  name_en: string;
  models: CatalogModel[];
}
interface VehicleCatalog {
  makes: CatalogMake[];
  colors: Array<{ name_ar: string; hex: string }>;
}

const OTHER = "أخرى";
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

/* ===== جدولة BR-5: تسميات اليوم والفترة (كما في تصميم «حدد موعد طلبك») ===== */
const pad2 = (n: number): string => String(n).padStart(2, "0");
const clock12 = (d: Date): string => `${pad2(d.getHours() % 12 || 12)}:${pad2(d.getMinutes())}`;
/** «06:30 - 07:00 م» — المدى ثم ص/م بنهاية الفترة */
const slotRangeLabel = (s: Slot): string => {
  const a = new Date(s.slot_start);
  const b = new Date(s.slot_end);
  return `${clock12(a)} - ${clock12(b)} ${b.getHours() >= 12 ? "م" : "ص"}`;
};
const dayKeyOf = (iso: string): string => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};
const dayLabelOf = (iso: string): string => {
  const d = new Date(iso);
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startThat = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((startThat - startToday) / 86400000);
  if (diff === 0) return "اليوم";
  if (diff === 1) return "غدًا";
  return d.toLocaleDateString("ar-SA", { weekday: "long" });
};

interface DayGroup {
  key: string;
  label: string;
  slots: Slot[];
}

/* عجلة اختيار (يوم/وقت): المحدد كبير أعلى القائمة والبقية تتلاشى تحته */
const WHEEL_ITEM_H = 46;
const WHEEL_H = 230;
function Wheel({
  items,
  index,
  onChange,
  style
}: {
  items: string[];
  index: number;
  onChange: (i: number) => void;
  style?: object;
}) {
  const ref = useRef<ScrollView>(null);
  const settle = (y: number) => {
    const i = Math.min(items.length - 1, Math.max(0, Math.round(y / WHEEL_ITEM_H)));
    if (i !== index) onChange(i);
  };
  return (
    <ScrollView
      ref={ref}
      style={[st.wheel, style]}
      contentContainerStyle={{ paddingBottom: WHEEL_H - WHEEL_ITEM_H }}
      showsVerticalScrollIndicator={false}
      snapToInterval={WHEEL_ITEM_H}
      decelerationRate="fast"
      contentOffset={{ x: 0, y: index * WHEEL_ITEM_H }}
      onMomentumScrollEnd={(e) => settle(e.nativeEvent.contentOffset.y)}
      onScrollEndDrag={(e) => settle(e.nativeEvent.contentOffset.y)}
      nestedScrollEnabled
    >
      {items.map((t, i) => {
        const d = Math.min(Math.abs(i - index), 3);
        return (
          <Pressable
            key={i}
            style={st.wItem}
            onPress={() => {
              onChange(i);
              ref.current?.scrollTo({ y: i * WHEEL_ITEM_H, animated: true });
            }}
            accessibilityRole="button"
            accessibilityState={{ selected: i === index }}
          >
            <Text style={[st.wTxt, d === 0 ? st.w0 : d === 1 ? st.w1 : d === 2 ? st.w2 : st.w3]}>{t}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

export default function CheckoutScreen() {
  const [vehicles, setVehicles] = useState<Vehicle[] | null>(null);
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<VehicleCatalog | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [makeSel, setMakeSel] = useState<string | null>(null); // name_ar من الكتالوج أو «أخرى»
  const [makeCustom, setMakeCustom] = useState("");
  const [modelSel, setModelSel] = useState<string | null>(null);
  const [modelCustom, setModelCustom] = useState("");
  const [color, setColor] = useState("");
  const [letters, setLetters] = useState(""); // حروف اللوحة بلا مسافات (حتى 3)
  const [plate, setPlate] = useState(""); // أرقام اللوحة (حتى 4)
  const [picker, setPicker] = useState<"make" | "model" | "color" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cart, setCart] = useState<Cart | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyItem, setBusyItem] = useState<string | null>(null);
  const [done, setDone] = useState<OrderCreated | null>(null);
  const [donePickup, setDonePickup] = useState<PickupTime>("asap");
  const [flags, setFlags] = useState<Record<string, boolean>>({});
  const [pickupTime, setPickupTime] = useState<PickupTime>("asap");
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [slotId, setSlotId] = useState<string | null>(null);
  const [slotsError, setSlotsError] = useState<string | null>(null);
  const [showSched, setShowSched] = useState(false);
  const [dayIdx, setDayIdx] = useState(0);
  const [timeIdx, setTimeIdx] = useState(0);
  const [payMethod, setPayMethod] = useState<"card" | "wallet">("card");

  const cartId = getCartId();
  const quoteId = cart?.quote?.quote_id ?? getQuoteId();
  const total = cart?.quote?.total_halalas ?? null;
  const shownTotal = useCountUp(total ?? 0);

  useEffect(() => {
    api<Record<string, boolean>>("GET", "/v1/feature-flags")
      .then(setFlags)
      .catch(() => undefined); // الأعلام ميزة تكيف — الافتراضي إخفاء المؤجل
    // كتالوج الماركات والموديلات — يغذي قوائم «أضف سيارة جديدة»
    api<VehicleCatalog>("GET", "/v1/vehicle-catalog")
      .then(setCatalog)
      .catch(() => undefined); // بلا كتالوج تبقى الإضافة بالكتابة الحرة
  }, []);

  // BR-5: فترات الفرع تُجلب عند اختيار الجدولة
  useEffect(() => {
    if (pickupTime !== "scheduled" || !cart) return;
    setSlots(null);
    setSlotsError(null);
    api<Slot[]>("GET", `/v1/branches/${cart.branch_id}/slots`)
      .then((s) => {
        setSlots(s);
        setDayIdx(0);
        setTimeIdx(0);
        if (s.length === 0) setSlotsError("لا فترات متاحة حالياً — جرّب لاحقاً أو اختر أقرب وقت");
      })
      .catch((e: Error) => setSlotsError(e.message));
  }, [pickupTime, cart]);

  // فترات الأيام مجمعة لعجلتي «اليوم/الوقت»
  const dayGroups = useMemo<DayGroup[]>(() => {
    const map = new Map<string, DayGroup>();
    for (const s of slots ?? []) {
      if (s.remaining <= 0) continue;
      const key = dayKeyOf(s.slot_start);
      const g = map.get(key) ?? { key, label: dayLabelOf(s.slot_start), slots: [] };
      g.slots.push(s);
      map.set(key, g);
    }
    return [...map.values()];
  }, [slots]);

  const chosenSlot = useMemo(
    () => (slotId ? (slots ?? []).find((s) => s.id === slotId) ?? null : null),
    [slots, slotId]
  );

  /** فتح ورقة «حدد موعد طلبك» — لو سبق الاختيار نُعيد العجلتين لموضعه */
  const openSched = () => {
    setPickupTime("scheduled");
    if (chosenSlot) {
      const di = dayGroups.findIndex((g) => g.key === dayKeyOf(chosenSlot.slot_start));
      if (di >= 0) {
        setDayIdx(di);
        const ti = dayGroups[di].slots.findIndex((s) => s.id === chosenSlot.id);
        setTimeIdx(ti >= 0 ? ti : 0);
      }
    }
    setShowSched(true);
  };

  /** إغلاق بلا حفظ: بلا فترة مختارة نرجع لأقرب وقت حتى لا يعلق الإرسال */
  const closeSched = () => {
    setShowSched(false);
    if (!slotId) setPickupTime("asap");
  };

  const saveSched = () => {
    const s = dayGroups[dayIdx]?.slots[timeIdx];
    if (!s) return;
    setSlotId(s.id);
    setShowSched(false);
  };

  const applyQuoted = useCallback((c: Cart) => {
    setCart(c);
    if (c.quote) setQuoteId(c.quote.quote_id);
  }, []);

  useEffect(() => {
    api<Vehicle[]>("GET", "/v1/customers/me/vehicles")
      .then((vs) => {
        setVehicles(vs);
        const def = vs.find((v) => v.is_default) ?? vs[0];
        if (def) setVehicleId(def.id);
        else setShowAdd(true); // بلا سيارات؟ الإضافة تظهر مباشرة
      })
      .catch((e: Error) => setError(e.message));
    if (!cartId) {
      setLoading(false);
      return;
    }
    // تسعير خادمي فور فتح الصفحة — BR-6
    api<Cart>("POST", `/v1/carts/${cartId}/quote`)
      .then(applyQuoted)
      .catch(async (e: Error) => {
        // سلة بلا عناصر: التسعير يرفض — نعرض الحالة الفارغة بدل الخطأ
        if (e instanceof ApiError) {
          try {
            const c = await api<Cart>("GET", `/v1/carts/${cartId}`);
            if (c.items.length === 0) {
              setCart(c);
              return;
            }
          } catch {
            /* نُبقي رسالة الخطأ الأصلية */
          }
        }
        setError(e.message);
      })
      .finally(() => setLoading(false));
  }, [cartId, applyQuoted]);

  const removeItem = async (itemId: string) => {
    if (!cartId) return;
    setError(null);
    setBusyItem(itemId);
    try {
      // DELETE يُبطل التسعيرة السارية — ثم إعادة التسعير فوراً
      const afterDelete = await api<Cart>("DELETE", `/v1/carts/${cartId}/items/${itemId}`);
      if (afterDelete.items.length === 0) {
        setQuoteId(null);
        setCart(afterDelete);
        return;
      }
      applyQuoted(await api<Cart>("POST", `/v1/carts/${cartId}/quote`));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyItem(null);
    }
  };

  const isEmpty = !cartId || (cart !== null && cart.items.length === 0);

  // النجاح حالة ختامية — ثم ننتقل للتتبع تلقائياً
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => router.replace(`/track/${done.id}` as never), 1400);
    return () => clearTimeout(t);
  }, [done]);

  /* ===== السيارة: بطاقة اللوحة + إضافة/تعديل من الكتالوج ===== */

  const makeEnOf = (make_ar: string | null): string | null =>
    make_ar ? catalog?.makes.find((mk) => mk.name_ar === make_ar)?.name_en ?? null : null;
  const colorHexOf = (name_ar: string): string =>
    catalog?.colors.find((c) => c.name_ar === name_ar)?.hex ?? colors.gray;
  const modelsOfSel = catalog?.makes.find((mk) => mk.name_ar === makeSel)?.models ?? [];

  const effMake = makeSel === OTHER ? makeCustom.trim() : makeSel ?? "";
  const effModel = modelSel === OTHER ? modelCustom.trim() : modelSel ?? "";
  const formValid =
    color.length >= 2 && plate.length >= 1 && effMake.length >= 2 && (modelSel !== OTHER || effModel.length >= 1);

  const resetForm = () => {
    setEditId(null);
    setMakeSel(null);
    setMakeCustom("");
    setModelSel(null);
    setModelCustom("");
    setColor("");
    setLetters("");
    setPlate("");
    setPicker(null);
  };

  const openAdd = () => {
    resetForm();
    setShowAdd(true);
  };

  /** ضغط مطول على بطاقة اللوحة → تعديلها (البيانات معبأة مسبقاً) */
  const openEdit = (v: Vehicle) => {
    resetForm();
    setEditId(v.id);
    const known = catalog?.makes.some((mk) => mk.name_ar === v.make_ar);
    setMakeSel(v.make_ar ? (known ? v.make_ar : OTHER) : null);
    setMakeCustom(known ? "" : v.make_ar ?? "");
    const models = catalog?.makes.find((mk) => mk.name_ar === v.make_ar)?.models ?? [];
    const knownModel = models.some((md) => md.name_ar === v.model_ar);
    setModelSel(v.model_ar ? (knownModel ? v.model_ar : OTHER) : null);
    setModelCustom(knownModel ? "" : v.model_ar ?? "");
    setColor(v.color_ar);
    setLetters((v.plate_letters_ar ?? "").replace(/\s/g, ""));
    setPlate(v.plate_digits);
    setShowAdd(true);
  };

  const saveVehicle = async () => {
    setBusy(true);
    setError(null);
    try {
      const payload = {
        make_ar: effMake || undefined,
        model_ar: effModel || undefined,
        color_ar: color,
        plate_digits: plate,
        plate_letters_ar: letters || undefined
      };
      if (editId) {
        const v = await api<Vehicle>("PATCH", `/v1/customers/me/vehicles/${editId}`, payload);
        setVehicles((vs) => (vs ?? []).map((x) => (x.id === v.id ? v : x)));
      } else {
        const v = await api<Vehicle>("POST", "/v1/customers/me/vehicles", payload);
        setVehicles((vs) => [...(vs ?? []), v]);
        setVehicleId(v.id);
      }
      setShowAdd(false);
      resetForm();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const deleteVehicle = async () => {
    if (!editId) return;
    setBusy(true);
    setError(null);
    try {
      await api("DELETE", `/v1/customers/me/vehicles/${editId}`);
      const rest = (vehicles ?? []).filter((v) => v.id !== editId);
      setVehicles(rest);
      if (vehicleId === editId) setVehicleId(rest[0]?.id ?? null);
      setShowAdd(false);
      resetForm();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const payAndOrder = async () => {
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
      await api("POST", `/v1/orders/${order.id}/payment-intent`, { method: payMethod }, { idempotent: true });
      // بوابة sandbox — نفس مسار الإنتاج: النتيجة عبر webhook موقع
      const pay = await api<{ gateway_result: string }>(
        "POST",
        `/v1/dev/mock-gateway/by-order/${order.id}/pay`
      );
      if (pay.gateway_result !== "authorized") {
        setError("ما تمّ الدفع. جرّب بطاقة ثانية — طلبك محفوظ");
        return;
      }
      clearCart();
      await setLastOrderId(order.id);
      setDonePickup(pickupTime);
      setDone(order); // C-37: نجاح الطلب
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
          <Text style={st.bigTitle}>تم إنشاء طلبك</Text>
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
              <Text style={st.k}>القيمة المدفوعة</Text>
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
        <Text style={st.title}>السلة والإتمام</Text>
        <Badge label="صفحة واحدة" tone="lime" />
      </View>

      <ScrollView contentContainerStyle={st.body}>
        {!showAdd && error && <ErrorNote text={error} />}
        {loading && <Loader />}

        {/* ===== الحالة الفارغة — السلة بلا عناصر (C-26) ===== */}
        {!loading && isEmpty && !error && (
          <View style={st.empty}>
            <Text style={st.emptyTitle}>سلتك فاضية</Text>
            <Text style={st.emptyTxt}>لا طلبات حالية — اطلب من متجرك المفضل وخلّنا على السيارة</Text>
            <GhostButton
              title="تصفح المطاعم"
              onPress={() => router.replace("/(tabs)/home")}
              style={{ alignSelf: "stretch", marginTop: 16 }}
            />
          </View>
        )}

        {!isEmpty && cart && (
          <>
        {/* ===== السلة (C-26): العناصر أول ما ينزل عليه العميل ===== */}
        <Text style={st.section}>سلتك</Text>
        {cart.items.map((i) => (
          <Card key={i.id} style={{ gap: 4 }}>
            <Text style={st.itemName}>{i.name_ar}</Text>
            {i.modifiers.length > 0 && (
              <Text style={st.itemMods}>{i.modifiers.map((m) => m.name_ar).join(" · ")}</Text>
            )}
            <View style={st.itemRow}>
              <Text style={st.itemQty}>× {i.quantity}</Text>
              <Text style={st.itemPrice}>{fmtSar(i.line_total_halalas)}</Text>
            </View>
            <Pressable
              style={st.del}
              disabled={busyItem !== null}
              onPress={() => void removeItem(i.id)}
              accessibilityRole="button"
            >
              <Text style={st.delTxt}>حذف</Text>
            </Pressable>
          </Card>
        ))}
        <GhostButton
          title="+ إضافة منتجات أخرى"
          onPress={() => router.push(`/restaurant/${cart.branch_id}` as never)}
        />

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
            onPress={openSched}
            accessibilityRole="radio"
            accessibilityState={{ selected: pickupTime === "scheduled" }}
          >
            <View style={[st.rdot, pickupTime === "scheduled" ? st.rdotOn : null]} />
            <View style={{ flex: 1 }}>
              <Text style={st.optTitle}>جدولة لوقت لاحق</Text>
              <Text style={st.optDesc}>
                {pickupTime === "scheduled" && chosenSlot
                  ? `${dayLabelOf(chosenSlot.slot_start)} ${slotRangeLabel(chosenSlot)} — اضغط للتغيير`
                  : "فترات بسعة يحددها الفرع (BR-5) — الدفع يؤكد الحجز"}
              </Text>
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

        {/* خطأ الفترات (BR-5) — يظهر تحت الخيار لو تعذر الجلب أو لا فترات */}
        {pickupTime === "scheduled" && slotsError && <ErrorNote text={slotsError} />}

        {/* ===== طريقة الاستلام — السيارة فقط ضمن النطاق (بقية الطرق معروضة مشطوبة) ===== */}
        <Text style={st.section}>طريقة الاستلام</Text>
        <View style={st.pmRow}>
          <View style={[st.pmChip, st.pmChipOn]}>
            <Text style={st.pmCar}>🚘</Text>
            <Text style={st.pmTxtOn}>السيارة</Text>
          </View>
          <View style={[st.pmChip, st.pmChipOff]}>
            <Text style={st.pmTxtOff}>من المتجر</Text>
            <View style={st.pmSlash} />
          </View>
          <View style={[st.pmChip, st.pmChipOff]}>
            <Text style={st.pmTxtOff}>في المحل</Text>
            <View style={st.pmSlash} />
          </View>
        </View>

        {/* بطاقات اللوحة السعودية: اختيار بالضغط · تعديل بالضغط المطول · ⊕ للإضافة */}
        {!vehicles && !error && <Loader />}
        <View style={st.vRow}>
          {vehicles?.map((v) => {
            const on = vehicleId === v.id;
            const makeEn = makeEnOf(v.make_ar);
            return (
              <Pressable
                key={v.id}
                style={[st.pWrap, on ? st.pWrapOn : null]}
                onPress={() => setVehicleId(v.id)}
                onLongPress={() => openEdit(v)}
                delayLongPress={420}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                accessibilityHint="اضغط مطولاً للتعديل"
              >
                <View style={st.pCard}>
                  <View style={st.pBand}>
                    <Text style={st.pBandPalm}>🌴</Text>
                    <Text style={st.pBandAr}>السعودية</Text>
                    <Text style={st.pBandEn}>K{"\n"}S{"\n"}A</Text>
                    <Text style={st.pBandDot}>●</Text>
                  </View>
                  <View style={st.pMain}>
                    <View style={st.pTop}>
                      {v.plate_letters_ar ? <Text style={st.pLetters}>{v.plate_letters_ar}</Text> : null}
                      <Text style={st.pDigits}>{v.plate_digits}</Text>
                    </View>
                    <View style={st.pBottom}>
                      {makeEn ? (
                        <View style={st.pBrand}>
                          <Text style={st.pBrandTxt}>{makeEn}</Text>
                        </View>
                      ) : null}
                      {v.model_ar || v.make_ar ? (
                        <Text style={st.pModel} numberOfLines={1}>
                          {v.model_ar ?? v.make_ar}
                        </Text>
                      ) : null}
                      <View style={st.pColor}>
                        <View style={[st.pColorDot, { backgroundColor: colorHexOf(v.color_ar) }]} />
                        <Text style={st.pColorTxt}>{v.color_ar}</Text>
                      </View>
                    </View>
                  </View>
                </View>
              </Pressable>
            );
          })}
          <Pressable style={st.vAdd} onPress={openAdd} accessibilityRole="button" accessibilityLabel="أضف سيارة جديدة">
            <Text style={st.vAddTxt}>+</Text>
          </Pressable>
        </View>
        {vehicles && vehicles.length > 0 && (
          <View style={st.hintWrap}>
            <View style={st.hintBar} />
            <Text style={st.hintTxt}>اضغط مطولاً للتعديل</Text>
          </View>
        )}
        <Text style={st.privacy}>اللوحات مشفرة ولا تظهر كاملة إلا لموظف التسليم أثناء طلبك النشط فقط.</Text>

        {/* ===== الدفع — C-33: بطاقة أو محفظة (بوابة sandbox بنفس مسار الإنتاج) ===== */}
        <Text style={st.section}>الدفع</Text>
        <Pressable
          style={[st.optCard, payMethod === "card" ? st.optSel : null]}
          onPress={() => setPayMethod("card")}
          accessibilityRole="radio"
          accessibilityState={{ selected: payMethod === "card" }}
        >
          <View style={[st.rdot, payMethod === "card" ? st.rdotOn : null]} />
          <View style={{ flex: 1 }}>
            <Text style={st.optTitle}>بطاقة — مدى وفيزا وماستركارد</Text>
            <Text style={st.optDesc}>نفس مسار الإنتاج — النتيجة عبر Webhook موقّع</Text>
          </View>
          <Badge label="بيئة التطوير" tone="lime" />
        </Pressable>
        {flags["wallet_payments"] ? (
          <Pressable
            style={[st.optCard, payMethod === "wallet" ? st.optSel : null]}
            onPress={() => setPayMethod("wallet")}
            accessibilityRole="radio"
            accessibilityState={{ selected: payMethod === "wallet" }}
          >
            <View style={[st.rdot, payMethod === "wallet" ? st.rdotOn : null]} />
            <View style={{ flex: 1 }}>
              <Text style={st.optTitle}>Apple Pay / STC Pay</Text>
              <Text style={st.optDesc}>محافظ عبر بوابة الدفع — Tokenization فقط</Text>
            </View>
          </Pressable>
        ) : (
          <View style={[st.optCard, st.optDis]}>
            <View style={st.rdot} />
            <View style={{ flex: 1 }}>
              <Text style={st.optTitle}>Apple Pay / STC Pay</Text>
              <Text style={st.optDesc}>محافظ عبر بوابة الدفع</Text>
            </View>
            <Badge label="قريباً" tone="soft" />
          </View>
        )}
        <Text style={st.privacy}>لا دفع نقدياً في الإصدار الحالي · Tokenization فقط — لا نخزن رقم بطاقتك أبداً.</Text>

        {/* ===== ملخص الفاتورة (C-35) — العناصر نفسها معروضة أعلى الصفحة ===== */}
        {cart.items.length > 0 && (
          <>
            <Text style={st.section}>ملخص الفاتورة</Text>
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
                  <Text style={st.k}>رسم خدمة بيكلي</Text>
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
              سياسة الإلغاء: مجاني قبل قبول الفرع · بعد بدء التحضير لا يُسترجع ثمن الطلب · رسوم الخدمة
              تُسترجع وفق المصفوفة.
            </Text>
          </>
        )}

        <Text style={st.sandNote}>دفع تجريبي آمن (sandbox) — لا بطاقة حقيقية في بيئة التطوير</Text>
          </>
        )}
      </ScrollView>

      {/* CTA الدفع — الزر الحيوي المدموم من السلة: نبض + سعر متحرك + سيارة بيكلي */}
      {!isEmpty && (
        <View style={st.footbar}>
          <PulseRing />
          <LimeButton
            title={busy ? "جارٍ الدفع…" : "ادفع الآن"}
            arrow
            car
            trailing={!busy && total != null ? fmtSar(shownTotal) : undefined}
            disabled={busy || !vehicleId || !cartId || (pickupTime === "scheduled" && !slotId)}
            onPress={() => void payAndOrder()}
          />
        </View>
      )}

      {/* Sheet الجدولة — «حدد موعد طلبك»: عجلتا يوم/وقت (BR-5) */}
      <Modal visible={showSched} transparent animationType="slide" onRequestClose={closeSched}>
        <View style={st.dim}>
          <Pressable style={{ flex: 1 }} onPress={closeSched} />
          <View style={st.sheet}>
            <View style={st.grab} />
            <View style={st.schedHead}>
              <Text style={st.sheetTitle}>حدد موعد طلبك</Text>
              <Pressable style={st.schedClose} onPress={closeSched} accessibilityRole="button" accessibilityLabel="إغلاق">
                <Text style={st.schedCloseTxt}>✕</Text>
              </Pressable>
            </View>
            {!slots && !slotsError && <Loader />}
            {slotsError && <ErrorNote text={slotsError} />}
            {dayGroups.length > 0 && (
              <>
                <View style={st.wheels}>
                  <View style={st.selLine} pointerEvents="none" />
                  <Wheel
                    items={dayGroups.map((g) => g.label)}
                    index={dayIdx}
                    onChange={(i) => {
                      setDayIdx(i);
                      setTimeIdx(0);
                    }}
                    style={st.wheelDay}
                  />
                  <Wheel
                    key={dayGroups[dayIdx]?.key ?? "d0"}
                    items={(dayGroups[dayIdx] ?? dayGroups[0]).slots.map(slotRangeLabel)}
                    index={timeIdx}
                    onChange={setTimeIdx}
                    style={st.wheelTime}
                  />
                </View>
                <Text style={st.privacy}>آخر تعديل أو إلغاء مجاني: قبل ساعة من الفترة (BR-5).</Text>
                <LimeButton title="حفظ" onPress={saveSched} style={{ marginTop: 10 }} />
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* Sheet «أضف سيارة جديدة» — قوائم من كتالوج السيارات + لوحة (حروف + أرقام) */}
      <Modal visible={showAdd && !isEmpty} transparent animationType="slide" onRequestClose={() => setShowAdd(false)}>
        <View style={st.dim}>
          <Pressable style={{ flex: 1 }} onPress={() => setShowAdd(false)} />
          <View style={st.sheet}>
            <View style={st.grab} />
            <View style={st.schedHead}>
              <Text style={st.sheetTitle}>{editId ? "تعديل السيارة" : "أضف سيارة جديدة"}</Text>
              <Pressable
                style={st.schedClose}
                onPress={() => setShowAdd(false)}
                accessibilityRole="button"
                accessibilityLabel="إغلاق"
              >
                <Text style={st.schedCloseTxt}>✕</Text>
              </Pressable>
            </View>
            {error && <ErrorNote text={error} />}

            {/* ماركة السيارة */}
            <Pressable style={st.sel} onPress={() => setPicker("make")} accessibilityRole="button">
              <Text style={[st.selTxt, !makeSel && st.selPh]}>{makeSel ?? "ماركة السيارة"}</Text>
              <Text style={st.selChev}>⌄</Text>
            </Pressable>
            {makeSel === OTHER && (
              <TextInput
                style={st.inp}
                placeholder="اكتب الماركة"
                placeholderTextColor={colors.gray}
                value={makeCustom}
                onChangeText={setMakeCustom}
              />
            )}

            {/* رقم لوحة السيارة: حروف + أرقام */}
            <View style={st.plateRow}>
              <TextInput
                style={[st.inp, st.plateInp, { flexGrow: 1.2 }]}
                placeholder="أرقام اللوحة"
                placeholderTextColor={colors.gray}
                keyboardType="number-pad"
                maxLength={4}
                value={plate}
                onChangeText={(t) => setPlate(t.replace(/\D/g, "").slice(0, 4))}
              />
              <TextInput
                style={[st.inp, st.plateInp]}
                placeholder="حروف اللوحة"
                placeholderTextColor={colors.gray}
                maxLength={5}
                value={letters.split("").join(" ")}
                onChangeText={(t) => setLetters(t.replace(/[^ء-ي]/g, "").slice(0, 3))}
              />
            </View>

            {/* لون السيارة */}
            <Pressable style={st.sel} onPress={() => setPicker("color")} accessibilityRole="button">
              {color ? (
                <View style={st.selColorWrap}>
                  <View style={[st.pColorDot, { backgroundColor: colorHexOf(color) }]} />
                  <Text style={st.selTxt}>{color}</Text>
                </View>
              ) : (
                <Text style={[st.selTxt, st.selPh]}>لون السيارة</Text>
              )}
              <Text style={st.selChev}>⌄</Text>
            </Pressable>

            {/* نوع السيارة (الموديل) — يعتمد على الماركة */}
            <Pressable
              style={[st.sel, !makeSel && { opacity: 0.5 }]}
              onPress={makeSel ? () => setPicker("model") : undefined}
              accessibilityRole="button"
            >
              <Text style={[st.selTxt, !modelSel && st.selPh]}>{modelSel ?? "نوع السيارة"}</Text>
              <Text style={st.selChev}>⌄</Text>
            </Pressable>
            {modelSel === OTHER && (
              <TextInput
                style={st.inp}
                placeholder="اكتب نوع السيارة"
                placeholderTextColor={colors.gray}
                value={modelCustom}
                onChangeText={setModelCustom}
              />
            )}

            {/* البلد — KSA ثابتة */}
            <View style={[st.sel, { opacity: 0.6 }]}>
              <Text style={st.selTxt}>KSA — السعودية</Text>
            </View>

            <Text style={st.privacy}>خصوصيتك: اللوحة تُشفَّر ولا تُعرض كاملة أبداً خارج طلبك التشغيلي.</Text>
            <LimeButton
              title={busy ? "جارٍ الحفظ…" : "حفظ"}
              disabled={busy || !formValid}
              onPress={() => void saveVehicle()}
              style={{ marginTop: 10 }}
            />
            {editId && (
              <Pressable style={st.delVeh} disabled={busy} onPress={() => void deleteVehicle()} accessibilityRole="button">
                <Text style={st.delVehTxt}>حذف السيارة</Text>
              </Pressable>
            )}

            {/* منتقي القيم — طبقة فوق الورقة */}
            {picker && (
              <View style={st.pickWrap}>
                <Pressable style={st.pickDim} onPress={() => setPicker(null)} />
                <View style={st.pickSheet}>
                  <Text style={st.pickTitle}>
                    {picker === "make" ? "ماركة السيارة" : picker === "model" ? "نوع السيارة" : "لون السيارة"}
                  </Text>
                  <ScrollView style={{ maxHeight: 320 }}>
                    {picker === "color"
                      ? (catalog?.colors ?? []).map((c) => (
                          <Pressable
                            key={c.name_ar}
                            style={st.pickItem}
                            onPress={() => {
                              setColor(c.name_ar);
                              setPicker(null);
                            }}
                          >
                            <View style={[st.pColorDot, { backgroundColor: c.hex }]} />
                            <Text style={st.pickItemTxt}>{c.name_ar}</Text>
                            {color === c.name_ar && <Text style={st.pickCheck}>✓</Text>}
                          </Pressable>
                        ))
                      : [
                          ...(picker === "make"
                            ? (catalog?.makes ?? []).map((mk) => mk.name_ar)
                            : modelsOfSel.map((md) => md.name_ar)),
                          OTHER
                        ].map((name) => {
                          const cur = picker === "make" ? makeSel : modelSel;
                          return (
                            <Pressable
                              key={name}
                              style={st.pickItem}
                              onPress={() => {
                                if (picker === "make") {
                                  if (name !== makeSel) {
                                    setModelSel(null);
                                    setModelCustom("");
                                  }
                                  setMakeSel(name);
                                } else {
                                  setModelSel(name);
                                }
                                setPicker(null);
                              }}
                            >
                              <Text style={st.pickItemTxt}>{name}</Text>
                              {cur === name && <Text style={st.pickCheck}>✓</Text>}
                            </Pressable>
                          );
                        })}
                  </ScrollView>
                </View>
              </View>
            )}
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
  /* جدولة BR-5 — ورقة «حدد موعد طلبك»: عجلتا يوم/وقت */
  schedHead: { flexDirection: "row-reverse", alignItems: "center", justifyContent: "space-between" },
  schedClose: { width: touch, height: touch, alignItems: "center", justifyContent: "center" },
  schedCloseTxt: { color: colors.error, fontSize: fs.fs17, fontWeight: "800" },
  wheels: {
    position: "relative",
    flexDirection: "row-reverse",
    borderTopWidth: 1,
    borderTopColor: light.border,
    marginTop: 24
  },
  selLine: {
    position: "absolute",
    top: WHEEL_ITEM_H + 1,
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: light.border,
    opacity: 0.6
  },
  wheel: { height: WHEEL_H },
  wheelDay: { flexGrow: 0, flexShrink: 0, flexBasis: "38%" },
  wheelTime: { flex: 1 },
  wItem: { height: WHEEL_ITEM_H, alignItems: "center", justifyContent: "center" },
  wTxt: { fontWeight: "700", textAlign: "center" },
  w0: { color: light.text, fontSize: fs.fs24 },
  w1: { color: light.text2, fontSize: fs.fs20, opacity: 0.75 },
  w2: { color: light.text2, fontSize: fs.fs17, opacity: 0.5 },
  w3: { color: light.text2, fontSize: fs.fs14, opacity: 0.35 },
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
  footbar: { position: "absolute", bottom: 16, left: 16, right: 16, borderRadius: radius, ...shadow2 },
  pulseRing: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: radius,
    backgroundColor: colors.lime500
  },
  /* السلة المدمجة (C-26) */
  empty: { alignItems: "center", padding: 24, paddingTop: 64, gap: 6 },
  emptyTitle: { color: light.text, fontSize: fs.fs17, fontWeight: "800" },
  emptyTxt: { color: light.text2, fontSize: fs.fs14, textAlign: "center" },
  itemName: { color: light.text, fontSize: fs.fs15, fontWeight: "800", textAlign: "right" },
  itemMods: { color: light.text2, fontSize: fs.fs13, textAlign: "right" },
  itemRow: { flexDirection: "row-reverse", justifyContent: "space-between", alignItems: "center" },
  itemQty: { color: light.text2, fontSize: fs.fs14 },
  itemPrice: { color: light.text, fontSize: fs.fs14, fontWeight: "700", fontVariant: ["tabular-nums"] },
  del: { alignSelf: "flex-start", minHeight: 32, justifyContent: "center" },
  delTxt: { color: colors.error, fontSize: fs.fs13, fontWeight: "700" },
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
  },
  /* ===== طريقة الاستلام: شرائح (السيارة فعالة · البقية مشطوبة خارج النطاق) ===== */
  pmRow: { flexDirection: "row-reverse", gap: 8, alignItems: "center" },
  pmChip: {
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 6,
    borderRadius: radiusPill,
    paddingVertical: 8,
    paddingHorizontal: 16,
    minHeight: 40,
    overflow: "hidden"
  },
  pmChipOn: { backgroundColor: light.surface, borderWidth: 1.5, borderColor: colors.ink600 },
  pmChipOff: { backgroundColor: colors.line },
  pmCar: { fontSize: fs.fs15 },
  pmTxtOn: { color: colors.ink900, fontSize: fs.fs14, fontWeight: "800" },
  pmTxtOff: { color: colors.gray, fontSize: fs.fs14, fontWeight: "600" },
  pmSlash: {
    position: "absolute",
    left: -12,
    right: -12,
    top: "50%",
    height: 1.5,
    backgroundColor: colors.gray,
    transform: [{ rotate: "-10deg" }]
  },
  /* ===== بطاقة اللوحة السعودية ===== */
  vRow: {
    flexDirection: "row-reverse",
    flexWrap: "wrap",
    gap: 12,
    alignItems: "center",
    marginTop: 6
  },
  pWrap: {
    width: "78%",
    padding: 3,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: "transparent"
  },
  pWrapOn: { borderColor: colors.lime500, backgroundColor: colors.lime100 },
  pCard: {
    flexDirection: "row",
    backgroundColor: light.surface,
    borderWidth: 2,
    borderColor: colors.ink600,
    borderRadius: 14,
    overflow: "hidden",
    minHeight: 96
  },
  pBand: {
    width: 46,
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 6,
    borderRightWidth: 2,
    borderRightColor: colors.ink600,
    backgroundColor: light.surface
  },
  pBandPalm: { fontSize: fs.fs12 },
  pBandAr: { color: colors.ink900, fontSize: 9, fontWeight: "700" },
  pBandEn: { color: colors.ink900, fontSize: 8, fontWeight: "700", textAlign: "center", lineHeight: 9 },
  pBandDot: { color: colors.ink900, fontSize: 7 },
  pMain: { flex: 1 },
  pTop: {
    flex: 1.2,
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    borderBottomWidth: 2,
    borderBottomColor: colors.ink600,
    paddingHorizontal: 10
  },
  pLetters: { color: colors.ink900, fontSize: fs.fs24, fontWeight: "800", letterSpacing: 2 },
  pDigits: { color: colors.ink900, fontSize: fs.fs32, fontWeight: "800", fontVariant: ["tabular-nums"] },
  pBottom: {
    flex: 1,
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 8,
    paddingVertical: 6
  },
  pBrand: {
    borderWidth: 1,
    borderColor: light.border,
    borderRadius: radiusPill,
    paddingHorizontal: 8,
    paddingVertical: 2,
    backgroundColor: light.bg
  },
  pBrandTxt: { color: colors.ink900, fontSize: fs.fs12, fontWeight: "800" },
  pModel: { color: colors.ink900, fontSize: fs.fs14, fontWeight: "700", flexShrink: 1 },
  pColor: {
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 5,
    backgroundColor: colors.cloud,
    borderRadius: radiusPill,
    paddingHorizontal: 8,
    paddingVertical: 2
  },
  pColorDot: { width: 12, height: 12, borderRadius: radiusPill, borderWidth: 1, borderColor: light.border },
  pColorTxt: { color: colors.ink900, fontSize: fs.fs12, fontWeight: "700" },
  vAdd: {
    width: 56,
    height: 56,
    borderRadius: radiusPill,
    borderWidth: 1.5,
    borderColor: colors.ink600,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: light.surface
  },
  vAddTxt: { color: colors.ink600, fontSize: fs.fs24, fontWeight: "400", lineHeight: 28 },
  hintWrap: { alignItems: "center", gap: 4, marginTop: 2 },
  hintBar: { width: 18, height: 4, borderRadius: radiusPill, backgroundColor: colors.ink600 },
  hintTxt: { color: light.text2, fontSize: fs.fs13 },
  /* ===== نموذج «أضف سيارة جديدة» ===== */
  sel: {
    minHeight: touch + 4,
    backgroundColor: light.surface,
    borderWidth: 1,
    borderColor: light.border,
    borderRadius: radius + 2,
    paddingHorizontal: 14,
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8
  },
  selTxt: { color: light.text, fontSize: fs.fs15, textAlign: "right" },
  selPh: { color: colors.gray },
  selChev: { color: colors.ink600, fontSize: fs.fs17, fontWeight: "800", marginTop: -6 },
  selColorWrap: { flexDirection: "row-reverse", alignItems: "center", gap: 8 },
  plateRow: { flexDirection: "row", gap: 8 },
  plateInp: { flex: 1, textAlign: "center" },
  delVeh: { alignItems: "center", minHeight: touch, justifyContent: "center" },
  delVehTxt: { color: colors.error, fontSize: fs.fs14, fontWeight: "700" },
  pickWrap: { ...StyleSheet.absoluteFillObject, justifyContent: "flex-end" },
  pickDim: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(16,36,27,0.35)" },
  pickSheet: {
    backgroundColor: light.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 16,
    paddingBottom: 24,
    gap: 4
  },
  pickTitle: { color: light.text, fontSize: fs.fs17, fontWeight: "900", textAlign: "right", marginBottom: 6 },
  pickItem: {
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 10,
    minHeight: touch,
    borderBottomWidth: 1,
    borderBottomColor: light.border,
    paddingHorizontal: 4
  },
  pickItemTxt: { color: light.text, fontSize: fs.fs15, flex: 1, textAlign: "right" },
  pickCheck: { color: colors.lime900, fontSize: fs.fs16, fontWeight: "900" }
});
