import type { FastifyReply, FastifyRequest } from "fastify";
import { verifyAccessToken } from "@pickly/auth";
import type { JwtClaims } from "@pickly/contracts";
import { prisma } from "@pickly/database";
import { AppError } from "@pickly/observability";

/**
 * الإنفاذ بطبقتين — docs/16§3: الصلاحيات تُفحص هنا (API)،
 * والعزل يُنفَّذ في Repositories عبر تمرير نطاق الجلسة (merchant_id/branch_ids).
 */

declare module "fastify" {
  interface FastifyRequest {
    claims?: JwtClaims;
    staffBranchIds?: string[];
  }
}

export async function requireAuth(req: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) throw new AppError("AUTH-1005");
  let claims: JwtClaims;
  try {
    claims = verifyAccessToken(header.slice(7));
  } catch {
    throw new AppError("AUTH-1005");
  }
  // جلسات قابلة للإلغاء — docs/11§0
  const session = await prisma.userSession.findUnique({ where: { id: claims.session_id } });
  if (!session || session.revoked_at || session.expires_at < new Date()) {
    throw new AppError("AUTH-1005");
  }
  req.claims = claims;
}

export function requireCustomer(req: FastifyRequest): JwtClaims {
  const claims = req.claims;
  if (!claims) throw new AppError("AUTH-1005");
  // التاجر وطاقمه عملاء أيضاً بلا مانع (قرار المالك 2026-07-18)؛ حسابات الأدمن تبقى منفصلة
  if (claims.actor_type !== "customer" && claims.actor_type !== "merchant_staff") {
    throw new AppError("AUTH-1006");
  }
  return claims;
}

/** موظف فرع بدور مسموح — النطاق من staff_branch_assignments في التوكن */
export function requireStaff(req: FastifyRequest, allowedRoles: readonly string[]): JwtClaims {
  const claims = req.claims;
  if (!claims) throw new AppError("AUTH-1005");
  if (claims.actor_type !== "merchant_staff") throw new AppError("AUTH-1006");
  const ok = claims.roles.some((r) => allowedRoles.includes(r.replace(/^merchant:/, "")));
  if (!ok) throw new AppError("AUTH-1006");
  return claims;
}

/** يتحقق أن الفرع ضمن نطاق الموظف — BR-15 (MERCHANT-7003) */
export function assertBranchScope(claims: JwtClaims, branch_id: string): void {
  if (!claims.branch_ids?.includes(branch_id)) throw new AppError("MERCHANT-7003");
}

export function idempotencyKeyOf(req: FastifyRequest): string {
  const key = req.headers["idempotency-key"];
  if (typeof key !== "string" || key.length < 8) throw new AppError("PAY-5002");
  return key;
}
