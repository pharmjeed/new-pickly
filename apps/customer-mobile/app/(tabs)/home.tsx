/**
 * P3 · C-09: الرئيسية — الفروع القريبة عبر GET /v1/branches/nearby
 * + بحث C-11/C-12 عبر GET /v1/search (مطاعم ومنتجات).
 * الموقع عبر expo-location مع سقوط للرياض 24.7/46.68 (الموقع تحسين لا شرط — docs/14§8).
 */
import { useEffect, useRef, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import * as Location from "expo-location";
import { api, fmtSar } from "../../src/api";
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

interface SearchResults {
  branches: BranchCard[];
  products: Array<{
    id: string;
    branch_id: string;
    brand_name_ar: string;
    name_ar: string;
    price_halalas: number;
  }>;
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
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResults | null>(null);
  const coordsRef = useRef(RIYADH);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = async () => {
    setError(null);
    try {
      const c = await currentCoords();
      setLocLabel(c.label);
      coordsRef.current = { lat: c.lat, lng: c.lng };
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

  // بحث C-11 بتهدئة 300ms — النتائج من الخادم حصراً
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const term = q.trim();
    if (term.length < 2) {
      setResults(null);
      return;
    }
    searchTimer.current = setTimeout(() => {
      const { lat, lng } = coordsRef.current;
      api<SearchResults>("GET", `/v1/search?q=${encodeURIComponent(term)}&lat=${lat}&lng=${lng}`)
        .then(setResults)
        .catch(() => setResults(null));
    }, 300);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [q]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  return (
    <SafeAreaView style={st.screen} edges={["top"]}>
      {/* رأس الرئيسية: موقع الاستلام + بحث C-11 */}
      <View style={st.head}>
        <Text style={st.locLb}>الاستلام قرب</Text>
        <Text style={st.locVal}>{locLabel}</Text>
        <View style={st.search}>
          <TextInput
            style={st.searchInp}
            placeholder="ابحث عن مطعم، منتج، تصنيف…"
            placeholderTextColor={light.text2}
            value={q}
            onChangeText={setQ}
            returnKeyType="search"
          />
          {q.length > 0 && (
            <Pressable onPress={() => setQ("")} accessibilityRole="button" style={{ padding: 6 }}>
              <Text style={{ color: light.text2, fontSize: fs.fs14 }}>✕</Text>
            </Pressable>
          )}
        </View>
      </View>

      {/* نتائج البحث C-12 — تحل محل القائمة أثناء البحث */}
      {results && (
        <FlatList
          data={[
            ...results.branches.map((b) => ({ kind: "branch" as const, b })),
            ...results.products.map((p) => ({ kind: "product" as const, p }))
          ]}
          keyExtractor={(item) => (item.kind === "branch" ? `b-${item.b.id}` : `p-${item.p.id}`)}
          contentContainerStyle={st.list}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <View style={st.empty}>
              <Text style={st.emptyTitle}>لا نتائج لـ«{q.trim()}»</Text>
              <Text style={st.emptyTxt}>جرّب كلمة أخرى</Text>
            </View>
          }
          renderItem={({ item }) =>
            item.kind === "branch" ? (
              <Pressable
                style={st.card}
                onPress={() => router.push(`/restaurant/${item.b.id}` as never)}
                accessibilityRole="button"
              >
                <View style={st.cardTop}>
                  <Text style={st.cardName} numberOfLines={1}>
                    {item.b.brand_name_ar}
                    {item.b.address_short ? ` — ${item.b.address_short}` : ""}
                  </Text>
                  <Badge label="مطعم" tone="lime" />
                </View>
                {item.b.distance_meters !== null && (
                  <Text style={st.meta}>{(item.b.distance_meters / 1000).toFixed(1)} كم</Text>
                )}
              </Pressable>
            ) : (
              <Pressable
                style={st.card}
                onPress={() => router.push(`/restaurant/${item.p.branch_id}` as never)}
                accessibilityRole="button"
              >
                <View style={st.cardTop}>
                  <Text style={st.cardName} numberOfLines={1}>
                    {item.p.name_ar} · {item.p.brand_name_ar}
                  </Text>
                  <Text style={st.meta}>{fmtSar(item.p.price_halalas)}</Text>
                </View>
              </Pressable>
            )
          }
        />
      )}

      {error && !results && (
        <View style={{ paddingHorizontal: 16 }}>
          <ErrorNote text={error} />
        </View>
      )}
      {!branches && !error && !results && <Loader />}

      {branches && !results && (
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
    justifyContent: "space-between"
  },
  searchInp: { flex: 1, color: light.text, fontSize: fs.fs14, textAlign: "right", paddingVertical: 8 },
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
