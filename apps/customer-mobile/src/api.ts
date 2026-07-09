/**
 * عميل API للتطبيق — نفس endpoints ويب العميل حرفياً.
 * - القاعدة قابلة للضبط عبر Constants.expoConfig.extra.apiUrl
 *   (الافتراضي: 10.0.2.2:4000 لإميوليتر أندرويد · localhost:4000 لغيره)
 * - التوكنات في SecureStore
 * - غلاف الخطأ الموحد { error: { code, message_ar } }
 * - Idempotency-Key عند الطلب · لا Content-Type بلا body
 */
import Constants from "expo-constants";
import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

const extra = (Constants.expoConfig?.extra ?? {}) as { apiUrl?: string | null };

export const API_BASE: string =
  typeof extra.apiUrl === "string" && extra.apiUrl.length > 0
    ? extra.apiUrl
    : Platform.OS === "android"
      ? "http://10.0.2.2:4000"
      : "http://localhost:4000";

const ACCESS_KEY = "pk_access";
const REFRESH_KEY = "pk_refresh";

let accessToken: string | null | undefined; // undefined = لم يُقرأ من SecureStore بعد

export async function getToken(): Promise<string | null> {
  if (accessToken === undefined) {
    accessToken = await SecureStore.getItemAsync(ACCESS_KEY);
  }
  return accessToken;
}

export async function setTokens(access: string, refresh: string): Promise<void> {
  accessToken = access;
  await SecureStore.setItemAsync(ACCESS_KEY, access);
  await SecureStore.setItemAsync(REFRESH_KEY, refresh);
}

export async function clearTokens(): Promise<void> {
  accessToken = null;
  await SecureStore.deleteItemAsync(ACCESS_KEY);
  await SecureStore.deleteItemAsync(REFRESH_KEY);
}

export class ApiError extends Error {
  constructor(
    public code: string,
    public message_ar: string,
    public status: number
  ) {
    super(message_ar);
  }
}

/** RFC4122 v4 — بلا اعتماد على crypto.randomUUID (غير مضمون في RN) */
function uuid(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export async function api<T>(
  method: string,
  path: string,
  body?: unknown,
  opts: { idempotent?: boolean } = {}
): Promise<T> {
  const headers: Record<string, string> = {};
  // لا Content-Type بلا body — Fastify يرفض JSON فارغاً
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const token = await getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (opts.idempotent) headers["Idempotency-Key"] = uuid();

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {})
    });
  } catch {
    throw new ApiError("NET-0001", "تعذر الاتصال بالخادم — تأكد من الشبكة", 0);
  }

  if (!res.ok) {
    let code = "SYS-9001";
    let msg = "خطأ غير متوقع";
    try {
      const data = (await res.json()) as { error?: { code: string; message_ar: string } };
      if (data.error) {
        code = data.error.code;
        msg = data.error.message_ar;
      }
    } catch {
      /* غلاف غير قياسي */
    }
    throw new ApiError(code, msg, res.status);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** المبالغ بأرقام لاتينية دائماً */
export const fmtSar = (halalas: number): string => `${(halalas / 100).toFixed(2)} ر.س`;
