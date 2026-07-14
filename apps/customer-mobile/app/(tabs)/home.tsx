/**
 * P3 · C-09: الرئيسية — الاستكشاف الموحد:
 * بحث C-11 في الأعلى ← بانرات CMS متحركة (A-13، تُدار من السوبر أدمن)
 * ← تصنيفات المطاعم (من brand.cuisine_ar) ← زر كل المطاعم (/restaurants).
 * الموقع عبر expo-location مع سقوط للرياض 24.7/46.68 (الموقع تحسين لا شرط — docs/14§8).
 */
import { useEffect, useRef, useState } from "react";
import {
  FlatList,
  ImageBackground,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import * as Location from "expo-location";
import { api, fmtSar } from "../../src/api";
import { Badge, ErrorNote, Loader } from "../../src/ui";
import { Qirtas } from "../../src/qirtas";
import { bw2, colors, fs, light, popXs, popSm, radius, radiusMd, radiusPill } from "../../src/theme";

interface BranchCard {
  id: string;
  brand_name_ar: string;
  cuisine_ar: string | null;
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

interface Banner {
  title_ar: string;
  body_ar: string | null;
  image_url: string | null;
  link: string | null;
}

const RIYADH = { lat: 24.7, lng: 46.68 };
const BANNER_MS = 4000;

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

/** بانرات CMS — تنقّل تلقائي كل 4 ثوانٍ مع نقاط تنقل يدوي */
function Banners() {
  const [banners, setBanners] = useState<Banner[] | null>(null);
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    api<Banner[]>("GET", "/v1/content/banners")
      .then(setBanners)
      .catch(() => setBanners([])); // البانرات ميزة تحسين — لا نُفشل الرئيسية
  }, []);

  useEffect(() => {
    if (!banners || banners.length < 2) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % banners.length), BANNER_MS);
    return () => clearInterval(t);
  }, [banners]);

  if (!banners || banners.length === 0) return null;
  const current = banners[Math.min(idx, banners.length - 1)];
  if (!current) return null;

  const open = () => {
    if (!current.link) return;
    if (current.link.startsWith("/")) router.push(current.link as never);
    else void Linking.openURL(current.link);
  };

  const txt = (
    <View style={st.bTxt}>
      <Text style={st.bTitle}>{current.title_ar}</Text>
      {current.body_ar ? <Text style={st.bBody}>{current.body_ar}</Text> : null}
    </View>
  );

  return (
    <View>
      <Pressable onPress={open} accessibilityRole={current.link ? "button" : undefined}>
        {current.image_url ? (
          <ImageBackground source={{ uri: current.image_url }} style={st.banner} imageStyle={{ borderRadius: radiusMd - bw2 }}>
            {txt}
          </ImageBackground>
        ) : (
          <View style={[st.banner, st.bannerFill]}>{txt}</View>
        )}
      </Pressable>
      {banners.length > 1 && (
        <View style={st.bDots}>
          {banners.map((_, i) => (
            <Pressable key={i} onPress={() => setIdx(i)} accessibilityRole="button" hitSlop={6}>
              <View style={[st.bDot, i === idx ? st.bDotOn : null]} />
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

export default function HomeScreen() {
  const [branches, setBranches] = useState<BranchCard[] | null>(null);
  const [adminCats, setAdminCats] = useState<string[] | null>(null);
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

  // تصنيفات C-09 من السوبر أدمن — ميزة تحسين، السقوط للاشتقاق التلقائي
  useEffect(() => {
    api<Array<{ name_ar: string }>>("GET", "/v1/content/categories")
      .then((c) => setAdminCats(c.map((x) => x.name_ar)))
      .catch(() => setAdminCats([]));
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

  // تصنيفات المطاعم — قائمة السوبر أدمن بترتيبها إن وُجدت، وإلا من مطابخ الفروع القريبة
  const counts = new Map<string, number>();
  for (const b of branches ?? []) {
    if (b.cuisine_ar) counts.set(b.cuisine_ar, (counts.get(b.cuisine_ar) ?? 0) + 1);
  }
  const cats: Array<{ name: string; count: number }> =
    adminCats && adminCats.length > 0
      ? adminCats.map((name) => ({ name, count: counts.get(name) ?? 0 }))
      : [...counts.entries()].map(([name, count]) => ({ name, count }));

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

      {/* نتائج البحث C-12 — تحل محل المحتوى أثناء البحث */}
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
              <Qirtas mood="sad" size={84} />
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
        <ScrollView
          contentContainerStyle={st.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />}
        >
          {/* بانرات متحركة من السوبر أدمن (A-13) */}
          <Banners />

          <Text style={st.section}>التصنيفات</Text>
          {cats.length === 0 ? (
            <View style={st.empty}>
              <Qirtas mood="sleepy" size={84} />
              <Text style={st.emptyTitle}>ما فيه مطاعم قريبة منك الآن</Text>
              <Text style={st.emptyTxt}>بيكلي يتوسع — جرّب من موقع آخر أو عُد لاحقاً</Text>
            </View>
          ) : (
            <View style={st.cats}>
              {cats.map(({ name, count }) => (
                <Pressable
                  key={name}
                  style={({ pressed }) => [st.catCard, pressed ? { backgroundColor: colors.cloud2 } : null]}
                  onPress={() => router.push(`/restaurants?c=${encodeURIComponent(name)}` as never)}
                  accessibilityRole="button"
                >
                  <Text style={st.catNm}>{name}</Text>
                  <Text style={st.catCt}>
                    {count} {count === 1 ? "مطعم" : "مطاعم"}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}

          {branches.length > 0 && (
            <Pressable
              style={st.allBtn}
              onPress={() => router.push("/restaurants" as never)}
              accessibilityRole="button"
            >
              <Text style={st.allBtnTxt}>كل المطاعم القريبة ({branches.length})</Text>
            </Pressable>
          )}
        </ScrollView>
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
    paddingBottom: 12
  },
  locLb: { color: light.text2, fontSize: fs.fs12, textAlign: "right" },
  locVal: { color: light.text, fontSize: fs.fs17, fontWeight: "800", textAlign: "right" },
  search: {
    marginTop: 10,
    backgroundColor: light.bg,
    borderRadius: radius,
    borderWidth: bw2,
    borderColor: colors.ink900,
    minHeight: 48,
    paddingHorizontal: 12,
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "space-between"
  },
  searchInp: { flex: 1, color: light.text, fontSize: fs.fs14, textAlign: "right", paddingVertical: 8 },
  list: { padding: 16, gap: 12, paddingBottom: 24 },
  section: { color: light.text, fontSize: fs.fs20, fontWeight: "900", textAlign: "right", marginBottom: -2 },
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
  cardName: { color: light.text, fontSize: fs.fs16, fontWeight: "800", flexShrink: 1, textAlign: "right" },
  meta: { color: light.text2, fontSize: fs.fs13 },
  /* بانرات */
  banner: {
    minHeight: 128,
    borderRadius: radiusMd,
    borderWidth: bw2,
    borderColor: colors.ink900,
    overflow: "hidden",
    justifyContent: "flex-end"
  },
  bannerFill: { backgroundColor: colors.ink900 },
  bTxt: { padding: 16, gap: 3, backgroundColor: "rgba(14,27,61,0.45)" },
  bTitle: { color: colors.white, fontSize: fs.fs17, fontWeight: "900", textAlign: "right" },
  bBody: { color: colors.white, opacity: 0.9, fontSize: fs.fs13, textAlign: "right" },
  bDots: { flexDirection: "row-reverse", justifyContent: "center", gap: 6, marginTop: 8 },
  bDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: light.border },
  bDotOn: { width: 18, backgroundColor: colors.blue500 },
  /* التصنيفات */
  cats: { flexDirection: "row-reverse", flexWrap: "wrap", gap: 10 },
  catCard: {
    flexBasis: "30%",
    flexGrow: 1,
    backgroundColor: light.surface,
    borderRadius: radiusMd,
    borderWidth: bw2,
    borderColor: colors.ink900,
    paddingVertical: 16,
    alignItems: "center",
    gap: 4,
    ...popXs
  },
  catNm: { color: light.text, fontSize: fs.fs15, fontWeight: "800" },
  catCt: { color: colors.blue500, fontSize: fs.fs12, fontWeight: "700" },
  allBtn: {
    backgroundColor: colors.blue500,
    borderRadius: radiusPill,
    borderWidth: bw2,
    borderColor: colors.ink900,
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center",
    ...popSm
  },
  allBtnTxt: { color: colors.white, fontSize: fs.fs15, fontWeight: "800" }
});
