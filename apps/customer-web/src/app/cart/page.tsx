/**
 * السلة اندمجت مع الإتمام في صفحة واحدة (قرار المالك 2026-07-12) —
 * /cart يحوّل دائماً إلى /checkout حفاظاً على الروابط القديمة.
 */
import { redirect } from "next/navigation";

export default function CartRedirect() {
  redirect("/checkout");
}
