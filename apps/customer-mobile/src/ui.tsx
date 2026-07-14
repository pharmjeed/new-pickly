/**
 * مكوّنات مشتركة صغيرة — الهوية الفنكية v2.0: حدود كحلية سميكة + ظل صلب مُزاح.
 * الألوان من theme.ts حصراً · الزر الرئيسي أزرق، والليموني محجوز للدفع/الوصول/النجاح
 * (مرّر lime على LimeButton) · هدف لمس ≥ 48.
 */
import React, { useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle
} from "react-native";
import { QirtasLoader, QirtasMono } from "./qirtas";
import {
  bw2,
  colors,
  fs,
  light,
  motion,
  popSm,
  popXs,
  radius,
  radiusMd,
  radiusPill,
  statusColors,
  touch
} from "./theme";

/** سهم واحد من موجة الأسهم الثلاثة — يضيء بدوره ثم يخفت (دورة 1.4ث بإزاحة delay) */
function WaveArrow({ delay, color }: { delay: number; color: string }) {
  const v = useRef(new Animated.Value(motion.fade3)).current;
  useEffect(() => {
    let loop: Animated.CompositeAnimation | null = null;
    let cancelled = false;
    void AccessibilityInfo.isReduceMotionEnabled().then((reduce) => {
      if (cancelled) return;
      if (reduce) {
        v.setValue(motion.fade2);
        return;
      }
      loop = Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(v, { toValue: motion.fade1, duration: 350, useNativeDriver: true }),
          Animated.timing(v, { toValue: motion.fade3, duration: 350, useNativeDriver: true }),
          Animated.delay(700 - delay)
        ])
      );
      loop.start();
    });
    return () => {
      cancelled = true;
      loop?.stop();
    };
  }, [v, delay]);
  return <Animated.Text style={[st.btnArrow, { opacity: v, color }]}>←</Animated.Text>;
}

/** الأسهم الثلاثة الموجّهة — موجة تلاشٍ باتجاه الإتمام (يسار)، بدرجات الخطوط الثلاثة */
function ArrowWave({ color }: { color: string }) {
  return (
    <View style={st.btnArrows} accessibilityElementsHidden>
      <WaveArrow delay={300} color={color} />
      <WaveArrow delay={150} color={color} />
      <WaveArrow delay={0} color={color} />
    </View>
  );
}

const CAR_W = 64; // عرض السيارة مع خطوط السرعة

/** سيارة بيكلي — تنطلق عبر الزر يساراً (اتجاه السير) وخلفها خطوط السرعة الوردية الثلاثة.
 *  المقدمة لليسار: الكبوت منخفض أماماً والمقصورة للخلف. تختفي مع «تقليل الحركة». */
function CarDrive() {
  const [laneW, setLaneW] = useState(0);
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (laneW <= 0) return;
    let loop: Animated.CompositeAnimation | null = null;
    let cancelled = false;
    void AccessibilityInfo.isReduceMotionEnabled().then((reduce) => {
      if (reduce || cancelled) return;
      loop = Animated.loop(
        Animated.sequence([
          Animated.delay(1900),
          Animated.timing(t, {
            toValue: 1,
            duration: 2400,
            easing: Easing.linear,
            useNativeDriver: true
          }),
          Animated.timing(t, { toValue: 0, duration: 0, useNativeDriver: true })
        ])
      );
      loop.start();
    });
    return () => {
      cancelled = true;
      loop?.stop();
    };
  }, [t, laneW]);
  return (
    <View
      pointerEvents="none"
      style={st.carLane}
      onLayout={(e) => setLaneW(e.nativeEvent.layout.width)}
    >
      {laneW > 0 && (
        <Animated.View
          style={[
            st.car,
            {
              transform: [
                {
                  translateX: t.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, -(laneW + CAR_W * 2)]
                  })
                }
              ]
            }
          ]}
        >
          <View style={st.carShape}>
            <View style={st.carRoof} />
            <View style={st.carBody} />
            <View style={[st.carWheel, { left: 5 }]} />
            <View style={[st.carWheel, { right: 5 }]} />
          </View>
          <View style={st.carTrail}>
            <View style={[st.trailLine, { width: 14, opacity: motion.fade1 }]} />
            <View style={[st.trailLine, { width: 10, opacity: motion.fade2 }]} />
            <View style={[st.trailLine, { width: 6, opacity: motion.fade3 }]} />
          </View>
        </Animated.View>
      )}
    </View>
  );
}

/**
 * الزر الرئيسي الفنكي — أزرق صارخ بنص أبيض افتراضاً؛
 * مرّر lime للدفع/«وصلت»/النجاح حصراً (ليموني بنص كحلي).
 * الضغط: ينزلق فوق ظله الصلب (translate 4,4 + إخفاء الظل).
 */
export function LimeButton({
  title,
  trailing,
  arrow,
  car,
  lime,
  onPress,
  disabled,
  style
}: {
  title: string;
  trailing?: string;
  arrow?: boolean;
  car?: boolean;
  lime?: boolean;
  onPress: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const fg = lime === true ? colors.ink900 : colors.white;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        st.btn,
        lime === true ? st.btnLime : null,
        pressed && !disabled ? st.btnPressed : null,
        disabled ? { opacity: 0.45 } : null,
        style
      ]}
    >
      <Text style={[st.btnTxt, { color: fg }]}>{title}</Text>
      {arrow === true && <ArrowWave color={fg} />}
      {trailing !== undefined && <Text style={[st.btnTrail, { color: fg }]}>{trailing}</Text>}
      {car === true && <CarDrive />}
    </Pressable>
  );
}

