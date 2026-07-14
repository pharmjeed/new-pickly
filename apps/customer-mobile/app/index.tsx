/**
 * P1: شاشة البداية + التهيئة.
 * عند الفتح: اللوقو سريعاً مع «خليك في السيارة وطلبك يجيك» ثم الانتقال
 * لقائمة المطاعم (أو شرائح التعريف الثلاث C-03 · J2 في أول استخدام).
 */
import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import * as Location from "expo-location";
import { LimeButton, GhostButton } from "../src/ui";
import { QirtasBadge } from "../src/qirtas";
import { colors, fs, light, radiusPill } from "../src/theme";
import { markOnboarded, wasOnboarded } from "../src/session";

const SPLASH_MS = 1500;

const SLIDES = [
  {
    title: "اطلب مسبقاً",
    sub: "اختر مطعمك وجهّز طلبك من جوالك — قبل ما تتحرك"
  },
  {
    title: "توجه إلى الفرع",
    sub: "انطلق وقت ما يناسبك — المطعم يجهّز طلبك على وقت وصولك"
  },
  {
    title: "استلم داخل سيارتك",
    sub: "خلّك في سيارتك، الباقي علينا — طلبك يوصلك لباب السيارة"
  }
] as const;

/** شاشة البداية — شارة القرطاس المبتسم + العبارة على خلفية ليمونية */
function SplashView() {
  return (
    <View style={st.splash}>
      <QirtasBadge size={128} />
      <Text style={st.splashName}>بيكلي</Text>
      <Text style={st.splashTag}>خليك في السيارة وطلبك يجيك</Text>
    </View>
  );
}

export default function Onboarding() {
  const [splashDone, setSplashDone] = useState(false);
  const [seen, setSeen] = useState<boolean | null>(null);
  const [slide, setSlide] = useState(0);
  // خطوة إذن الموقع — تظهر مرة واحدة بعد الشرائح عند أول فتح
  const [locStep, setLocStep] = useState(false);
  const [locBusy, setLocBusy] = useState(false);

  // اللوقو يظهر سريعاً ثم نُكمل — التحقق من التهيئة يجري بالتوازي
  useEffect(() => {
    const t = setTimeout(() => setSplashDone(true), SPLASH_MS);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    let alive = true;
    void wasOnboarded().then((v) => {
      if (alive) setSeen(v);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (splashDone && seen === true) router.replace("/(tabs)/home");
  }, [splashDone, seen]);

  if (!splashDone || seen === null || seen === true) return <SplashView />;

  const last = slide === SLIDES.length - 1;
  const s = SLIDES[slide]!;

  const finish = async () => {
    await markOnboarded();
    router.replace("/(tabs)/home");
  };

  // «ابدأ»/«تخطي» → خطوة الموقع أولاً — نطلب الإذن مرة واحدة عند أول فتح
  const start = () => setLocStep(true);

  const allowLocation = async () => {
    setLocBusy(true);
    try {
      await Location.requestForegroundPermissionsAsync();
    } catch {
      /* الموقع تحسين لا شرط — docs/14§8 */
    }
    await finish();
  };

  // شاشة إذن الموقع (أول فتح): نعرف مكانك لنعرض الأقرب ونتابع وصولك للفرع
  if (locStep) {
    return (
      <SafeAreaView style={st.screen}>
        <View style={st.body}>
          <View style={st.badge}>
            <QirtasBadge size={72} />
          </View>
          <Text style={st.locIcon}>📍</Text>
          <Text style={st.title}>خلّنا نعرف وين أنت</Text>
          <Text style={st.sub}>
            بموقعك نعرض لك أقرب المطاعم، ونتابع وصولك أثناء طلبك النشط —{"\n"}
            فيجهّز المطعم طلبك على وقت وصولك ويطلع لك لباب سيارتك.
          </Text>
          <Text style={[st.sub, st.locNote]}>موقعك يُستخدم أثناء الطلب النشط فقط ولا يُحتفظ بخامه.</Text>
        </View>
        <View style={st.foot}>
          <LimeButton
            title="السماح بمتابعة موقعي"
            disabled={locBusy}
            onPress={() => void allowLocation()}
          />
          <GhostButton title="ليس الآن" onPress={() => void finish()} style={{ marginTop: 8 }} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={st.screen}>
      <View style={st.body}>
        {/* شارة الهوية — القرطاس المبتسم */}
        <View style={st.badge}>
          <QirtasBadge size={72} />
        </View>

        <Text style={st.step}>{slide + 1} / 3</Text>
        <Text style={st.title}>{s.title}</Text>
        <Text style={st.sub}>{s.sub}</Text>

        <View style={st.dots}>
          {SLIDES.map((_, i) => (
            <View key={i} style={[st.dot, i === slide ? st.dotOn : null]} />
          ))}
        </View>
      </View>

      <View style={st.foot}>
        {last ? (
          <LimeButton title="ابدأ" onPress={() => void start()} />
        ) : (
          <>
            <LimeButton title="التالي" onPress={() => setSlide((v) => v + 1)} />
            <GhostButton title="تخطي" onPress={() => void start()} style={{ marginTop: 8 }} />
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  splash: {
    flex: 1,
    backgroundColor: colors.lime500,
    alignItems: "center",
    justifyContent: "center",
    gap: 14
  },
  splashName: {
    color: colors.ink900,
    fontSize: fs.fs32,
    fontWeight: "900",
    textAlign: "center"
  },
  splashTag: {
    color: colors.ink900,
    fontSize: fs.fs20,
    fontWeight: "700",
    textAlign: "center"
  },
  screen: { flex: 1, backgroundColor: light.bg },
  body: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  badge: { marginBottom: 32 },
  step: { color: light.text2, fontSize: fs.fs13, marginBottom: 8 },
  title: {
    color: light.text,
    fontSize: fs.fs32,
    fontWeight: "900",
    textAlign: "center",
    marginBottom: 10
  },
  sub: { color: light.text2, fontSize: fs.fs16, textAlign: "center", lineHeight: 26 },
  locIcon: { fontSize: 44, marginBottom: 12 },
  locNote: { fontSize: fs.fs13, marginTop: 14, opacity: 0.8 },
  dots: { flexDirection: "row", gap: 6, marginTop: 28 },
  dot: {
    width: 8,
    height: 8,
    borderRadius: radiusPill,
    backgroundColor: light.border
  },
  dotOn: { backgroundColor: colors.blue500, width: 22 },
  foot: { padding: 20, paddingBottom: 28 }
});
