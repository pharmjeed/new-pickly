/**
 * حسابي — الاسم، سياراتي، تسجيل خروج.
 * GET /v1/customers/me · GET /v1/customers/me/vehicles · POST /v1/auth/logout
 */
import { useCallback, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useFocusEffect } from "expo-router";
import { api, clearTokens, getToken } from "../../src/api";
import { clearCart } from "../../src/session";
import { Badge, Card, GhostButton, LimeButton, Loader } from "../../src/ui";
import { colors, fs, light } from "../../src/theme";

interface Me {
  id: string;
  phone: string;
  full_name: string | null;
}
interface Vehicle {
  id: string;
  make_ar: string | null;
  model_ar: string | null;
  color_ar: string;
  plate_short: string;
  is_default: boolean;
}

export default function AccountScreen() {
  const [me, setMe] = useState<Me | null>(null);
  const [vehicles, setVehicles] = useState<Vehicle[] | null>(null);
  const [state, setState] = useState<"loading" | "guest" | "ready">("loading");

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      const load = async () => {
        setState("loading");
        if (!(await getToken())) {
          if (alive) setState("guest");
          return;
        }
        try {
          const [profile, vs] = await Promise.all([
            api<Me>("GET", "/v1/customers/me"),
            api<Vehicle[]>("GET", "/v1/customers/me/vehicles")
          ]);
          if (!alive) return;
          setMe(profile);
          setVehicles(vs);
          setState("ready");
        } catch {
          if (alive) setState("guest");
        }
      };
      void load();
      return () => {
        alive = false;
      };
    }, [])
  );

  const logout = async () => {
    try {
      await api("POST", "/v1/auth/logout");
    } catch {
      /* الخروج محلي على أي حال */
    }
    await clearTokens();
    clearCart();
    router.replace("/auth");
  };

  return (
    <SafeAreaView style={st.screen} edges={["top"]}>
      <Text style={st.title}>حسابي</Text>

      {state === "loading" && <Loader />}

      {state === "guest" && (
        <View style={st.guest}>
          <Text style={st.guestTxt}>سجّل دخولك لإدارة حسابك وسياراتك</Text>
          <LimeButton
            title="تسجيل الدخول"
            onPress={() => router.push("/auth")}
            style={{ alignSelf: "stretch", marginTop: 16 }}
          />
        </View>
      )}

      {state === "ready" && me && (
        <ScrollView contentContainerStyle={st.body}>
          <Card>
            <Text style={st.name}>{me.full_name ?? "بدون اسم"}</Text>
            <Text style={st.phone}>{me.phone}</Text>
          </Card>

          <Text style={st.section}>سياراتي</Text>
          {vehicles && vehicles.length === 0 && (
            <Text style={st.muted}>لا سيارات محفوظة — تُضاف أثناء إتمام الطلب (حقلان فقط)</Text>
          )}
          {vehicles?.map((v) => (
            <Card key={v.id} style={st.vehCard}>
              <View style={{ flexShrink: 1 }}>
                <Text style={st.vehName}>
                  {[v.model_ar ?? v.make_ar, v.color_ar].filter(Boolean).join(" · ") || v.color_ar}
                </Text>
                {v.is_default && <Badge label="الافتراضية" tone="lime" />}
              </View>
              <Text style={st.plate}>•••• {v.plate_short}</Text>
            </Card>
          ))}
          <Text style={st.privacy}>اللوحات مشفرة ولا تظهر كاملة إلا لموظف التسليم أثناء طلبك النشط فقط.</Text>

          <GhostButton
            title="تسجيل خروج"
            onPress={() => void logout()}
            style={{ marginTop: 20 }}
            textStyle={{ color: colors.error }}
          />
        </ScrollView>
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
  guest: { padding: 24, paddingTop: 64, alignItems: "center" },
  guestTxt: { color: light.text2, fontSize: fs.fs15, textAlign: "center" },
  body: { padding: 16, gap: 10, paddingBottom: 32 },
  name: { color: light.text, fontSize: fs.fs20, fontWeight: "900", textAlign: "right" },
  phone: {
    color: light.text2,
    fontSize: fs.fs14,
    textAlign: "right",
    marginTop: 4,
    fontVariant: ["tabular-nums"]
  },
  section: {
    color: light.text,
    fontSize: fs.fs17,
    fontWeight: "800",
    textAlign: "right",
    marginTop: 10
  },
  muted: { color: light.text2, fontSize: fs.fs14, textAlign: "right" },
  vehCard: {
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10
  },
  vehName: { color: light.text, fontSize: fs.fs15, fontWeight: "700", textAlign: "right", marginBottom: 4 },
  plate: { color: light.text, fontSize: fs.fs16, fontWeight: "800", fontVariant: ["tabular-nums"] },
  privacy: { color: light.text2, fontSize: fs.fs12, textAlign: "right", lineHeight: 18 }
});
