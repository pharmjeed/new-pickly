/**
 * تشفير اللوحة الكاملة (حروف + أرقام) — AES-256-GCM (docs/10§1 · docs/17).
 * المفتاح من PLATE_ENC_KEY (أو JWT_SECRET احتياطاً) عبر SHA-256.
 * الصيغة المخزنة: base64(iv[12] | authTag[16] | cipher).
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const key = (): Buffer =>
  createHash("sha256")
    .update(process.env.PLATE_ENC_KEY ?? process.env.JWT_SECRET ?? "pickly-dev-plate-key")
    .digest();

export function encryptPlate(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString("base64");
}

/** فك تشفير متسامح: أي تلف/مفتاح مختلف يعيد null بدل رمي خطأ (بيانات قديمة) */
export function decryptPlate(payload: string | null): string | null {
  if (!payload) return null;
  try {
    const buf = Buffer.from(payload, "base64");
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const data = buf.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", key(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
