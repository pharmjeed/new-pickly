/** نداءات لوحة الأدمن — Bearer aw_token · هللات→ريال بأرقام لاتينية */

export const TOKEN_KEY = "aw_token";
export const THEME_KEY = "aw_theme";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
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

/** هللات → ريال بمنزلتين وأرقام لاتينية */
export function sar(halalas: number): string {
  return (halalas / 100).toFixed(2);
}

/** تاريخ ميلادي قصير بأرقام لاتينية */
export function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB");
}

/** تاريخ + وقت قصير بأرقام لاتينية */
export function shortDateTime(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString("en-GB")} ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
}

/** وقت قصير HH:mm:ss لاتيني — للخط الزمني */
export function shortTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
