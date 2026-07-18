/**
 * تطبيق العميل — بيكلي.
 * غلاف أصلي رفيع يعرض تجربة الويب المصقولة الحيّة (نفس المزايا كاملة) داخل تطبيق قابل للتثبيت.
 * يضيف فوق الويب: إذن الموقع الأصلي (لتدفّق «وصلت»)، فتح خرائط قوقل/الهاتف خارج التطبيق،
 * زر الرجوع في أندرويد، شاشة «لا اتصال» بإعادة محاولة، سحب-للتحديث (على iOS)، وحفظ الجلسة بين التشغيلات.
 */
import React, { useCallback, useRef, useState, useEffect } from "react";
import {
  ActivityIndicator,
  BackHandler,
  Linking,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import * as Location from "expo-location";
import { WebView } from "react-native-webview";
import type {
  ShouldStartLoadRequest,
  WebViewNavigation,
} from "react-native-webview/lib/WebViewTypes";
import Constants from "expo-constants";

// ————— إعدادات التطبيق —————
const SITE_URL: string =
  (Constants.expoConfig?.extra as { siteUrl?: string } | undefined)?.siteUrl ||
  "https://thepickly.com";
const SURFACE = "#F7F3E9"; // عاجي — سطح صفحات العميل (الأشرطة الآمنة تندمج معه)
const LAUNCH_BG = "#C8F542"; // ليموني — لحظة الإقلاع فقط (شاشة البدء + التحميل الأول)
const LAUNCH_INK = "#0E1B3D"; // كحلي — المؤشّر/النص فوق الليموني
const NEEDS_LOCATION = true;

// مضيفات الخرائط تُفتح خارج التطبيق (لا داخل الغلاف)
const EXTERNAL_SCHEMES = ["tel", "mailto", "sms", "whatsapp", "geo", "maps", "intent"];
const MAPS_HOSTS = ["google.com", "maps.google.com", "maps.app.goo.gl", "goo.gl", "waze.com"];

// رابط خرائط حقيقي؟ نطابق المسار (لا سلسلة الرابط كاملة) كي لا نطرد روابط google أخرى
// مثل redirect_uri (تحوي "dir") من الغلاف عن طريق الخطأ.
function isMapsUrl(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  const host = u.host.toLowerCase();
  const inMapsHost = MAPS_HOSTS.some((h) => host === h || host.endsWith("." + h));
  if (!inMapsHost) return false;
  const path = u.pathname.toLowerCase();
  return (
    /^\/maps(\/|$)/.test(path) ||
    /^\/dir(\/|$)/.test(path) ||
    host.endsWith("waze.com") ||
    host === "maps.app.goo.gl" ||
    host === "goo.gl"
  );
}

function openExternal(url: string) {
  Linking.openURL(url).catch(() => {
    /* لا مُعالج للمخطط على الجهاز — نتجاهل بهدوء */
  });
}

export default function App() {
  const webRef = useRef<WebView>(null);
  const [firstLoadDone, setFirstLoadDone] = useState(false);
  const [errored, setErrored] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const canGoBack = useRef(false);

  // إذن الموقع الأصلي مرة واحدة — كي ينجح navigator.geolocation داخل الويب فوراً
  useEffect(() => {
    if (!NEEDS_LOCATION) return;
    Location.requestForegroundPermissionsAsync().catch(() => {});
  }, []);

  // زر الرجوع في أندرويد يتنقّل داخل الويب قبل إغلاق التطبيق
  useEffect(() => {
    if (Platform.OS !== "android") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (canGoBack.current) {
        webRef.current?.goBack();
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, []);

  const onNavChange = useCallback((nav: WebViewNavigation) => {
    canGoBack.current = nav.canGoBack;
  }, []);

  // توجيه الروابط: الخرائط/الهاتف/واتساب خارج التطبيق، وما عداه (وضمنه تحويلات الدفع 3DS) داخل الغلاف
  const onShouldStart = useCallback((req: ShouldStartLoadRequest): boolean => {
    const url = req.url || "";
    const scheme = (url.split(":")[0] || "").toLowerCase();

    if (scheme === "about" || scheme === "data" || scheme === "blob") return true;

    if (EXTERNAL_SCHEMES.includes(scheme)) {
      openExternal(url);
      return false;
    }

    if (scheme === "http" || scheme === "https") {
      if (isMapsUrl(url)) {
        openExternal(url);
        return false;
      }
      return true; // نبقيه داخل الغلاف — يشمل تحويلات مزوّد الدفع (3DS) والعودة منها
    }

    // مخطط غير معروف (بنكي/محفظة) — نحاول فتحه خارجاً
    openExternal(url);
    return false;
  }, []);

  const reload = useCallback(() => {
    setErrored(false);
    webRef.current?.reload();
  }, []);

  // على شاشة الخطأ يكون الـWebView غير مُركَّب (ref = null) — نعيد تركيبه بدل reload على مرجع فارغ
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    if (webRef.current) webRef.current.reload();
    else setErrored(false);
    setTimeout(() => setRefreshing(false), 1200);
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <SafeAreaView style={styles.root} edges={["top", "bottom", "left", "right"]}>
        {errored ? (
          <ScrollView
            contentContainerStyle={styles.errorWrap}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          >
            <Text style={styles.errorTitle}>تعذّر الاتصال</Text>
            <Text style={styles.errorBody}>تأكّد من اتصالك بالإنترنت ثم أعد المحاولة.</Text>
            <TouchableOpacity style={styles.retryBtn} onPress={reload} activeOpacity={0.85}>
              <Text style={styles.retryText}>إعادة المحاولة</Text>
            </TouchableOpacity>
          </ScrollView>
        ) : (
          <WebView
            ref={webRef}
            source={{ uri: SITE_URL }}
            originWhitelist={["*"]}
            onShouldStartLoadWithRequest={onShouldStart}
            onNavigationStateChange={onNavChange}
            onLoadEnd={() => setFirstLoadDone(true)}
            onError={() => {
              setFirstLoadDone(true);
              setErrored(true);
            }}
            // إبقاء الجلسة (تسجيل الدخول برمز OTP) بين التشغيلات
            sharedCookiesEnabled
            thirdPartyCookiesEnabled
            domStorageEnabled
            javaScriptEnabled
            // الموقع الجغرافي داخل الويب
            geolocationEnabled
            // منع نوافذ منبثقة منفصلة — روابط target=_blank تمرّ عبر onShouldStart
            setSupportMultipleWindows={false}
            allowsBackForwardNavigationGestures
            pullToRefreshEnabled
            mediaPlaybackRequiresUserAction={false}
            allowsInlineMediaPlayback
            applicationNameForUserAgent="PicklyApp/1.0 (customer)"
            style={styles.web}
          />
        )}

        {/* شاشة الإقلاع — تُعرض حتى انتهاء أول تحميل فقط (لا تومض في كل تنقّل) */}
        {!firstLoadDone && !errored ? (
          <View style={styles.launchOverlay} pointerEvents="none">
            <ActivityIndicator size="large" color={LAUNCH_INK} />
          </View>
        ) : null}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: SURFACE },
  web: { flex: 1, backgroundColor: SURFACE },
  launchOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: LAUNCH_BG,
  },
  errorWrap: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    backgroundColor: SURFACE,
  },
  errorTitle: { fontSize: 22, fontWeight: "800", color: LAUNCH_INK, marginBottom: 8 },
  errorBody: { fontSize: 15, color: LAUNCH_INK, opacity: 0.75, textAlign: "center", marginBottom: 24 },
  retryBtn: {
    backgroundColor: LAUNCH_INK,
    paddingVertical: 14,
    paddingHorizontal: 40,
    borderRadius: 999,
  },
  retryText: { color: "#FFFFFF", fontSize: 16, fontWeight: "700" },
});
