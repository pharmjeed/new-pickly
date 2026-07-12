/**
 * نسخة البناء الحالية — يستطلعها العميل (version-watch) ليكتشف نشراً جديداً
 * ويحدّث الصفحة قبل أن تنكسر بطلب chunks قديمة اختفت مع النسخة الجديدة.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const dynamic = "force-dynamic";

let cached: string | null = null;

export function GET(): Response {
  if (cached === null) {
    try {
      cached = readFileSync(join(process.cwd(), ".next", "BUILD_ID"), "utf8").trim();
    } catch {
      cached = "dev"; // بيئة التطوير بلا BUILD_ID — قيمة ثابتة لا تُطلق تحديثاً
    }
  }
  return Response.json({ build_id: cached });
}
