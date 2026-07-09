/**
 * P5 (C-26): السلة + التسعير الخادمي — POST /v1/carts/{id}/quote (BR-6).
 * رسم خدمة بيكلي مفصول وواضح دائماً. حذف عنصر → إعادة تسعير فورية.
 */
import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { api, ApiError, fmtSar } from "../src/api";
import { getCartId, setQuoteId } from "../src/session";
import { Card, ErrorNote, GhostButton, LimeButton, Loader } from "../src/ui";
import { colors, fs, light, radius, shadow2, touch } from "../src/theme";

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

export default function CartScreen() {
  const [cart, setCart] = useState<Cart | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyItem, setBusyItem] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cartId = getCartId();

  const applyQuoted = useCallback((c: Cart) => {
    setCart(c);
    if (c.quote) setQuoteId(c.quote.quote_id);
  }, []);

  useEffect(() => {
    if (!cartId) {
      setLoading(false);
      return;
    }
    // تسعير خادمي فور فتح السلة — BR-6
    api<Cart>("POST", `/v1/carts/${cartId}/quote`)
      .then(applyQuoted)
      .catch(async (e: Error) => {
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

  return (
    <SafeAreaView style={st.screen} edges={["top"]}>
      <View style={st.head}>
        <Pressable style={st.back} onPress={() => router.back()} accessibilityRole="button">
          <Text style={st.backTxt}>‹</Text>
        </Pressable>
        <Text style={st.title}>السلة</Text>
      </View>

      {error && (
        <View style={{ paddingHorizontal: 16 }}>
          <ErrorNote text={error} />
        </View>
      )}
      {loading && <Loader />}

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
        <ScrollView contentContainerStyle={st.body}>
          {cart.items.map((i) => (
            <Card key={i.id} style={{ gap: 4 }}>
              <Text style={st.name}>{i.name_ar}</Text>
              {i.modifiers.length > 0 && (
                <Text style={st.mods}>{i.modifiers.map((m) => m.name_ar).join(" · ")}</Text>
              )}
              <View style={st.row}>
                <Text style={st.qty}>× {i.quantity}</Text>
                <Text style={st.price}>{fmtSar(i.line_total_halalas)}</Text>
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

          {cart.quote && (
            <Card style={{ gap: 8 }}>
              <Text style={st.sumTitle}>ملخص الفاتورة</Text>
              <View style={st.srow}>
                <Text style={st.sk}>المجموع الفرعي</Text>
                <Text style={st.sv}>{fmtSar(cart.quote.subtotal_halalas)}</Text>
              </View>
              {cart.quote.discount_halalas > 0 && (
                <View style={st.srow}>
                  <Text style={[st.sk, { color: colors.success }]}>الخصم</Text>
                  <Text style={[st.sv, { color: colors.success }]}>
                    −{fmtSar(cart.quote.discount_halalas)}
                  </Text>
                </View>
              )}
              {/* رسم الخدمة مفصول وواضح دائماً — BR-6 */}
              <View style={st.srow}>
                <Text style={st.sk}>رسم خدمة بيكلي</Text>
                <Text style={st.sv}>{fmtSar(cart.quote.service_fee_halalas)}</Text>
              </View>
              <View style={st.srow}>
                <Text style={st.sk}>الضريبة (15٪)</Text>
                <Text style={st.sv}>{fmtSar(cart.quote.vat_halalas)}</Text>
              </View>
              <View style={[st.srow, st.totRow]}>
                <Text style={st.totK}>الإجمالي</Text>
                <Text style={st.totV}>{fmtSar(cart.quote.total_halalas)}</Text>
              </View>
              <Text style={st.brNote}>رسوم الخدمة تظهر مفصولة دائماً · التسعير خادمي (BR-6)</Text>
            </Card>
          )}
        </ScrollView>
      )}

      {!isEmpty && cart?.quote && (
        <View style={st.footbar}>
          <LimeButton
            title="متابعة الإتمام"
            trailing={fmtSar(cart.quote.total_halalas)}
            onPress={() => router.push("/checkout")}
          />
        </View>
      )}
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  screen: { flex: 1, backgroundColor: light.bg },
  head: { flexDirection: "row-reverse", alignItems: "center", gap: 8, padding: 16, paddingBottom: 8 },
  back: { width: touch, height: touch, alignItems: "center", justifyContent: "center" },
  backTxt: { color: light.text, fontSize: fs.fs24, fontWeight: "800" },
  title: { color: light.text, fontSize: fs.fs20, fontWeight: "900" },
  empty: { alignItems: "center", padding: 24, paddingTop: 64, gap: 6 },
  emptyTitle: { color: light.text, fontSize: fs.fs17, fontWeight: "800" },
  emptyTxt: { color: light.text2, fontSize: fs.fs14, textAlign: "center" },
  body: { padding: 16, gap: 10, paddingBottom: 100 },
  name: { color: light.text, fontSize: fs.fs15, fontWeight: "800", textAlign: "right" },
  mods: { color: light.text2, fontSize: fs.fs13, textAlign: "right" },
  row: { flexDirection: "row-reverse", justifyContent: "space-between", alignItems: "center" },
  qty: { color: light.text2, fontSize: fs.fs14 },
  price: { color: light.text, fontSize: fs.fs14, fontWeight: "700", fontVariant: ["tabular-nums"] },
  del: { alignSelf: "flex-start", minHeight: 32, justifyContent: "center" },
  delTxt: { color: colors.error, fontSize: fs.fs13, fontWeight: "700" },
  sumTitle: { color: light.text, fontSize: fs.fs16, fontWeight: "900", textAlign: "right" },
  srow: { flexDirection: "row-reverse", justifyContent: "space-between" },
  sk: { color: light.text2, fontSize: fs.fs14 },
  sv: { color: light.text, fontSize: fs.fs14, fontVariant: ["tabular-nums"] },
  totRow: { borderTopWidth: 1, borderTopColor: light.border, paddingTop: 8, marginTop: 2 },
  totK: { color: light.text, fontSize: fs.fs16, fontWeight: "900" },
  totV: { color: light.text, fontSize: fs.fs16, fontWeight: "900", fontVariant: ["tabular-nums"] },
  brNote: { color: light.text2, fontSize: fs.fs12, textAlign: "right" },
  footbar: {
    position: "absolute",
    bottom: 16,
    left: 16,
    right: 16,
    borderRadius: radius,
    ...shadow2
  }
});