export function GhostButton({
  title,
  onPress,
  disabled,
  style,
  textStyle
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      style={[st.ghost, disabled ? { opacity: 0.45 } : null, style]}
    >
      <Text style={[st.ghostTxt, textStyle]}>{title}</Text>
    </Pressable>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[st.card, style]}>{children}</View>;
}

/** ملاحظة الخطأ — مع القرطاس الحزين المصغّر (أحادي بلون الخطأ) */
export function ErrorNote({ text }: { text: string }) {
  return (
    <View style={st.err} accessibilityRole="alert">
      <QirtasMono mood="sad" size={26} color={colors.error} />
      <Text style={st.errTxt}>{text}</Text>
    </View>
  );
}

/** المحمّل الرسمي — الخطوط الوردية الثلاثة تتلألأ (بديل الـspinner الدوار) */
export function Loader() {
  return (
    <View style={st.loader}>
      <QirtasLoader />
    </View>
  );
}

export type BadgeTone = "lime" | "warn" | "soft" | "ok" | "err";
export function Badge({ label, tone = "soft" }: { label: string; tone?: BadgeTone }) {
  const map: Record<BadgeTone, { bg: string; fg: string }> = {
    lime: { bg: colors.lime100, fg: colors.ink900 },
    warn: { bg: statusColors.arrivedBg, fg: colors.ink900 },
    soft: { bg: light.bg, fg: colors.ink600 },
    ok: { bg: statusColors.doneBg, fg: colors.success },
    err: { bg: statusColors.overdueBg, fg: colors.error }
  };
  const c = map[tone];
  return (
    <View style={[st.badge, { backgroundColor: c.bg }]}>
      <Text style={[st.badgeTxt, { color: c.fg }]}>{label}</Text>
    </View>
  );
}

const st = StyleSheet.create({
  btn: {
    minHeight: 52, // ≥ هدف اللمس 48
    backgroundColor: colors.blue500,
    borderRadius: radius + 2, // 14 — زوايا الأزرار الفنكية
    borderWidth: bw2,
    borderColor: colors.ink900,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingHorizontal: 18,
    ...popSm
  },
  btnLime: { backgroundColor: colors.lime500 },
  btnPressed: {
    // ينزلق فوق ظله — توقيع الضغط الفنكي
    transform: [{ translateX: 4 }, { translateY: 4 }],
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0,
    elevation: 0
  },
  btnTxt: { fontSize: fs.fs16, fontWeight: "800" },
  btnArrows: { flexDirection: "row", alignItems: "center" },
  btnArrow: { fontSize: fs.fs16, fontWeight: "800" },
  carLane: { ...StyleSheet.absoluteFillObject, borderRadius: radius, overflow: "hidden" },
  car: {
    position: "absolute",
    bottom: 3,
    right: -CAR_W,
    flexDirection: "row",
    alignItems: "center",
    gap: 4
  },
  carShape: { width: 38, height: 18 },
  carBody: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 7,
    height: 6,
    borderRadius: 3,
    borderTopLeftRadius: 5, // الكبوت المنخفض — المقدمة لليسار
    backgroundColor: colors.ink900
  },
  carRoof: {
    position: "absolute",
    top: 2,
    right: 5,
    width: 16,
    height: 7,
    borderTopLeftRadius: 7, // الزجاج الأمامي المائل نحو المقدمة
    borderTopRightRadius: 3,
    backgroundColor: colors.ink900
  },
  carWheel: {
    position: "absolute",
    bottom: 0,
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: colors.ink900,
    borderWidth: 1.5,
    borderColor: colors.white
  },
  carTrail: { flexDirection: "column", gap: 3 },
  trailLine: {
    // خطوط السرعة الوردية الثلاثة — مستقيمة بلا انحراف (skew أُلغي من الهوية)
    height: 2,
    borderRadius: 1,
    backgroundColor: colors.pink500
  },
  btnTrail: { fontSize: fs.fs15, fontWeight: "700" },
  ghost: {
    minHeight: touch,
    borderRadius: radius + 2,
    borderWidth: bw2,
    borderColor: colors.ink900,
    backgroundColor: light.surface,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16
  },
  ghostTxt: { color: colors.ink900, fontSize: fs.fs15, fontWeight: "800" },
  card: {
    backgroundColor: light.surface,
    borderRadius: radiusMd,
    borderWidth: bw2,
    borderColor: colors.ink900,
    padding: 14,
    ...popXs
  },
  err: {
    backgroundColor: statusColors.overdueBg,
    borderWidth: bw2,
    borderColor: colors.error,
    borderRadius: radius,
    padding: 12,
    marginVertical: 8,
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 10
  },
  errTxt: { color: colors.error, fontSize: fs.fs14, textAlign: "right", flex: 1 },
  loader: { paddingVertical: 32, alignItems: "center" },
  badge: {
    borderRadius: radiusPill,
    borderWidth: bw2,
    borderColor: colors.ink900,
    paddingHorizontal: 10,
    paddingVertical: 3,
    alignSelf: "flex-start"
  },
  badgeTxt: { fontSize: fs.fs12, fontWeight: "700" }
});
