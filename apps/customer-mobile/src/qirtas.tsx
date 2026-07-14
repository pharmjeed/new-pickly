/**
 * القرطاس المبتسم — كاركتر بيكلي الرسمي («اخر اخر هوية» v2.0) · نسخة React Native
 * مرآة لمكوّن qirtas.tsx في تطبيقات الويب — نفس الهندسة حرفياً عبر react-native-svg.
 *
 * قواعد ثابتة (كتاب الهوية §5): الوجه لا يُحذف، القاعدة المسنّنة لا تتغيّر،
 * الخطوط الوردية الثلاثة على يسار القرطاس بتلاشٍ ١٠٠/٥٥/٣٠٪، الميلان ٧° نحو الحركة.
 */
import { useEffect, useRef } from "react";
import { Animated, View, type ViewStyle } from "react-native";
import Svg, { Circle, G, Line, Path, Rect } from "react-native-svg";
import { colors, motion } from "./theme";

export type QirtasMood = "happy" | "excited" | "wink" | "sleepy" | "sad";

/** وجه القرطاس حسب المزاج — داخل مجموعة الميلان ٧° */
function Face({ mood, stroke }: { mood: QirtasMood; stroke: string }) {
  switch (mood) {
    case "excited":
      return (
        <>
          <Circle cx={144} cy={112} r={9} fill={stroke} />
          <Circle cx={176} cy={112} r={9} fill={stroke} />
          <Path d="M138 138 Q160 172 182 138 Z" fill={stroke} stroke={stroke} strokeWidth={6} strokeLinejoin="round" />
        </>
      );
    case "wink":
      return (
        <>
          <Path d="M134 112 L154 112" fill="none" stroke={stroke} strokeWidth={9} strokeLinecap="round" />
          <Circle cx={176} cy={112} r={7.5} fill={stroke} />
          <Path d="M142 140 Q160 160 178 140" fill="none" stroke={stroke} strokeWidth={9} strokeLinecap="round" />
        </>
      );
    case "sleepy":
      return (
        <>
          <Path d="M134 110 Q144 120 154 110" fill="none" stroke={stroke} strokeWidth={8} strokeLinecap="round" />
          <Path d="M166 110 Q176 120 186 110" fill="none" stroke={stroke} strokeWidth={8} strokeLinecap="round" />
          <Path d="M152 146 Q160 154 168 146" fill="none" stroke={stroke} strokeWidth={8} strokeLinecap="round" />
        </>
      );
    case "sad":
      return (
        <>
          <Circle cx={144} cy={112} r={7.5} fill={stroke} />
          <Circle cx={176} cy={112} r={7.5} fill={stroke} />
          <Path d="M142 156 Q160 138 178 156" fill="none" stroke={stroke} strokeWidth={9} strokeLinecap="round" />
        </>
      );
    default:
      return (
        <>
          <Circle cx={144} cy={112} r={7.5} fill={stroke} />
          <Circle cx={176} cy={112} r={7.5} fill={stroke} />
          <Path d="M142 140 Q160 160 178 140" fill="none" stroke={stroke} strokeWidth={9} strokeLinecap="round" />
        </>
      );
  }
}

/** جسم القرطاس (القاعدة المسنّنة + الغطاء) — هندسة الشعار حرفياً */
function Bag({ mood, stroke, fill }: { mood: QirtasMood; stroke: string; fill: string }) {
  return (
    <G rotation={7} origin="144, 124">
      <Path d="M88 84 L116 66 L102 42 Z" fill={fill} stroke={stroke} strokeWidth={7} strokeLinejoin="round" />
      <Path d="M88 84 L116 66 L116 192 L88 204 Z" fill={fill} stroke={stroke} strokeWidth={7} strokeLinejoin="round" />
      <Path
        d="M116 62 L200 62 L200 182 L189.5 196 L179 182 L168.5 196 L158 182 L147.5 196 L137 182 L126.5 196 L116 182 Z"
        fill={fill}
        stroke={stroke}
        strokeWidth={7}
        strokeLinejoin="round"
      />
      <Face mood={mood} stroke={stroke} />
    </G>
  );
}

