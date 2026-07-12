/**
 * السلة اندمجت مع الإتمام في صفحة واحدة (قرار المالك 2026-07-12) —
 * /cart يحوّل دائماً إلى /checkout حفاظاً على الروابط القديمة.
 */
import { Redirect } from "expo-router";

export default function CartRedirect() {
  return <Redirect href="/checkout" />;
}
