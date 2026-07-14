/**
 * P2: المصادقة — Stepper واحد: جوال ← OTP ← الاسم (C-05→C-07).
 * نفس endpoints الويب: /v1/auth/otp/request · /v1/auth/otp/verify · PATCH /v1/customers/me
 * رمز التطوير: 1234 (OTP_DEV_FIXED_CODE).
 */
import { useEffect, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { api, setTokens } from "../src/api";
import { ErrorNote, GhostButton, LimeButton } from "../src/ui";
import { QirtasBadge } from "../src/qirtas";
import { bw2, colors, fs, light, radius, touch } from "../src/theme";

const RESEND_SECONDS = 47;

export default function AuthScreen() {
  const params = useLocalSearchParams<{ next?: string }>();
  const next = typeof params.next === "string" && params.next.length > 0 ? params.next : "/(tabs)/home";

  const [step, setStep] = useState<"phone" | "otp" | "name">("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);

  // عدّاد إعادة الإرسال (C-06: «إعادة الإرسال بعد 00:47»)
  useEffect(() => {
    if (step !== "otp" || resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((v) => v - 1), 1000);
    return () => clearTimeout(t);
  }, [step, resendIn]);

  const goNext = () => {
    // next مسار داخلي (مثل /restaurant/{id}) — التوجيه الصريح يكفي في الطيار
    router.replace(next as never);
  };

  const requestOtp = async () => {
    setBusy(true);
    setError(null);
    try {
      await api("POST", "/v1/auth/otp/request", { phone });
      setStep("otp");
      setCode("");
      setResendIn(RESEND_SECONDS);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ access_token: string; refresh_token: string; is_new_user: boolean }>(
        "POST",
        "/v1/auth/otp/verify",
        { phone, code }
      );
      await setTokens(res.access_token, res.refresh_token);
      if (res.is_new_user) setStep("name");
      else goNext();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const saveName = async () => {
    setBusy(true);
    setError(null);
    try {
      await api("PATCH", "/v1/customers/me", { full_name: name });
      goNext();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={st.screen}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        {/* ===== C-05: رقم الجوال ===== */}
        {step === "phone" && (
          <View style={st.center}>
            <View style={st.logoBadge}>
              <QirtasBadge size={84} />
            </View>
            <Text style={st.hero}>خلّك في سيارتك —{"\n"}طلبك يجيك</Text>

            <View style={st.fld}>
              <Text style={st.label}>رقم الجوال</Text>
              <View style={st.row}>
                <Text style={st.prefix}>+966</Text>
                <TextInput
                  style={[st.inp, st.mono, error ? st.inpErr : null]}
                  placeholder="05XXXXXXXX"
                  placeholderTextColor={colors.gray}
                  keyboardType="phone-pad"
                  autoFocus
                  value={phone}
                  onChangeText={setPhone}
                />
              </View>
            </View>
            {error && <ErrorNote text={error} />}

            <LimeButton
              title="متابعة"
              disabled={busy || phone.length < 10}
              onPress={() => void requestOtp()}
              style={{ alignSelf: "stretch", marginTop: 8 }}
            />
            <GhostButton
              title="المتابعة كزائر للتصفح"
              onPress={() => router.replace("/(tabs)/home")}
              style={{ alignSelf: "stretch", marginTop: 12 }}
            />
            <Text style={st.foot}>
              تصفح بحرية — تحتاج حساباً عند الدفع فقط.{"\n"}بمتابعتك توافق على الشروط وسياسة الخصوصية
            </Text>
          </View>
        )}

        {/* ===== C-06: رمز التحقق OTP ===== */}
        {step === "otp" && (
          <View style={st.body}>
            <Pressable style={st.back} onPress={() => setStep("phone")} accessibilityRole="button">
              <Text style={st.backTxt}>‹ رجوع</Text>
            </Pressable>
            <Text style={st.title}>رمز التحقق</Text>
            <Text style={st.muted}>
              أرسلنا رمزاً إلى <Text style={[st.mono, st.strong]}>{phone}</Text> — رمز التطوير 1234
            </Text>

            <TextInput
              style={[st.inp, st.mono, st.otp, error ? st.inpErr : null]}
              keyboardType="number-pad"
              autoFocus
              maxLength={6}
              value={code}
              onChangeText={(v) => setCode(v.replace(/\D/g, "").slice(0, 6))}
            />
            {error && <ErrorNote text={error} />}

            <View style={{ alignItems: "center", marginVertical: 8 }}>
              {resendIn > 0 ? (
                <Text style={st.muted}>
                  إعادة الإرسال بعد <Text style={st.mono}>00:{String(resendIn).padStart(2, "0")}</Text>
                </Text>
              ) : (
                <GhostButton title="إعادة إرسال الرمز" disabled={busy} onPress={() => void requestOtp()} />
              )}
            </View>

            <LimeButton title="تأكيد" disabled={busy || code.length < 4} onPress={() => void verify()} />
            <Text style={st.foot}>لا تشارك الرمز مع أي أحد — موظفو بيكلي لا يطلبونه أبداً</Text>
          </View>
        )}

        {/* ===== C-07: إكمال الملف ===== */}
        {step === "name" && (
          <View style={st.body}>
            <Text style={st.title}>أكمل ملفك</Text>
            <View style={st.fld}>
              <Text style={st.label}>الاسم *</Text>
              <TextInput
                style={[st.inp, error ? st.inpErr : null]}
                placeholder="اسمك الأول يكفي"
                placeholderTextColor={colors.gray}
                autoFocus
                value={name}
                onChangeText={setName}
              />
              <Text style={st.hint}>يظهر لموظف الاستلام عند تسليم طلبك</Text>
            </View>
            {error && <ErrorNote text={error} />}
            <LimeButton
              title="إنشاء الحساب"
              disabled={busy || name.length < 2}
              onPress={() => void saveName()}
            />
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  screen: { flex: 1, backgroundColor: light.bg },
  center: { flex: 1, justifyContent: "center", padding: 24 },
  body: { flex: 1, padding: 24, paddingTop: 16 },
  logoBadge: { alignSelf: "center", marginBottom: 20 },
  hero: {
    color: light.text,
    fontSize: fs.fs24,
    fontWeight: "900",
    textAlign: "center",
    marginBottom: 24,
    lineHeight: 34
  },
  title: {
    color: light.text,
    fontSize: fs.fs24,
    fontWeight: "900",
    textAlign: "right",
    marginBottom: 8
  },
  back: { minHeight: touch, justifyContent: "center", alignSelf: "flex-start" },
  backTxt: { color: light.text2, fontSize: fs.fs15 },
  fld: { marginBottom: 10 },
  label: { color: light.text, fontSize: fs.fs14, fontWeight: "700", textAlign: "right", marginBottom: 6 },
  row: { flexDirection: "row-reverse", gap: 8, alignItems: "center" },
  prefix: { color: light.text2, fontSize: fs.fs16, fontVariant: ["tabular-nums"] },
  inp: {
    flexGrow: 1,
    minHeight: touch + 4,
    backgroundColor: light.surface,
    borderWidth: bw2,
    borderColor: colors.ink900,
    borderRadius: radius,
    paddingHorizontal: 14,
    fontSize: fs.fs16,
    color: light.text,
    textAlign: "right"
  },
  inpErr: { borderColor: colors.error },
  mono: { fontVariant: ["tabular-nums"], letterSpacing: 1 },
  strong: { color: light.text, fontWeight: "800" },
  otp: {
    textAlign: "center",
    fontSize: fs.fs24,
    letterSpacing: 12,
    marginTop: 12,
    marginBottom: 4
  },
  muted: { color: light.text2, fontSize: fs.fs14, textAlign: "right", marginBottom: 8 },
  hint: { color: light.text2, fontSize: fs.fs12, textAlign: "right", marginTop: 4 },
  foot: {
    color: light.text2,
    fontSize: fs.fs12,
    textAlign: "center",
    marginTop: 16,
    lineHeight: 20
  }
});
