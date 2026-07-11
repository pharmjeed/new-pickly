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

/**
 * تجديد الجلسة عند انتهاء توكن الوصول (15 د) عبر توكن التجديد الدوّار (30 يوماً منزلقة).
 * Promise واحد مشترك — طلبات 401 متزامنة لا تحرق توكن التجديد (يُلغى عند أول تدوير).
 */
let refreshing: Promise<boolean> | null = null;

function tryRefresh(): Promise<boolean> {
  refreshing ??= (async () => {
    try {
      const refresh_token = await SecureStore.getItemAsync(REFRESH_KEY);
      if (!refresh_token) return false;
      const res = await fetch(`${API_BASE}/v1/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token })
      });
      if (!res.ok) return false;
      const data = (await res.json()) as { access_token: string; refresh_token: string };
      await setTokens(data.access_token, data.refresh_token);
      return true;
    } catch {
      return false;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
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
  // مفتاح idempotency يثبت عبر إعادة المحاولة بعد التجديد — نفس العملية، لا عملية ثانية
  const idemKey = opts.idempotent ? uuid() : undefined;

  const attempt = async (): Promise<Response> => {
    const headers: Record<string, string> = {};
    // لا Content-Type بلا body — Fastify يرفض JSON فارغاً
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const token = await getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    if (idemKey) headers["Idempotency-Key"] = idemKey;
    return fetch(`${API_BASE}${path}`, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {})
    });
  };

  let res: Response;
  try {
    res = await attempt();
  } catch {
    throw new ApiError("NET-0001", "تعذر الاتصال بالخادم — تأكد من الشبكة", 0);
  }

  // توكن الوصول انتهى — جدّد بصمت وأعد المحاولة مرة واحدة
  if (res.status === 401 && (await getToken())) {
    if (await tryRefresh()) {
      try {
        res = await attempt();
      } catch {
        throw new ApiError("NET-0001", "تعذر الاتصال بالخادم — تأكد من الشبكة", 0);
      }
    } else {
      // توكن التجديد نفسه انتهى/أُلغي — الشاشات تعرض تسجيل الدخول لغياب التوكن
      await clearTokens();
    }
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
