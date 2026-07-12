import { prisma } from "./index.js";

/**
 * توليد فترات الاستلام المجدول (BR-5) من دوام الأسبوع branch_hours:
 * التاجر يحدد أيام العمل وساعاتها مرة واحدة، والفترات تتولّد للأيام القادمة —
 * من واجهة الحفظ فوراً، ومن الـworker دورياً (تجديد متدحرج).
 * كل الأوقات بتوقيت الرياض (+03) بغضّ النظر عن منطقة الخادم الزمنية.
 */

export type WeeklyWindow = { day_of_week: number; opens_at: string; closes_at: string };

const RIYADH_OFFSET_MS = 3 * 3600_000;
const DAY_MS = 86_400_000;

/** تاريخ اليوم (YYYY-MM-DD) بتوقيت الرياض للحظة المعطاة */
export function riyadhDateISO(at: Date): string {
  return new Date(at.getTime() + RIYADH_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * بدايات/نهايات الفترات للأيام القادمة من قالب الدوام — بدايات مستقبلية فقط.
 * إغلاق قبل وقت الفتح = دوام يمتد بعد منتصف الليل (مثل 18:00 → 02:00).
 */
export function buildWeeklySlots(opts: {
  windows: WeeklyWindow[];
  slotMinutes: number;
  daysAhead?: number;
  now?: Date;
}): { start: Date; end: Date }[] {
  const now = opts.now ?? new Date();
  const daysAhead = opts.daysAhead ?? 7;
  const slotMs = opts.slotMinutes * 60_000;
  const out: { start: Date; end: Date }[] = [];
  const seen = new Set<number>();

  for (let offset = 0; offset < daysAhead; offset++) {
    const dateISO = riyadhDateISO(new Date(now.getTime() + offset * DAY_MS));
    const dow = new Date(`${dateISO}T00:00:00Z`).getUTCDay(); // 0=الأحد كما في branch_hours
    for (const w of opts.windows) {
      if (w.day_of_week !== dow) continue;
      const opens = new Date(`${dateISO}T${w.opens_at}:00+03:00`);
      let closes = new Date(`${dateISO}T${w.closes_at}:00+03:00`);
      if (closes <= opens) closes = new Date(closes.getTime() + DAY_MS);
      for (let t = opens.getTime(); t + slotMs <= closes.getTime(); t += slotMs) {
        if (t <= now.getTime() || seen.has(t)) continue;
        seen.add(t);
        out.push({ start: new Date(t), end: new Date(t + slotMs) });
      }
    }
  }
  return out.sort((a, b) => a.start.getTime() - b.start.getTime());
}

/**
 * هل الفترة [start, end] تقع كاملة داخل إحدى نوافذ دوام الأسبوع؟
 * تُفحص نافذتا يوم الفترة واليوم السابق (بتوقيت الرياض) لتغطية دوام يمتد بعد منتصف الليل.
 * تُستخدم لقصّ الفترات المعروضة للعميل على دوام الفرع الحالي حتى لو بقيت
 * فترات مولّدة من دوام قديم في branch_capacity_slots.
 */
export function slotWithinWeeklyWindows(start: Date, end: Date, windows: WeeklyWindow[]): boolean {
  for (const dayOffset of [0, -1]) {
    const dateISO = riyadhDateISO(new Date(start.getTime() + dayOffset * DAY_MS));
    const dow = new Date(`${dateISO}T00:00:00Z`).getUTCDay(); // 0=الأحد كما في branch_hours
    for (const w of windows) {
      if (w.day_of_week !== dow) continue;
      const opens = new Date(`${dateISO}T${w.opens_at}:00+03:00`);
      let closes = new Date(`${dateISO}T${w.closes_at}:00+03:00`);
      if (closes <= opens) closes = new Date(closes.getTime() + DAY_MS);
      if (start >= opens && end <= closes) return true;
    }
  }
  return false;
}

/**
 * upsert فترات الفرع من القالب — (branch_id, slot_start) فريد:
 * القائمة تُحدَّث سعتها دون مساس بالمحجوز، والجديدة تُنشأ. يعيد عدد الفترات المعالجة.
 */
export async function generateBranchSlotsFromTemplate(opts: {
  branch_id: string;
  windows: WeeklyWindow[];
  slotMinutes: number;
  capacity: number;
  daysAhead?: number;
  now?: Date;
}): Promise<number> {
  const slots = buildWeeklySlots(opts);
  for (const s of slots) {
    await prisma.branchCapacitySlot.upsert({
      where: { branch_id_slot_start: { branch_id: opts.branch_id, slot_start: s.start } },
      create: { branch_id: opts.branch_id, slot_start: s.start, slot_end: s.end, capacity: opts.capacity },
      update: { slot_end: s.end, capacity: opts.capacity }
    });
  }
  return slots.length;
}
