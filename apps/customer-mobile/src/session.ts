/**
 * حالة الجلسة داخل التطبيق:
 * - السلة/التسعيرة في الذاكرة (رحلة واحدة لكل تشغيل)
 * - علم التهيئة وآخر طلب في SecureStore
 */
import * as SecureStore from "expo-secure-store";

const ONBOARDED_KEY = "pk_onboarded";
const LAST_ORDER_KEY = "pk_last_order";

let cartId: string | null = null;
let quoteId: string | null = null;

export function getCartId(): string | null {
  return cartId;
}
export function setCartId(id: string | null): void {
  cartId = id;
  if (id === null) quoteId = null;
}
export function getQuoteId(): string | null {
  return quoteId;
}
export function setQuoteId(id: string | null): void {
  quoteId = id;
}
export function clearCart(): void {
  cartId = null;
  quoteId = null;
}

export async function wasOnboarded(): Promise<boolean> {
  return (await SecureStore.getItemAsync(ONBOARDED_KEY)) === "1";
}
export async function markOnboarded(): Promise<void> {
  await SecureStore.setItemAsync(ONBOARDED_KEY, "1");
}

export async function getLastOrderId(): Promise<string | null> {
  return SecureStore.getItemAsync(LAST_ORDER_KEY);
}
export async function setLastOrderId(id: string): Promise<void> {
  await SecureStore.setItemAsync(LAST_ORDER_KEY, id);
}
