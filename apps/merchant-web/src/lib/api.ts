/** نداءات بوابة التاجر — Bearer mw_token · هللات→ريال بأرقام لاتينية */

export const TOKEN_KEY = "mw_token";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

/** يحذف توكن الجلسة — يُستدعى عند 401 لكسر حلقة إعادة التوجيه مع صفحة الدخول */
export function clearToken(): void {
  if (typeof window !== "undefined") localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function parseError(res: Response): Promise<never> {
  let message = "تعذر تنفيذ الطلب";
  try {
    const data = (await res.json()) as { error?: { message_ar?: string; message?: string } };
    message = data.error?.message_ar ?? data.error?.message ?? message;
  } catch {
    /* جسم غير JSON */
  }
  throw new ApiError(message, res.status);
}

/** GET بهيدر Authorization فقط (لا Content-Type بلا body) */
export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(path, {
    headers: { Authorization: `Bearer ${getToken() ?? ""}` }
  });
  if (!res.ok) return parseError(res);
  return (await res.json()) as T;
}

/** POST مع body — Content-Type يوضع فقط لوجود body */
export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getToken() ?? ""}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) return parseError(res);
  return (await res.json()) as T;
}

/** PATCH مع body — لتعديل الأصناف */
export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${getToken() ?? ""}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) return parseError(res);
  return (await res.json()) as T;
}

/** DELETE — لحذف الأصناف */
export async function apiDelete<T>(path: string): Promise<T> {
  const res = await fetch(path, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${getToken() ?? ""}` }
  });
  if (!res.ok) return parseError(res);
  return (await res.json()) as T;
}

/** هللات → ريال بمنزلتين وأرقام لاتينية */
export function sar(halalas: number): string {
  return (halalas / 100).toFixed(2);
}

/** ثوانٍ → م:ثث */
export function minSec(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
