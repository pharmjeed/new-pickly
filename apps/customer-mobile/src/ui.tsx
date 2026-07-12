/**
 * مكوّنات مشتركة صغيرة — الألوان من theme.ts حصراً.
 * قاعدة: زر ليموني واحد لكل شاشة (LimeButton) · هدف لمس ≥ 44.
 */
import React, { useEffect, useRef } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle
} from "react-native";
import { colors, fs, light, motion, radius, radiusPill, shadow1, touch } from "./theme";

/** سهم واحد من موجة الأسهم الثلاثة — يضيء بدوره ثم يخفت (دورة 1.4ث بإزاحة delay) */
function WaveArrow({ delay }: { delay: number }) {
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
  return <Animated.Text style={[st.limeArrow, { opacity: v }]}>←</Animated.Text>;
}

/** الأسهم الثلاثة الموجّهة — موجة تلاشٍ باتجاه الإتمام (يسار)، بدرجات الخطوط الثلاثة */
function ArrowWave() {
  return (
    <View style={st.limeArrows} accessibilityElementsHidden>
      <WaveArrow delay={300} />
      <WaveArrow delay={150} />
      <WaveArrow delay={0} />
    </View>
  );
}

export function LimeButton({
  title,
  trailing,
  arrow,
  onPress,
  disabled,
  style
}: {
  title: string;
  trailing?: string;
  arrow?: boolean;
  onPress: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        st.lime,
        pressed && !disabled
          ? { backgroundColor: colors.lime300, transform: [{ scale: 0.98 }] }
          : null,
        disabled ? { opacity: 0.45 } : null,
        style
      ]}
    >
      <Text style={st.limeTxt}>{title}</Text>
      {arrow === true && <ArrowWave />}
      {trailing !== undefined && <Text style={st.limeTrail}>{trailing}</Text>}
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

export function ErrorNote({ text }: { text: string }) {
  return (
    <View style={st.err} accessibilityRole="alert">
      <Text style={st.errTxt}>{text}</Text>
    </View>
  );
}

export function Loader() {
  return (
    <View style={st.loader}>
      <ActivityIndicator color={colors.lime900} size="large" />
    </View>
  );
}

export type BadgeTone = "lime" | "warn" | "soft" | "ok" | "err";
export function Badge({ label, tone = "soft" }: { label: string; tone?: BadgeTone }) {
  const map: Record<BadgeTone, { bg: string; fg: string }> = {
    lime: { bg: colors.lime100, fg: colors.lime900 },
    warn: { bg: "#FCF0DB", fg: colors.warn },
    soft: { bg: light.bg, fg: colors.gray },
    ok: { bg: "#E2F3ED", fg: colors.success },
    err: { bg: "#FBE5E4", fg: colors.error }
  };
  const c = map[tone];
  return (
    <View style={[st.badge, { backgroundColor: c.bg }]}>
      <Text style={[st.badgeTxt, { color: c.fg }]}>{label}</Text>
    </View>
  );
}

const st = StyleSheet.create({
  lime: {
    minHeight: 52, // ≥ هدف اللمس 44
    backgroundColor: colors.lime500,
    borderRadius: radius,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingHorizontal: 18
  },
  limeTxt: { color: colors.ink900, fontSize: fs.fs16, fontWeight: "800" },
  limeArrows: { flexDirection: "row", alignItems: "center" },
  limeArrow: { color: colors.ink900, fontSize: fs.fs16, fontWeight: "800" },
  limeTrail: { color: colors.lime900, fontSize: fs.fs15, fontWeight: "700" },
  ghost: {
    minHeight: touch,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: light.border,
    backgroundColor: light.surface,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16
  },
  ghostTxt: { color: light.text, fontSize: fs.fs15, fontWeight: "600" },
  card: {
    backgroundColor: light.surface,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: light.border,
    padding: 14,
    ...shadow1
  },
  err: {
    backgroundColor: "#FBE5E4",
    borderRadius: radius,
    padding: 12,
    marginVertical: 8
  },
  errTxt: { color: colors.error, fontSize: fs.fs14, textAlign: "right" },
  loader: { paddingVertical: 32, alignItems: "center" },
  badge: {
    borderRadius: radiusPill,
    paddingHorizontal: 10,
    paddingVertical: 3,
    alignSelf: "flex-start"
  },
  badgeTxt: { fontSize: fs.fs12, fontWeight: "700" }
});
