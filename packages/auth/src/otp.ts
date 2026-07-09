import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

/** OTP — BR-13: حد محاولات وRate Limiting (يُنفَّذان في وحدة auth بالـAPI) */

export const OTP_TTL_SECONDS = 300;
export const OTP_RESEND_SECONDS = 60;
export const OTP_MAX_ATTEMPTS = 5;

export function generateOtpCode(): string {
  // رمز ثابت اختياري للتطوير فقط (OTP_DEV_FIXED_CODE) — يسهّل E2E
  const fixed = process.env.OTP_DEV_FIXED_CODE;
  if (fixed && process.env.NODE_ENV !== "production") return fixed;
  return String(randomInt(1000, 10000));
}

export function hashOtp(code: string): string {
  return createHash("sha256").update(`pickly-otp:${code}`).digest("hex");
}

export function verifyOtpHash(code: string, hash: string): boolean {
  const a = Buffer.from(hashOtp(code));
  const b = Buffer.from(hash);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function generateRefreshToken(): string {
  return randomBytes(48).toString("base64url");
}

export function hashRefreshToken(token: string): string {
  return createHash("sha256").update(`pickly-refresh:${token}`).digest("hex");
}

/** رمز التسليم 4 أرقام — BR-8 */
export function generateHandoffCode(): string {
  return String(randomInt(1000, 10000));
}
export function hashHandoffCode(code: string): string {
  return createHash("sha256").update(`pickly-handoff:${code}`).digest("hex");
}
