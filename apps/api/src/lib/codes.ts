import { createHmac, randomInt } from "node:crypto";

/** كود العرض P-XXXX — لاتيني دائماً (README §5) */
export function generateDisplayCode(): string {
  return `P-${randomInt(1000, 10000)}`;
}

/**
 * رمز التسليم 4 أرقام — BR-8.
 * مشتق حتمياً بـHMAC من order_id: لا تخزين نصي، قابل لإعادة الحساب
 * لعرضه للعميل وللتحقق من إدخال الموظف.
 */
export function handoffCodeFor(orderId: string): string {
  const secret = process.env.JWT_SECRET ?? "dev-only-change-me";
  const digest = createHmac("sha256", `handoff:${secret}`).update(orderId).digest();
  const num = digest.readUInt32BE(0) % 10000;
  return String(num).padStart(4, "0");
}
