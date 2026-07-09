/**
 * P3 · C-09: الرئيسية — الفروع القريبة عبر GET /v1/branches/nearby.
 * الموقع عبر expo-location مع سقوط للرياض 24.7/46.68 (الموقع تحسين لا شرط — docs/14§8).
 */
import { useEffect, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import * as Location from "expo-location";
import { api } from "../../src/api";
import { Badge, ErrorNote, Loader, type BadgeTone } from "../../src/ui";
import { colors, fs, light, radius, shadow1 } from "../../src/theme";

interface BranchCard {
  id: string;
  brand_name_ar: string;
  status: string;
  distance_meters: number | null;
  eta_minutes: number | null;
  address_short: string;
  busy_message: string | null;
}

const RIYADH = { lat: 24.7, lng: 46.68 };

function statusBadge(status: string): { label: string; tone: BadgeTone } {
  if (status === "open") return { label: "مفتوح", tone: "lime" };
  if (status === "busy") return { label: "ازدحام", tone: "warn" };
  return { label: "مغلق", tone: "soft" };
}

async function currentCoords(): Promise<{ lat: number; lng: number; label: string }> {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== Location.PermissionStatus.GRANTED) return { ...RIYADH, label: "الرياض" };
    const last = await Location.getLastKnownPositionAsync();
    const pos =
      last ?? (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
    return { lat: pos.coords.latitude, lng: pos.coords.longitude, label: "موقعك الحالي" };
  } catch {
    return { ...RIYADH, label: "الرياض" };
  }
}

export default function HomeScreen() {
  const [branches, setBranches] = useState<BranchCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [locLabel, setLocLabel] = useState("الرياض");
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    setError(null);
    try {
      const c = await currentCoords();
      setLocLabel(c.label);
      const list = await api<BranchCard[]>(
        "GET",
        `/v1/branches/nearby?lat=${c.lat}&lng=${c.lng}&radius=30000`
      );
      setBranches(list);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  return (
    <SafeAreaView style={st.screen} edges={["top"]}>
      {/* رأس الرئيسية: موقع الاستلام */}
      <View style={st.head}>
        <Text style={st.locLb}>الاستلام قرب</Text>
        <Text style={st.locVal}>{locLabel}</Text>
        {/* البحث مؤجل عن نطاق الطيار (docs/21§3) — شكلياً معطل */}
        <View style={st.search}>
          <Text style={st.searchTxt}>ابحث عن مطعم، منتج، تصنيف…</Text>
          <Badge label="قريباً" tone="soft" />
        </View>
      </View>

      {error && (
        <View style={{ paddingHorizontal: 16 }}>
          <ErrorNote text={error} />
        </View>
      )}
      {!branches && !error && <Loader />}

      {branches && (
        <FlatList
          data={branches}
          keyExtractor={(b) => b.id}
          contentContainerStyle={st.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />
          }
          ListHeaderComponent={<Text style={st.section}>قريبة منك</Text>}
          ListEmptyComponent={
            <View style={st.empty}>
              <Text style={st.emptyTitle}>ما فيه فروع قريبة منك الآن</Text>
              <Text style={st.emptyTxt}>بيكلي يتوسع — جرّب من موقع آخر أو عُد لاحقاً</Text>
            </View>
          }
          renderItem={({ item: b }) => {
            const badge = statusBadge(b.status);
            return (
              <Pressable
                style={({ pressed }) => [st.card, pressed ? { backgroundColor: colors.lime100 } : null]}
                onPress={() => router.push(`/restaurant/${b.id}` as never)}
                accessibilityRole="button"
              >
                <View style={st.cardTop}>
                  <Text style={st.cardName} numberOfLines={1}>
                    {b.brand_name_ar}
                    {b.address_short ? ` — ${b.address_short}` : ""}
                  </Text>
                  <Badge label={badge.label} tone={badge.tone} />
                </View>
                <View style={st.metaRow}>
                  {b.distance_meters !== null && (
                    <Text style={st.meta}>{(b.distance_meters / 1000).toFixed(1)} كم</Text>
                  )}
                  {b.eta_minutes !== null && <Text style={st.meta}>قيادة {b.eta_minutes} د</Text>}
                </View>
                <Text style={st.carLine}>يصل طلبك إلى سيارتك</Text>
                {b.busy_message && <Text style={st.busy}>{b.busy_message}</Text>}
              </Pressable>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  screen: { flex: 1, backgroundColor: light.bg },
  head: {
    backgroundColor: light.surface,
    borderBottomWidth: 1,
    borderBottomColor: light.border,
    padding: 16,
    paddingBottom: 12
  },
  locLb: { color: light.text2, fontSize: fs.fs12, textAlign: "right" },
  locVal: { color: light.text, fontSize: fs.fs17, fontWeight: "800", textAlign: "right" },
  search: {
    marginTop: 10,
    backgroundColor: light.bg,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: light.border,
    minHeight: 44,
    paddingHorizontal: 12,
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "space-between",
    opacity: 0.7
  },
  searchTxt: { color: light.text2, fontSize: fs.fs14 },
  list: { padding: 16, gap: 10, paddingBottom: 24 },
  section: { color: light.text, fontSize: fs.fs20, fontWeight: "900", textAlign: "right", marginBottom: 4 },
  empty: { alignItems: "center", paddingVertical: 48, gap: 6 },
  emptyTitle: { color: light.text, fontSize: fs.fs16, fontWeight: "800" },
  emptyTxt: { color: light.text2, fontSize: fs.fs14 },
  card: {
    backgroundColor: light.surface,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: light.border,
    padding: 14,
    gap: 6,
    ...shadow1
  },
  cardTop: { flexDirection: "row-reverse", alignItems: "center", justifyContent: "space-between", gap: 8 },
  cardName: { color: light.text, fontSize: fs.fs16, fontWeight: "800", flexShrink: 1, textAlign: "right" },
  metaRow: { flexDirection: "row-reverse", gap: 12 },
  meta: { color: light.text2, fontSize: fs.fs13 },
  carLine: { color: colors.lime900, fontSize: fs.fs13, fontWeight: "700", textAlign: "right" },
  busy: { color: colors.warn, fontSize: fs.fs13, textAlign: "right" }
});
