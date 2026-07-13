/**
 * السعر الفعّال للصنف مع مراعاة عرض العرض (M-11).
 * المصدر الوحيد لقرار «هل الصنف عليه عرض الآن؟» وللسعر المُطبَّق — يُستدعى في
 * التسعير الخادمي (BR-6) وكتالوج العميل. لا تُكرّر هذا المنطق في أي واجهة.
 */

export interface ProductSaleFields {
  price_halalas: number;
  sale_price_halalas: number | null;
  sale_starts_at: Date | null;
  sale_ends_at: Date | null;
}

/** هل للصنف عرض ساري في اللحظة `now`؟ يشترط سعر عرض موجب أقل من الأصلي وضمن النافذة. */
export function isProductOnSale(p: ProductSaleFields, now: Date = new Date()): boolean {
  if (p.sale_price_halalas == null) return false;
  if (p.sale_price_halalas < 0 || p.sale_price_halalas >= p.price_halalas) return false;
  if (p.sale_starts_at && p.sale_starts_at > now) return false;
  if (p.sale_ends_at && p.sale_ends_at < now) return false;
  return true;
}

/** السعر المُطبَّق فعلياً: سعر العرض إن كان سارياً، وإلا السعر الأصلي. */
export function effectiveProductPrice(p: ProductSaleFields, now: Date = new Date()): number {
  return isProductOnSale(p, now) ? (p.sale_price_halalas as number) : p.price_halalas;
}
