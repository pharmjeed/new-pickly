/**
 * تطبيق الفرع — بيكلي للفرع.
 * غلاف أصلي رفيع يعرض شاشة تشغيل الفرع المصقولة الحيّة (اللوحة/KDS/الورديات) داخل تطبيق قابل للتثبيت
 * على جوال أو تابلت. يضيف فوق الويب: زر الرجوع في أندرويد، شاشة «لا اتصال» بإعادة محاولة،
 * سحب-للتحديث (على iOS)، وحفظ جلسة تسجيل الدخول بين التشغيلات. لا يحتاج إذن موقع.
 * الشريط الآمن العلوي كحلي (يطابق رأس اللوحة) والسفلي عاجي (يطابق جسم الصفحة).
 *
 * تنبيه الطلب الجديد والجهاز مقفل: صوت اللوحة (WebAudio) يتجمد بقفل الشاشة، لذا
 * (١) الشاشة تبقى صاحية ما دام التطبيق في الواجهة (expo-keep-awake) فلا يقفل التابلت نفسه،
 * (٢) توكن Expo Push يُحقن لصفحة اللوحة فتسجّله بجلستها، والخادم يرسل إشعاراً نظامياً
 *     عند كل طلب جديد يرن حتى والجهاز مقفل بيد الموظف.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
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
import {
  SafeAreaProvider,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { WebView } from "react-native-webview";
import type {
  ShouldStartLoadRequest,
  WebViewNavigation,
} from "react-native-webview/lib/WebViewTypes";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import { useKeepAwake } from "expo-keep-awake";

// التطبيق في الواجهة ← إنذار اللوحة نفسها يصدح؛ لا لافتة/صوت نظاميين مكررين فوقه
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: false,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

// ————— إعدادات التطبيق —————
const SITE_URL: string =
  (Constants.expoConfig?.extra as { siteUrl?: string } | undefined)?.siteUrl ||
  "https://branch.thepickly.com";

const NAVY = "#0E1B3D"; // كحلي — رأس اللوحة + الشريط العلوي + الإقلاع
const SURFACE = "#F7F3E9"; // عاجي — جسم الصفحة + الشريط السفلي
const LIME = "#C8F542"; // ليموني — المؤشّر
const ACTION = "#0B63CE"; // أزرق الفعل — زر إعادة المحاولة

const EXTERNAL_SCHEMES = ["tel", "mailto", "sms", "whatsapp", "geo", "maps", "intent"];
const MAPS_HOSTS = ["google.com", "maps.google.com", "maps.app.goo.gl", "goo.gl", "waze.com"];

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
  Linking.openURL(url).catch(() => {});
}

function Shell() {
  const insets = useSafeAreaInsets();
  const webRef = useRef<WebView>(null);
  const [firstLoadDone, setFirstLoadDone] = useState(false);
  const [errored, setErrored] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const canGoBack = useRef(false);
  const pushToken = useRef<string | null>(null);

  // اللوحة شاشة تشغيل دائمة — تبقى صاحية فلا يقفل التابلت نفسه ويفوّت إنذار الطلبات
  useKeepAwake();

  /** حقن التوكن لصفحة اللوحة — تسجّله بجلستها الموثقة عبر /v1/merchant/devices/push-token */
  const injectPushToken = useCallback(() => {
    const token = pushToken.current;
    if (!token || !webRef.current) return;
    webRef.current.injectJavaScript(
      `(function(){` +
        `window.__picklyPush={token:${JSON.stringify(token)},platform:${JSON.stringify(Platform.OS)}};` +
        `document.dispatchEvent(new CustomEvent("pickly:push-token",{detail:window.__picklyPush}));` +
        `})();true;`
    );
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!Device.isDevice) return; // المحاكيات بلا Push
        if (Platform.OS === "android") {
          // قناة «طلبات» بأقصى أهمية — صوت + ظهور كامل على شاشة القفل
          await Notifications.setNotificationChannelAsync("orders", {
            name: "طلبات جديدة",
            importance: Notifications.AndroidImportance.MAX,
            sound: "default",
            vibrationPattern: [0, 400, 200, 400],
            lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
          });
        }
        const current = await Notifications.getPermissionsAsync();
        const granted =
          current.granted || (await Notifications.requestPermissionsAsync()).granted;
        if (!granted) return;
        const projectId = (
          Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined
        )?.eas?.projectId;
        if (!projectId) return; // قبل eas init — التطبيق يعمل والإشعارات تُفعَّل بعد البناء بالمعرّف
        const token = await Notifications.getExpoPushTokenAsync({ projectId });
        if (cancelled) return;
        pushToken.current = token.data;
        injectPushToken();
      } catch {
        /* الإشعارات تحسين — اللوحة تعمل بدونها */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [injectPushToken]);

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
      return true;
    }

    openExternal(url);
    return false;
  }, []);

  const reload = useCallback(() => {
    setErrored(false);
    webRef.current?.reload();
  }, []);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    if (webRef.current) webRef.current.reload();
    else setErrored(false);
    setTimeout(() => setRefreshing(false), 1200);
  }, []);

  return (
    <View style={styles.base}>
      {/* الشريط الآمن العلوي كحلي — يطابق رأس اللوحة (.bhdr) في كل الشاشات */}
      <View style={{ height: insets.top, backgroundColor: NAVY }} />
      <View
        style={[
          styles.content,
          { paddingBottom: insets.bottom, paddingLeft: insets.left, paddingRight: insets.right },
        ]}
      >
        {errored ? (
          <ScrollView
            contentContainerStyle={styles.errorWrap}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          >
            <Text style={styles.errorTitle}>تعذّر الاتصال</Text>
            <Text style={styles.errorBody}>تأكّد من اتصال الفرع بالإنترنت ثم أعد المحاولة.</Text>
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
            onLoadEnd={() => {
              setFirstLoadDone(true);
              injectPushToken(); // التوكن قد يسبق تحميل الصفحة أو تعاد بعد سحب-للتحديث
            }}
            onError={() => {
              setFirstLoadDone(true);
              setErrored(true);
            }}
            sharedCookiesEnabled
            thirdPartyCookiesEnabled
            domStorageEnabled
            javaScriptEnabled
            setSupportMultipleWindows={false}
            allowsBackForwardNavigationGestures
            pullToRefreshEnabled
            mediaPlaybackRequiresUserAction={false}
            allowsInlineMediaPlayback
            applicationNameForUserAgent="PicklyApp/1.0 (branch)"
            style={styles.web}
          />
        )}
      </View>

      {/* شاشة الإقلاع — حتى انتهاء أول تحميل فقط */}
      {!firstLoadDone && !errored ? (
        <View style={styles.launchOverlay} pointerEvents="none">
          <ActivityIndicator size="large" color={LIME} />
        </View>
      ) : null}
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <Shell />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  base: { flex: 1, backgroundColor: SURFACE }, // عاجي — يملأ الشريط السفلي والجانبي
  content: { flex: 1 },
  web: { flex: 1, backgroundColor: SURFACE },
  launchOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: NAVY,
  },
  errorWrap: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    backgroundColor: NAVY,
  },
  errorTitle: { fontSize: 22, fontWeight: "800", color: "#FFFFFF", marginBottom: 8 },
  errorBody: { fontSize: 15, color: "rgba(255,255,255,0.75)", textAlign: "center", marginBottom: 24 },
  retryBtn: {
    backgroundColor: ACTION,
    paddingVertical: 14,
    paddingHorizontal: 40,
    borderRadius: 999,
  },
  retryText: { color: "#FFFFFF", fontSize: 16, fontWeight: "700" },
});
