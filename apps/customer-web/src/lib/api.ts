"use client";

/**
 * عميل API — الأنواع من @pickly/contracts هي المرجع؛
 * هنا نستخدم أنواعاً بنيوية مطابقة لتفادي حزم عبر الحدود في الشريحة.
 * (التطبيقات النهائية في مرحلتي 3–4 تستورد @pickly/contracts مباشرة.)
 */

const BASE = "/api";

export function getToken(): string | null {
  return typeof window === "undefined" ? null : localStorage.getItem("pk_access");
}
export function setTokens(access: string, refresh: string): void {
  localStorage.setItem("pk_access", access);
  localStorage.setItem("pk_refresh", refresh);
}

/** crypto.randomUUID غير متوفرة خارج السياقات الآمنة (نشر HTTP) — بديل RFC4122 v4 عبر getRandomValues */
function uuid(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x40;
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
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

export async function api<T>(
  method: string,
  path: string,
  body?: unknown,
  opts: { idempotent?: boolean } = {}
): Promise<T> {
  const headers: Record<string, string> = {};
  // لا Content-Type بلا body — Fastify يرفض JSON فارغاً
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (opts.idempotent) headers["Idempotency-Key"] = uuid();

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  });

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

export const fmtSar = (halalas: number): string =>
  `${(halalas / 100).toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ر.س`;
