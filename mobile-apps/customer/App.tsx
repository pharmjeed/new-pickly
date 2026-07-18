/**
 * تطبيق العميل — بيكلي.
 * غلاف أصلي رفيع يعرض تجربة الويب المصقولة الحيّة (نفس المزايا كاملة) داخل تطبيق قابل للتثبيت.
 * يضيف فوق الويب: إذن الموقع الأصلي (لتدفّق «وصلت»)، فتح خرائط قوقل/الهاتف خارج التطبيق،
 * زر الرجوع في أندرويد، شاشة «لا اتصال» بإعادة محاولة، سحب-للتحديث (على iOS)، وحفظ الجلسة بين التشغيلات.
 *
 * إشعارات تقدّم الطلب والتطبيق مقفل: توكن Expo Push يُحقن لصفحة الويب فتسجّله
 * بجلستها (POST /v1/customers/me/push-token)، والخادم يرسل إشعاراً نظامياً يرن
 * عند القبول/الجاهزية/انطلاق التسليم/الاسترداد/التذكيرات حتى والجهاز مقفل.
 */
import React, { useCallback, useRef, useState, useEffect } from "react";
import {
  Animated,
  BackHandler,
  Easing,
  Linking,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import Svg, { Circle, G, Line, Path } from "react-native-svg";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import * as Location from "expo-location";
import { WebView } from "react-native-webview";
import type {
  ShouldStartLoadRequest,
  WebViewNavigation,
} from "react-native-webview/lib/WebViewTypes";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";

// التطبيق في الواجهة ← نُظهر اللافتة والصوت أيضاً — صفحة الويب بلا منبّه خاص بها
// (بعكس لوحة الفرع ذات الإنذار الصادح)، والعميل قد يتصفح صفحة أخرى داخل التطبيق
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

// ————— إعدادات التطبيق —————
const SITE_URL: string =
  (Constants.expoConfig?.extra as { siteUrl?: string } | undefined)?.siteUrl ||
  "https://app.thepickly.com";
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

// ————— شاشة الإقلاع: «القرطاس الماشي» (جولة تصميم 2026-07-19 — الخيار ٢ بإيقاع سريع) —————
// هندسة الكاركتر حرفياً من apps/customer-web/src/app/qirtas.tsx (ميلان ٧°، القاعدة المسنّنة،
// خطوط السرعة ١٠٠/٥٥/٣٠٪). الخطوط الوردية تتلألأ تتابعياً = مؤشر التحميل الرسمي —
// لا دوائر دوّارة (كتاب الهوية §10). كل الإحداثيات داخل SVG واحد كي لا يقلبها RTL.
const PINK = "#FF4D9D";
const CHAR_H = 132; // يقارب حجم أيقونة شاشة البدء الأصلية فيبدو الانتقال ذوباناً لا قفزة
const CHAR_W = Math.round((CHAR_H * 202) / 186); // نسبة إطار العرض "14 26 202 186"

const AnimatedLine = Animated.createAnimatedComponent(Line);

function LaunchWalk() {
  const enter = useRef(new Animated.Value(0)).current; // ظهور خاطف
  const walk = useRef(new Animated.Value(0)).current; // دورة المشي (وثب + تمايل)
  const shimmer = useRef(new Animated.Value(0)).current; // موجة الخطوط — JS driver لأنها خصائص SVG

  useEffect(() => {
    Animated.timing(enter, {
      toValue: 1,
      duration: 160,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
    Animated.loop(
      Animated.sequence([
        Animated.timing(walk, {
          toValue: 1,
          duration: 200,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(walk, {
          toValue: 0,
          duration: 200,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ])
    ).start();
    Animated.loop(
      Animated.timing(shimmer, {
        toValue: 1,
        duration: 900,
        easing: Easing.linear,
        useNativeDriver: false,
      })
    ).start();
  }, [enter, walk, shimmer]);

  // تلألؤ تتابعي ١ ثم ٢ ثم ٣ — يحاكي QirtasLoader في الويب
  const lineOpacity = [
    shimmer.interpolate({ inputRange: [0, 0.15, 0.3, 1], outputRange: [1, 0.35, 1, 1] }),
    shimmer.interpolate({ inputRange: [0, 0.2, 0.35, 0.5, 1], outputRange: [0.3, 0.3, 1, 0.3, 0.3] }),
    shimmer.interpolate({ inputRange: [0, 0.45, 0.6, 0.75, 1], outputRange: [0.25, 0.25, 1, 0.25, 0.25] }),
  ];

  return (
    <Animated.View
      style={{
        alignItems: "center",
        opacity: enter,
        transform: [{ scale: enter.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }) }],
      }}
    >
      <Animated.View
        style={{
          transform: [
            { translateY: walk.interpolate({ inputRange: [0, 1], outputRange: [0, -6] }) },
            { rotate: walk.interpolate({ inputRange: [0, 1], outputRange: ["-2deg", "3deg"] }) },
          ],
        }}
      >
        <Svg width={CHAR_W} height={CHAR_H} viewBox="14 26 202 186">
          <AnimatedLine x1={22} y1={94} x2={78} y2={94} stroke={PINK} strokeWidth={11} opacity={lineOpacity[0]} />
          <AnimatedLine x1={22} y1={126} x2={66} y2={126} stroke={PINK} strokeWidth={11} opacity={lineOpacity[1]} />
          <AnimatedLine x1={22} y1={158} x2={54} y2={158} stroke={PINK} strokeWidth={11} opacity={lineOpacity[2]} />
          <G rotation={7} originX={144} originY={124}>
            <Path d="M88 84 L116 66 L102 42 Z" fill="#FFFFFF" stroke={LAUNCH_INK} strokeWidth={7} strokeLinejoin="round" />
            <Path d="M88 84 L116 66 L116 192 L88 204 Z" fill="#FFFFFF" stroke={LAUNCH_INK} strokeWidth={7} strokeLinejoin="round" />
            <Path
              d="M116 62 L200 62 L200 182 L189.5 196 L179 182 L168.5 196 L158 182 L147.5 196 L137 182 L126.5 196 L116 182 Z"
              fill="#FFFFFF"
              stroke={LAUNCH_INK}
              strokeWidth={7}
              strokeLinejoin="round"
            />
            <Circle cx={144} cy={112} r={7.5} fill={LAUNCH_INK} />
            <Circle cx={176} cy={112} r={7.5} fill={LAUNCH_INK} />
            <Path d="M142 140 Q160 160 178 140" fill="none" stroke={LAUNCH_INK} strokeWidth={9} strokeLinecap="round" />
          </G>
        </Svg>
      </Animated.View>
      {/* الظل تحت القرطاس (يمين مركز الرسم لأن الخطوط تشغل يساره) — ينضغط مع كل خطوة */}
      <Animated.View
        style={[
          styles.walkShadow,
          {
            transform: [
              { translateX: 24 },
              { scaleX: walk.interpolate({ inputRange: [0, 1], outputRange: [1, 0.78] }) },
            ],
          },
        ]}
      />
      {/* الاسم الثنائي — عمود بمحاذاة يسار فيزيائية (لا ينقلب مع RTL) */}
      <View style={styles.wordmark}>
        <Text style={styles.wordmarkEn}>pickly</Text>
        <Text style={styles.wordmarkAr}>بيكلي</Text>
      </View>
    </Animated.View>
  );
}

export default function App() {
  const webRef = useRef<WebView>(null);
  const [firstLoadDone, setFirstLoadDone] = useState(false);
  const [launchGone, setLaunchGone] = useState(false);
  const [errored, setErrored] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const canGoBack = useRef(false);
  const pushToken = useRef<string | null>(null);
  const launchFade = useRef(new Animated.Value(1)).current;

  // اكتمل أول تحميل ← شاشة الإقلاع تتلاشى بسرعة عن الرئيسية بدل الاختفاء المفاجئ
  useEffect(() => {
    if (!firstLoadDone || launchGone) return;
    Animated.timing(launchFade, {
      toValue: 0,
      duration: 240,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start(() => setLaunchGone(true));
  }, [firstLoadDone, launchGone, launchFade]);

  // إذن الموقع الأصلي مرة واحدة — كي ينجح navigator.geolocation داخل الويب فوراً
  useEffect(() => {
    if (!NEEDS_LOCATION) return;
    Location.requestForegroundPermissionsAsync().catch(() => {});
  }, []);

  /** حقن التوكن لصفحة الويب — تسجّله بجلستها الموثقة عبر /v1/customers/me/push-token */
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
            name: "تحديثات الطلب",
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
        /* الإشعارات تحسين — التطبيق يعمل بدونها */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [injectPushToken]);

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
            onLoadEnd={() => {
              setFirstLoadDone(true);
              injectPushToken(); // التوكن قد يسبق تحميل الصفحة أو تعاد بعد سحب-للتحديث
            }}
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

        {/* شاشة الإقلاع «القرطاس الماشي» — حتى انتهاء أول تحميل فقط (لا تومض في كل تنقّل) */}
        {!launchGone && !errored ? (
          <Animated.View
            style={[styles.launchOverlay, { opacity: launchFade }]}
            pointerEvents="none"
          >
            <LaunchWalk />
          </Animated.View>
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
  walkShadow: {
    width: 74,
    height: 10,
    borderRadius: 999,
    backgroundColor: "rgba(14,27,61,0.16)",
    marginTop: 4,
  },
  // محاذاة يسار فيزيائية عبر textAlign (لا تنقلب مع RTL) — العمود يتمدد لعرض أوسع سطر
  wordmark: { marginTop: 16 },
  wordmarkEn: { fontSize: 24, fontWeight: "800", color: LAUNCH_INK, textAlign: "left", lineHeight: 26 },
  wordmarkAr: { fontSize: 17, fontWeight: "700", color: LAUNCH_INK, textAlign: "left", lineHeight: 22, marginTop: 2 },
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
