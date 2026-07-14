/**
 * حسابي — الاسم، محفظة بيكلي (قرار المالك 2026-07-12)، سياراتي، تسجيل خروج.
 * GET /v1/customers/me · GET /v1/customers/me/wallet · GET /v1/customers/me/vehicles · POST /v1/auth/logout
 */
import { useCallback, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useFocusEffect } from "expo-router";
import { api, clearTokens, getToken } from "../../src/api";
import { fmtSar } from "../../src/api";
import { clearCart } from "../../src/session";
import { Badge, Card, GhostButton, LimeButton, Loader } from "../../src/ui";
import { QirtasBadge } from "../../src/qirtas";
import { bw2, colors, fs, light } from "../../src/theme";

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
interface WalletEntry {
  id: string;
  amount_halalas: number;
  entry_type: string;
  reference: string | null;
  created_at: string;
}
interface Wallet {
  balance_halalas: number;
  entries: WalletEntry[];
}

/** وصف قيد المحفظة بلغة العميل */
const entryLabel = (e: WalletEntry): string => {
  if (e.reference?.startsWith("order:")) return `دفع طلب ${e.reference.slice(6).split(":")[0]}`;
  if (e.reference?.startsWith("refund:")) return "استرجاع لمحفظتك";
  if (e.reference === "admin") return e.amount_halalas > 0 ? "إيداع من بيكلي" : "تسوية من بيكلي";
  return e.amount_halalas > 0 ? "إيداع" : "خصم";
};

export default function AccountScreen() {
  const [me, setMe] = useState<Me | null>(null);
  const [vehicles, setVehicles] = useState<Vehicle[] | null>(null);
  const [wallet, setWallet] = useState<Wallet | null>(null);
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
          // محفظة بيكلي — خلف علم in_app_wallet؛ فشلها لا يعطل الحساب
          api<Wallet>("GET", "/v1/customers/me/wallet")
            .then((w) => {
              if (alive) setWallet(w);
            })
            .catch(() => undefined);
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
          <View style={{ marginBottom: 14 }}>
            <QirtasBadge size={72} />
          </View>
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

          {wallet && (
            <>
              <Text style={st.section}>محفظة بيكلي</Text>
              <Card style={st.walletCard}>
                <View style={st.walletTop}>
                  <View style={st.walletIc}>
                    <Text style={{ fontSize: 20 }}>👛</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={st.walletBal}>{fmtSar(wallet.balance_halalas)}</Text>
                    <Text style={st.muted}>رصيدك — يُصرف تلقائياً عند تفعيله في الدفع</Text>
                  </View>
                </View>
                {wallet.entries.slice(0, 5).map((e) => (
                  <View key={e.id} style={st.walletEntry}>
                    <Text style={st.entryLabel}>{entryLabel(e)}</Text>
                    <Text style={[st.entryAmt, { color: e.amount_halalas > 0 ? colors.success : light.text }]}>
                      {e.amount_halalas > 0 ? "+" : "−"}
                      {fmtSar(Math.abs(e.amount_halalas))}
                    </Text>
                  </View>
                ))}
                {wallet.entries.length === 0 && (
                  <Text style={st.muted}>لا حركات بعد — الاسترجاعات والتعويضات تصلك هنا</Text>
                )}
              </Card>
            </>
          )}

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
  privacy: { color: light.text2, fontSize: fs.fs12, textAlign: "right", lineHeight: 18 },
  /* محفظة بيكلي — رصيد + آخر الحركات */
  walletCard: { gap: 10 },
  walletTop: { flexDirection: "row-reverse", alignItems: "center", gap: 10 },
  walletIc: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: colors.lime300, // المحفظة = سياق دفع — الليموني مسموح
    borderWidth: bw2,
    borderColor: colors.ink900,
    alignItems: "center",
    justifyContent: "center"
  },
  walletBal: { color: colors.blue500, fontSize: fs.fs20, fontWeight: "900", textAlign: "right" },
  walletEntry: {
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: light.border,
    paddingTop: 8
  },
  entryLabel: { color: light.text, fontSize: fs.fs13, textAlign: "right" },
  entryAmt: { fontSize: fs.fs14, fontWeight: "800", fontVariant: ["tabular-nums"] }
});