function BadgeSpeedLines({ stroke }: { stroke: string }) {
  return (
    <G stroke={stroke} strokeWidth={11} strokeLinecap="butt">
      <Line x1={22} y1={94} x2={78} y2={94} />
      <Line x1={22} y1={126} x2={66} y2={126} opacity={0.55} />
      <Line x1={22} y1={158} x2={54} y2={158} opacity={0.3} />
    </G>
  );
}

/** الشارة الكاملة — الشعار الرسمي وأيقونة التطبيق */
export function QirtasBadge({ size = 64, mood = "happy" }: { size?: number; mood?: QirtasMood }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 240 240">
      <Rect x={0} y={0} width={240} height={240} rx={52} fill={colors.lime500} />
      <Rect x={5} y={5} width={230} height={230} rx={48} fill="none" stroke={colors.ink900} strokeWidth={7} />
      <BadgeSpeedLines stroke={colors.pink500} />
      <Bag mood={mood} stroke={colors.ink900} fill={colors.white} />
    </Svg>
  );
}

/** النسخة الأحادية المفرغة بلون واحد — فوق الداكن/الملوّن */
export function QirtasMono({ size = 24, mood = "happy", color = colors.ink900 }: { size?: number; mood?: QirtasMood; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 240 240">
      <Rect x={5} y={5} width={230} height={230} rx={48} fill="none" stroke={color} strokeWidth={7} />
      <BadgeSpeedLines stroke={color} />
      <Bag mood={mood} stroke={color} fill="none" />
    </Svg>
  );
}

/** القرطاس الحر — بلا شارة، للحالات الفارغة والأخطاء والاحتفالات */
export function Qirtas({
  size = 96,
  mood = "happy",
  lines = false,
  fill = colors.white
}: {
  size?: number;
  mood?: QirtasMood;
  lines?: boolean;
  fill?: string;
}) {
  const vb = lines ? "14 26 202 186" : "72 26 144 186";
  const vbW = lines ? 202 : 144;
  const vbH = 186;
  return (
    <Svg width={Math.round((size * vbW) / vbH)} height={size} viewBox={vb}>
      {lines && <BadgeSpeedLines stroke={colors.pink500} />}
      <Bag mood={mood} stroke={colors.ink900} fill={fill} />
    </Svg>
  );
}

/** نمط الخطوط الثلاثة الساكن — زخرفة وفاصل */
export function SpeedLines({ width = 50, color = colors.pink500 }: { width?: number; color?: string }) {
  const h = Math.round((width * 44) / 50);
  return (
    <Svg width={width} height={h} viewBox="0 0 50 44">
      <Rect x={8} y={8} width={34} height={7} fill={color} />
      <Rect x={8} y={19} width={27} height={7} fill={color} opacity={0.55} />
      <Rect x={8} y={30} width={20} height={7} fill={color} opacity={0.3} />
    </Svg>
  );
}

/** شريط وردي واحد نابض — لبنة المحمّل الرسمي */
function PulseBar({ width, delay }: { width: number; delay: number }) {
  const op = useRef(new Animated.Value(0.25)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(op, { toValue: 1, duration: 300, useNativeDriver: true }),
        Animated.timing(op, { toValue: 0.25, duration: 600, useNativeDriver: true })
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [op, delay]);
  return (
    <Animated.View
      style={{ width, height: 7, backgroundColor: colors.pink500, opacity: op }}
    />
  );
}

/** مؤشر التحميل الرسمي — الخطوط الوردية الثلاثة تتلألأ تتابعياً (كتاب الهوية §10) */
export function QirtasLoader({ size = 56, style }: { size?: number; style?: ViewStyle }) {
  const unit = size / 50;
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel="جارٍ التحميل"
      style={[{ gap: Math.round(4 * unit), alignItems: "flex-start" }, style]}
    >
      <PulseBar width={Math.round(34 * unit)} delay={0} />
      <PulseBar width={Math.round(27 * unit)} delay={200} />
      <PulseBar width={Math.round(20 * unit)} delay={400} />
    </View>
  );
}

/* ملاحظة الحركة: مدة النبضة من motion.duration×1.5 تقريباً — ضمن نطاق الهوية 150–250ms للعناصر */
export const loaderEase = motion.ease;
