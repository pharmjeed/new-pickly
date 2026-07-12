/**
 * P4: المطعم الشامل — المنيو داخل الصفحة (C-19→C-25).
 * GET /v1/branches/{id}/menu · POST /v1/carts · POST /v1/carts/{id}/items
 * المُعدِّلات الإلزامية تُحدد مسبقاً بأول خيار (min_select من كل مجموعة).
 * الضغط على البطاقة يفتح الورقة دائماً؛ بلا مُعدِّلات تظهر الإضافات والكمية فقط.
 */
import { useMemo, useState, useEffect } from "react";
import {
  Image,
  Modal,
  Pressable,
  ScrollView,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { api, fmtSar, getToken } from "../../src/api";
import { getCartId, setCartId } from "../../src/session";
import { Badge, ErrorNote, LimeButton, Loader } from "../../src/ui";
import { colors, fs, light, radius, radiusPill, shadow2, touch } from "../../src/theme";

interface Modifier {
  id: string;
  name_ar: string;
  price_halalas: number;
}
interface ModifierGroup {
  id: string;
  name_ar: string;
  min_select: number;
  max_select: number;
  modifiers: Modifier[];
}
interface Product {
  id: string;
  name_ar: string;
  description_ar: string | null;
  price_halalas: number;
  image_url?: string | null;
  is_available: boolean;
  modifier_groups: ModifierGroup[];
}
interface Menu {
  branch_id: string;
  categories: Array<{ id: string; name_ar: string; products: Product[] }>;
}
interface SheetState {
  product: Product;
  qty: number;
  sel: Record<string, string[]>;
  note: string;
}

/** الاختيار الافتراضي: أول min_select خيار من كل مجموعة إلزامية */
function defaultSelection(p: Product): Record<string, string[]> {
  const sel: Record<string, string[]> = {};
  for (const g of p.modifier_groups) {
    sel[g.id] = g.min_select >= 1 ? g.modifiers.slice(0, g.min_select).map((m) => m.id) : [];
  }
  return sel;
}

export default function RestaurantScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [menu, setMenu] = useState<Menu | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [count, setCount] = useState(0);
  const [totalHalalas, setTotalHalalas] = useState(0);
  const [sheet, setSheet] = useState<SheetState | null>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (!id) return;
    api<Menu>("GET", `/v1/branches/${id}/menu`)
      .then(setMenu)
      .catch((e: Error) => setError(e.message));
  }, [id]);

  const ensureCart = async (): Promise<string> => {
    const existing = getCartId();
    if (existing) return existing;
    if (!(await getToken())) {
      router.push(`/auth?next=/restaurant/${id}` as never);
      throw new Error("سجّل دخولك أولاً");
    }
    const cart = await api<{ id: string }>("POST", "/v1/carts", { branch_id: id });
    setCartId(cart.id);
    return cart.id;
  };

  const postItem = async (
    p: Product,
    quantity: number,
    modifier_ids: string[],
    note?: string
  ): Promise<boolean> => {
    setError(null);
    setAdding(true);
    try {
      const cid = await ensureCart();
      await api("POST", `/v1/carts/${cid}/items`, {
        product_id: p.id,
        quantity,
        modifier_ids,
        ...(note?.trim() ? { notes: note.trim() } : {})
      });
      const modTotal = p.modifier_groups
        .flatMap((g) => g.modifiers)
        .filter((m) => modifier_ids.includes(m.id))
        .reduce((s, m) => s + m.price_halalas, 0);
      setCount((c) => c + quantity);
      setTotalHalalas((t) => t + (p.price_halalas + modTotal) * quantity);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setAdding(false);
    }
  };

  const openSheet = (p: Product) => setSheet({ product: p, qty: 1, sel: defaultSelection(p), note: "" });

  const toggleModifier = (g: ModifierGroup, modId: string) => {
    setSheet((s) => {
      if (!s) return s;
      const cur = s.sel[g.id] ?? [];
      let next: string[];
      if (g.max_select === 1) {
        // سلوك radio — المجموعة الإلزامية لا تُفرَّغ
        next = cur.includes(modId) ? (g.min_select >= 1 ? cur : []) : [modId];
      } else if (cur.includes(modId)) {
        next = cur.filter((x) => x !== modId);
      } else if (cur.length < g.max_select) {
        next = [...cur, modId];
      } else {
        return s;
      }
      return { ...s, sel: { ...s.sel, [g.id]: next } };
    });
  };

  const sheetModifierIds = useMemo(() => (sheet ? Object.values(sheet.sel).flat() : []), [sheet]);
  const sheetUnitPrice = useMemo(() => {
    if (!sheet) return 0;
    const mods = sheet.product.modifier_groups
      .flatMap((g) => g.modifiers)
      .filter((m) => sheetModifierIds.includes(m.id))
      .reduce((s, m) => s + m.price_halalas, 0);
    return sheet.product.price_halalas + mods;
  }, [sheet, sheetModifierIds]);
  const incompleteGroups = useMemo(
    () =>
      sheet
        ? sheet.product.modifier_groups.filter((g) => (sheet.sel[g.id] ?? []).length < g.min_select)
        : [],
    [sheet]
  );

  const confirmSheet = async () => {
    if (!sheet || incompleteGroups.length > 0) return;
    const ok = await postItem(sheet.product, sheet.qty, sheetModifierIds, sheet.note);
    if (ok) setSheet(null);
  };

  const sections =
    menu?.categories.map((c) => ({ title: c.name_ar, key: c.id, data: c.products })) ?? [];

  return (
    <SafeAreaView style={st.screen} edges={["top"]}>
      {/* رأس المطعم */}
      <View style={st.head}>
        <Pressable style={st.back} onPress={() => router.back()} accessibilityRole="button">
          <Text style={st.backTxt}>‹</Text>
        </Pressable>
        <Text style={st.title}>قائمة المطعم</Text>
      </View>
      <Text style={st.carLine}>يصل طلبك إلى سيارتك — خلّك في سيارتك، الباقي علينا</Text>

      {error && !sheet && (
        <View style={{ paddingHorizontal: 16 }}>
          <ErrorNote text={error} />
        </View>
      )}
      {!menu && !error && <Loader />}

      {menu && (
        <SectionList
          sections={sections}
          keyExtractor={(p) => p.id}
          stickySectionHeadersEnabled={false}
          contentContainerStyle={st.list}
          renderSectionHeader={({ section }) => <Text style={st.catTitle}>{section.title}</Text>}
          renderItem={({ item: p }) => {
            const customizable = p.modifier_groups.length > 0;
            return (
              <Pressable
                style={[st.pcard, !p.is_available ? { opacity: 0.5 } : null]}
                disabled={!p.is_available}
                accessibilityRole="button"
                accessibilityLabel={customizable ? `خصّص ${p.name_ar}` : `أضف ${p.name_ar}`}
                onPress={() => openSheet(p)}
              >
                <View style={{ flex: 1, gap: 4 }}>
                  <View style={st.ptitleRow}>
                    <Text style={st.ptitle} numberOfLines={1}>
                      {p.name_ar}
                    </Text>
                    {customizable && <Badge label="قابل للتخصيص" tone="lime" />}
                  </View>
                  {p.description_ar && (
                    <Text style={st.pdesc} numberOfLines={2}>
                      {p.description_ar}
                    </Text>
                  )}
                  <Text style={st.price}>
                    {customizable ? "يبدأ من " : ""}
                    {fmtSar(p.price_halalas)}
                  </Text>
                </View>
                {p.is_available ? (
                  <View style={st.addBtn} pointerEvents="none">
                    <Text style={st.addTxt}>+</Text>
                  </View>
                ) : (
                  <Badge label="غير متوفر" tone="soft" />
                )}
              </Pressable>
            );
          }}
        />
      )}

      {/* شريط السلة العائم */}
      {count > 0 && (
        <View style={st.cartBar}>
          <LimeButton
            title={`عرض السلة · ${count}`}
            trailing={fmtSar(totalHalalas)}
            onPress={() => router.push("/cart")}
          />
        </View>
      )}

      {/* ورقة التخصيص (C-25) */}
      <Modal visible={sheet !== null} transparent animationType="slide" onRequestClose={() => setSheet(null)}>
        <View style={st.dim}>
          <Pressable style={{ flex: 1 }} onPress={() => setSheet(null)} />
          {sheet && (
            <View style={st.sheet}>
              <View style={st.grab} />
              {sheet.product.image_url ? (
                <Image
                  source={{ uri: sheet.product.image_url }}
                  style={st.sheetImg}
                  resizeMode="cover"
                  accessibilityLabel={sheet.product.name_ar}
                />
              ) : null}
              <View style={st.sheetHead}>
                <Text style={st.sheetTitle}>{sheet.product.name_ar}</Text>
                <Pressable onPress={() => setSheet(null)} style={st.close} accessibilityRole="button">
                  <Text style={st.closeTxt}>✕</Text>
                </Pressable>
              </View>
              <Text style={st.sheetPrice}>{fmtSar(sheet.product.price_halalas)}</Text>
              {sheet.product.description_ar ? (
                <Text style={[st.pdesc, { marginBottom: 10 }]}>{sheet.product.description_ar}</Text>
              ) : null}

              <ScrollView style={{ maxHeight: 340 }}>
                {sheet.product.modifier_groups.map((g) => {
                  const selected = sheet.sel[g.id] ?? [];
                  const mandatory = g.min_select >= 1;
                  const complete = selected.length >= g.min_select;
                  return (
                    <View key={g.id} style={{ marginBottom: 12 }}>
                      <View style={st.groupHead}>
                        <Text style={st.groupName}>{g.name_ar}</Text>
                        {mandatory ? (
                          <Badge
                            label={complete ? "تم ✓" : `إجباري — اختر ${g.min_select === 1 ? "واحداً" : g.min_select}`}
                            tone={complete ? "ok" : "err"}
                          />
                        ) : (
                          <Text style={st.groupHint}>اختياري · حتى {g.max_select}</Text>
                        )}
                      </View>
                      <View style={st.optCard}>
                        {g.modifiers.map((m) => {
                          const on = selected.includes(m.id);
                          return (
                            <Pressable
                              key={m.id}
                              style={st.optRow}
                              onPress={() => toggleModifier(g, m.id)}
                              accessibilityRole="button"
                              accessibilityState={{ selected: on }}
                            >
                              <View style={[st.dotOuter, on ? st.dotOn : null]}>
                                {on && <View style={st.dotInner} />}
                              </View>
                              <Text style={st.optT}>{m.name_ar}</Text>
                              <Text style={st.optP}>+{(m.price_halalas / 100).toFixed(2)}</Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    </View>
                  );
                })}

                <Text style={st.label}>إضافاتك على الصنف (اختياري)</Text>
                <TextInput
                  style={st.inp}
                  placeholder="مثال: بدون بصل، الصوص على جنب"
                  placeholderTextColor={colors.gray}
                  maxLength={280}
                  value={sheet.note}
                  onChangeText={(v) => setSheet((s) => (s ? { ...s, note: v } : s))}
                />
              </ScrollView>

              {error && <ErrorNote text={error} />}

              <View style={st.sheetFoot}>
                <View style={st.qty}>
                  <Pressable
                    style={st.qtyBtn}
                    onPress={() => setSheet((s) => (s ? { ...s, qty: Math.min(50, s.qty + 1) } : s))}
                    accessibilityRole="button"
                    accessibilityLabel="زيادة الكمية"
                  >
                    <Text style={st.qtyTxt}>+</Text>
                  </Pressable>
                  <Text style={st.qtyVal}>{sheet.qty}</Text>
                  <Pressable
                    style={st.qtyBtn}
                    onPress={() => setSheet((s) => (s ? { ...s, qty: Math.max(1, s.qty - 1) } : s))}
                    accessibilityRole="button"
                    accessibilityLabel="إنقاص الكمية"
                  >
                    <Text style={st.qtyTxt}>−</Text>
                  </Pressable>
                </View>
                <LimeButton
                  title={`أضف للسلة · ${sheet.qty}`}
                  trailing={fmtSar(sheetUnitPrice * sheet.qty)}
                  disabled={adding || incompleteGroups.length > 0}
                  onPress={() => void confirmSheet()}
                  style={{ flex: 1 }}
                />
              </View>
              {incompleteGroups.length > 0 && (
                <Text style={st.mandatoryHint}>
                  أكمل الخيارات الإجبارية أولاً — {incompleteGroups.map((g) => g.name_ar).join("، ")}
                </Text>
              )}
            </View>
          )}
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  screen: { flex: 1, backgroundColor: light.bg },
  head: { flexDirection: "row-reverse", alignItems: "center", gap: 8, padding: 16, paddingBottom: 4 },
  back: { width: touch, height: touch, alignItems: "center", justifyContent: "center" },
  backTxt: { color: light.text, fontSize: fs.fs24, fontWeight: "800" },
  title: { color: light.text, fontSize: fs.fs20, fontWeight: "900", textAlign: "right" },
  carLine: {
    color: colors.lime900,
    fontSize: fs.fs13,
    fontWeight: "700",
    textAlign: "right",
    paddingHorizontal: 16,
    marginBottom: 6
  },
  list: { padding: 16, paddingBottom: 96, gap: 8 },
  catTitle: {
    color: light.text,
    fontSize: fs.fs17,
    fontWeight: "900",
    textAlign: "right",
    marginTop: 12,
    marginBottom: 4
  },
  pcard: {
    backgroundColor: light.surface,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: light.border,
    padding: 12,
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 10,
    marginBottom: 8
  },
  ptitleRow: { flexDirection: "row-reverse", alignItems: "center", gap: 6 },
  ptitle: { color: light.text, fontSize: fs.fs15, fontWeight: "800", flexShrink: 1, textAlign: "right" },
  pdesc: { color: light.text2, fontSize: fs.fs13, textAlign: "right" },
  price: { color: light.text, fontSize: fs.fs14, fontWeight: "700", textAlign: "right" },
  addBtn: {
    width: touch,
    height: touch,
    borderRadius: radius,
    backgroundColor: colors.lime100,
    alignItems: "center",
    justifyContent: "center"
  },
  addTxt: { color: colors.lime900, fontSize: fs.fs24, fontWeight: "800", lineHeight: 28 },
  cartBar: { position: "absolute", bottom: 16, left: 16, right: 16, ...shadow2 },
  dim: { flex: 1, backgroundColor: "rgba(16,36,27,0.55)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: light.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
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
  sheetImg: { width: "100%", height: 160, borderRadius: radius, marginBottom: 10, backgroundColor: light.bg },
  sheetHead: { flexDirection: "row-reverse", alignItems: "center", justifyContent: "space-between" },
  sheetTitle: { color: light.text, fontSize: fs.fs20, fontWeight: "900", flexShrink: 1, textAlign: "right" },
  close: { width: touch, height: touch, alignItems: "center", justifyContent: "center" },
  closeTxt: { color: light.text2, fontSize: fs.fs17 },
  sheetPrice: { color: light.text2, fontSize: fs.fs14, textAlign: "right", marginBottom: 10 },
  groupHead: {
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6
  },
  groupName: { color: light.text, fontSize: fs.fs15, fontWeight: "800" },
  groupHint: { color: light.text2, fontSize: fs.fs12 },
  optCard: { borderWidth: 1, borderColor: light.border, borderRadius: radius, overflow: "hidden" },
  optRow: {
    minHeight: touch,
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: light.border
  },
  dotOuter: {
    width: 20,
    height: 20,
    borderRadius: radiusPill,
    borderWidth: 2,
    borderColor: light.border,
    alignItems: "center",
    justifyContent: "center"
  },
  dotOn: { borderColor: colors.lime900 },
  dotInner: { width: 10, height: 10, borderRadius: radiusPill, backgroundColor: colors.lime500 },
  optT: { color: light.text, fontSize: fs.fs14, flex: 1, textAlign: "right" },
  optP: { color: light.text2, fontSize: fs.fs13, fontVariant: ["tabular-nums"] },
  label: { color: light.text, fontSize: fs.fs14, fontWeight: "700", textAlign: "right", marginBottom: 6 },
  inp: {
    minHeight: touch,
    backgroundColor: light.bg,
    borderWidth: 1,
    borderColor: light.border,
    borderRadius: radius,
    paddingHorizontal: 12,
    fontSize: fs.fs14,
    color: light.text,
    textAlign: "right",
    marginBottom: 10
  },
  sheetFoot: { flexDirection: "row-reverse", alignItems: "center", gap: 10, marginTop: 8 },
  qty: {
    flexDirection: "row-reverse",
    alignItems: "center",
    borderWidth: 1,
    borderColor: light.border,
    borderRadius: radius
  },
  qtyBtn: { width: touch, height: touch, alignItems: "center", justifyContent: "center" },
  qtyTxt: { color: light.text, fontSize: fs.fs20, fontWeight: "800" },
  qtyVal: { color: light.text, fontSize: fs.fs16, fontWeight: "800", minWidth: 24, textAlign: "center" },
  mandatoryHint: { color: colors.error, fontSize: fs.fs12, textAlign: "right", marginTop: 8 }
});
