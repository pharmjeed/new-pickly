/**
 * P3 · C-09/C-10 — قائمة المطاعم القريبة (بعد رئيسية الاستكشاف):
 * chips تصنيفات (docs/21 P3) بتصفية ?c= + بطاقات الفروع القريبة.
 */
import { useEffect, useState } from "react";
import { FlatList, Image, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import * as Location from "expo-location";
import { api } from "../src/api";
import { Badge, ErrorNote, Loader, type BadgeTone } from "../src/ui";
import { Qirtas } from "../src/qirtas";
import { bw2, colors, fs, light, popXs, radiusMd, radiusPill } from "../src/theme";

interface BranchCard {
  id: string;
  brand_name_ar: string;
  cuisine_ar: string | null;
  logo_url: string | null;
  cover_url: string | null;
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

async function currentCoords(): Promise<{ lat: number; lng: number }> {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== Location.PermissionStatus.GRANTED) return RIYADH;
    const last = await Location.getLastKnownPositionAsync();
    const pos =
      last ?? (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
    return { lat: pos.coords.latitude, lng: pos.coords.longitude };
  } catch {
    return RIYADH;
  }
}

export default function RestaurantsScreen() {
  const { c } = useLocalSearchParams<{ c?: string }>();
  const [cuisine, setCuisine] = useState<string | null>(typeof c === "string" && c ? c : null);
  const [branches, setBranches] = useState<BranchCard[] | null>(null);
  const [adminCats, setAdminCats] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    setError(null);
    try {
      const coords = await currentCoords();
      const list = await api<BranchCard[]>(
        "GET",
        `/v1/branches/nearby?lat=${coords.lat}&lng=${coords.lng}&radius=30000`
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

  // تصنيفات C-09 من السوبر أدمن — ميزة تحسين، السقوط للاشتقاق التلقائي
  useEffect(() => {
    api<Array<{ name_ar: string }>>("GET", "/v1/content/categories")
      .then((list) => setAdminCats(list.map((x) => x.name_ar)))
      .catch(() => setAdminCats([]));
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const counts = new Map<string, number>();
  for (const b of branches ?? []) {
    if (b.cuisine_ar) counts.set(b.cuisine_ar, (counts.get(b.cuisine_ar) ?? 0) + 1);
  }
  const cats: string[] =
    adminCats && adminCats.length > 0 ? adminCats : [...counts.keys()];
  const filtered = (branches ?? []).filter((b) => !cuisine || b.cuisine_ar === cuisine);

  return (
    <SafeAreaView style={st.screen} edges={["top"]}>
      <View style={st.head}>
        <Pressable onPress={() => router.back()} accessibilityRole="button" style={st.back}>
          <Text style={st.backTxt}>→</Text>
        </Pressable>
        <Text style={st.title}>{cuisine ?? "كل المطاعم"}</Text>
      </View>

      {error && (
        <View style={{ paddingHorizontal: 16 }}>
          <ErrorNote text={error} />
        </View>
      )}
      {!branches && !error && <Loader />}

      {branches && (
        <FlatList
          data={filtered}
          keyExtractor={(b) => b.id}
          contentContainerStyle={st.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />
          }
          ListHeaderComponent={
            cats.length > 0 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.chips}>
                <Pressable
                  onPress={() => setCuisine(null)}
                  accessibilityRole="button"
                  style={[st.chip, cuisine === null ? st.chipOn : null]}
                >
                  <Text style={[st.chipTxt, cuisine === null ? st.chipTxtOn : null]}>الكل</Text>
                </Pressable>
                {cats.map((name) => (
                  <Pressable
                    key={name}
                    onPress={() => setCuisine(name)}
                    accessibilityRole="button"
                    style={[st.chip, cuisine === name ? st.chipOn : null]}
                  >
                    <Text style={[st.chipTxt, cuisine === name ? st.chipTxtOn : null]}>{name}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            ) : null
          }
          ListEmptyComponent={
            <View style={st.empty}>
              <Qirtas mood="sleepy" size={84} />
              <Text style={st.emptyTitle}>ما فيه فروع قريبة منك الآن</Text>
              <Text style={st.emptyTxt}>بيكلي يتوسع — جرّب من موقع آخر أو عُد لاحقاً</Text>
            </View>
          }
          renderItem={({ item: b }) => {
            const badge = statusBadge(b.status);
            return (
              <Pressable
                style={({ pressed }) => [st.card, pressed ? { backgroundColor: colors.cloud2 } : null]}
                onPress={() => router.push(`/restaurant/${b.id}` as never)}
                accessibilityRole="button"
              >
                {(b.cover_url ?? b.logo_url) && (
                  <Image
                    source={{ uri: b.cover_url ?? b.logo_url ?? undefined }}
                    style={st.cardCover}
                    resizeMode="cover"
                  />
                )}
                <View style={st.cardTop}>
                  {b.logo_url && <Image source={{ uri: b.logo_url }} style={st.cardLogo} resizeMode="cover" />}
                  <Text style={st.cardName} numberOfLines={1}>
                    {b.brand_name_ar}
                    {b.address_short ? ` — ${b.address_short}` : ""}
                  </Text>
                  <Badge label={badge.label} tone={badge.tone} />
                </View>
                <View style={st.metaRow}>
                  {b.cuisine_ar && <Text style={st.meta}>{b.cuisine_ar}</Text>}
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
    borderBottomWidth: bw2,
    borderBottomColor: colors.ink900,
    padding: 16,
    paddingBottom: 12,
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 10
  },
  back: {
    width: 38,
    height: 38,
    borderRadius: 12,
    borderWidth: bw2,
    borderColor: colors.ink900,
    backgroundColor: light.surface,
    alignItems: "center",
    justifyContent: "center"
  },
  backTxt: { color: light.text, fontSize: fs.fs17, fontWeight: "800" },
  title: { color: light.text, fontSize: fs.fs20, fontWeight: "900", textAlign: "right" },
  list: { padding: 16, gap: 10, paddingBottom: 24 },
  chips: { flexDirection: "row-reverse", gap: 8, paddingBottom: 6 },
  chip: {
    borderWidth: bw2,
    borderColor: colors.ink900,
    backgroundColor: light.surface,
    borderRadius: radiusPill,
    paddingVertical: 7,
    paddingHorizontal: 16
  },
  chipOn: { backgroundColor: colors.blue500, borderColor: colors.ink900 },
  chipTxt: { color: light.text, fontSize: fs.fs13 },
  chipTxtOn: { color: colors.white, fontWeight: "800" },
  empty: { alignItems: "center", paddingVertical: 48, gap: 6 },
  emptyTitle: { color: light.text, fontSize: fs.fs16, fontWeight: "800" },
  emptyTxt: { color: light.text2, fontSize: fs.fs14 },
  card: {
    backgroundColor: light.surface,
    borderRadius: radiusMd,
    borderWidth: bw2,
    borderColor: colors.ink900,
    padding: 14,
    gap: 6,
    ...popXs
  },
  cardTop: { flexDirection: "row-reverse", alignItems: "center", justifyContent: "space-between", gap: 8 },
  cardCover: {
    height: 120,
    borderRadius: radiusMd - 4,
    marginBottom: 4,
    backgroundColor: light.bg
  },
  cardLogo: {
    width: 30,
    height: 30,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: colors.ink900,
    backgroundColor: light.bg
  },
  cardName: { color: light.text, fontSize: fs.fs16, fontWeight: "800", flexShrink: 1, textAlign: "right" },
  metaRow: { flexDirection: "row-reverse", gap: 12 },
  meta: { color: light.text2, fontSize: fs.fs13 },
  carLine: { color: colors.blue500, fontSize: fs.fs13, fontWeight: "700", textAlign: "right" },
  busy: { color: colors.warn, fontSize: fs.fs13, textAlign: "right" }
});
