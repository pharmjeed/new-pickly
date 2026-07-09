import { z } from "zod";

/** المبالغ بالهللة int — لا floats (docs/10§4) */
export const HalalaSchema = z.number().int().nonnegative();

/** جوال سعودي: 05XXXXXXXX أو +9665XXXXXXXX — يُطبَّع إلى صيغة E.164 */
export const SaudiPhoneSchema = z
  .string()
  .regex(/^(\+9665\d{8}|05\d{8})$/, "صيغة جوال سعودي: 05XXXXXXXX أو +9665XXXXXXXX")
  .transform((v) => (v.startsWith("05") ? `+966${v.slice(1)}` : v));

export const UuidSchema = z.string().uuid();

export const CoordsSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180)
});

/** ترقيم cursor — docs/11§0 */
export const CursorPageQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20)
});
export const cursorPageOf = <T extends z.ZodTypeAny>(item: T) =>
  z.object({
    items: z.array(item),
    next_cursor: z.string().nullable()
  });

/** Idempotency-Key إلزامي على كل POST مالي/إنشائي — docs/11§0 */
export const IdempotencyKeyHeaderSchema = z.object({
  "idempotency-key": z.string().min(8).max(128)
});
