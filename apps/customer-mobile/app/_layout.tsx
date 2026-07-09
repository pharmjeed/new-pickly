/**
 * الجذر — Expo Router Stack.
 * RTL: النصوص عربية بالكامل؛ فرض I18nManager.forceRTL يتطلب إعادة تشغيل native
 * (يُفعَّل في dev build لاحقاً) — التخطيطات هنا مبنية لتقرأ صحيحاً في الحالتين.
 */
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { light } from "../src/theme";

export default function RootLayout() {
  return (
    <>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: light.bg }
        }}
      />
    </>
  );
}
