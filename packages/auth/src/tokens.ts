import jwt from "jsonwebtoken";
import { JwtClaimsSchema, type JwtClaims } from "@pickly/contracts";

/** Bearer JWT — جلسات قابلة للإلغاء (docs/11§0): الإلغاء عبر revoked_at في user_sessions */

export type SignClaims = Omit<JwtClaims, "iat" | "exp">;

function secret(): string {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error("JWT_SECRET غير مضبوط");
  if (process.env.NODE_ENV === "production" && s === "dev-only-change-me") {
    throw new Error("JWT_SECRET الافتراضي ممنوع في الإنتاج");
  }
  return s;
}

export function signAccessToken(claims: SignClaims): string {
  const expiresIn = (process.env.JWT_ACCESS_TTL ?? "15m") as NonNullable<
    jwt.SignOptions["expiresIn"]
  >;
  return jwt.sign(claims, secret(), { expiresIn });
}

export function verifyAccessToken(token: string): JwtClaims {
  const decoded = jwt.verify(token, secret());
  return JwtClaimsSchema.parse(decoded);
}
