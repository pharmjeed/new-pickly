/**
 * طلباتي — نطاق الطيار: آخر طلب (محفوظ محلياً) مع رابط التتبع.
 * لا endpoint لقائمة طلبات العميل في الشريحة الحالية.
 */
import { useCallback, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useFocusEffect } from "expo-router";
import { api, getToken } from "../../src/api";
import { getLastOrderId } from "../../src/session";
import { Badge, Card, LimeButton, Loader } from "../../src/ui";
import { fs, light } from "../../src/theme";

interface Order {
  id: string;
  display_code: string;
  order_status: string;
  brand_name_ar: string;
}

const STATUS_AR: Record<string, string> = {
  MERCHANT_PENDING: "بانتظار قبول المطعم",
  MERCHANT_ACCEPTED: "قبل المطعم طلبك",
  PREPARING: "قيد التجهيز",
  READY: "جاهز للاستلام",
  CUSTOMER_NOTIFIED: "جاهز — بانتظار انطلاقك",
  CUSTOMER_ON_THE_WAY: "أنت في الطريق",
  CUSTOMER_NEARBY: "اقتربت",
  CUSTOMER_ARRIVED: "وصلت",
  HANDOFF_IN_PROGRESS: "الموظف متجه إليك",
  COMPLETED: "تم التسليم",
  CANCELLED: "أُلغي"
};

export default function OrdersScreen() {
  const [order, setOrder] = useState<Order | null>(null);
  const [state, setState] = useState<"loading" | "empty" | "ready">("loading");

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      const load = async () => {
        setState("loading");
        const token = await getToken();
        const lastId = await getLastOrderId();
        if (!token || !lastId) {
          if (alive) setState("empty");
          return;
        }
        try {
          const o = await api<Order>("GET", `/v1/orders/${lastId}`);
          if (!alive) return;
          setOrder(o);
          setState("ready");
        } catch {
          if (alive) setState("empty");
        }
      };
      void load();
      return () => {
        alive = false;
      };
    }, [])
  );

  return (
    <SafeAreaView style={st.screen} edges={["top"]}>
      <Text style={st.title}>طلباتي</Text>

      {state === "loading" && <Loader />}

      {state === "empty" && (
        <View style={st.empty}>
          <Text style={st.emptyTitle}>لا طلبات حالية</Text>
          <Text style={st.emptyTxt}>اطلب من متجرك المفضل وخلّنا على السيارة</Text>
          <LimeButton
            title="تصفح المطاعم"
            onPress={() => router.push("/(tabs)/home")}
            style={{ alignSelf: "stretch", marginTop: 16 }}
          />
        </View>
      )}

      {state === "ready" && order && (
        <View style={{ padding: 16 }}>
          <Card>
            <View style={st.row}>
              <Text style={st.code}>{order.display_code}</Text>
              <Badge
                label={STATUS_AR[order.order_status] ?? order.order_status}
                tone={order.order_status === "COMPLETED" ? "ok" : "lime"}
              />
            </View>
            <Text style={st.brand}>{order.brand_name_ar}</Text>
          </Card>
          <LimeButton
            title="متابعة الطلب"
            onPress={() => router.push(`/track/${order.id}` as never)}
            style={{ marginTop: 12 }}
          />
        </View>
      )}
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  screen: { flex: 1, backgroundColor: light.bg },
  title: {
    color: light.text,
    fontSize: fs.fs24,
    fontWeight: "900",
    textAlign: "right",
    padding: 16,
    paddingBottom: 8
  },
  empty: { alignItems: "center", padding: 24, paddingTop: 64, gap: 6 },
  emptyTitle: { color: light.text, fontSize: fs.fs17, fontWeight: "800" },
  emptyTxt: { color: light.text2, fontSize: fs.fs14, textAlign: "center" },
  row: { flexDirection: "row-reverse", justifyContent: "space-between", alignItems: "center" },
  code: { color: light.text2, fontSize: fs.fs14, fontVariant: ["tabular-nums"] },
  brand: { color: light.text, fontSize: fs.fs17, fontWeight: "800", textAlign: "right", marginTop: 8 }
});
