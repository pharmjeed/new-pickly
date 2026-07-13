import { describe, expect, it } from "vitest";
import { effectiveProductPrice, isProductOnSale, type ProductSaleFields } from "./product-pricing.js";

/**
 * M-11 — عروض على الأصناف: السعر الفعّال هو سعر العرض إن كان سارياً وضمن النافذة،
 * وإلا السعر الأصلي. هذا المنطق هو المصدر الوحيد (BR-6) — يُستدعى في التسعير والكتالوج.
 */
const base = (over: Partial<ProductSaleFields> = {}): ProductSaleFields => ({
  price_halalas: 3200,
  sale_price_halalas: null,
  sale_starts_at: null,
  sale_ends_at: null,
  ...over
});

const NOW = new Date("2026-07-13T12:00:00Z");

describe("M-11 — effectiveProductPrice / isProductOnSale", () => {
  it("لا عرض حين sale_price_halalas = null → السعر الأصلي", () => {
    const p = base();
    expect(isProductOnSale(p, NOW)).toBe(false);
    expect(effectiveProductPrice(p, NOW)).toBe(3200);
  });

  it("عرض بلا نافذة → ساري ويُطبَّق سعر العرض", () => {
    const p = base({ sale_price_halalas: 2400 });
    expect(isProductOnSale(p, NOW)).toBe(true);
    expect(effectiveProductPrice(p, NOW)).toBe(2400);
  });

  it("سعر عرض ≥ السعر الأصلي لا يُعدّ عرضاً (حارس)", () => {
    expect(isProductOnSale(base({ sale_price_halalas: 3200 }), NOW)).toBe(false);
    expect(isProductOnSale(base({ sale_price_halalas: 4000 }), NOW)).toBe(false);
  });

  it("سعر عرض سالب مرفوض", () => {
    expect(isProductOnSale(base({ sale_price_halalas: -1 }), NOW)).toBe(false);
  });

  it("قبل بداية النافذة → غير ساري", () => {
    const p = base({ sale_price_halalas: 2400, sale_starts_at: new Date("2026-07-14T00:00:00Z") });
    expect(isProductOnSale(p, NOW)).toBe(false);
    expect(effectiveProductPrice(p, NOW)).toBe(3200);
  });

  it("بعد نهاية النافذة → غير ساري (عرض منتهٍ)", () => {
    const p = base({ sale_price_halalas: 2400, sale_ends_at: new Date("2026-07-13T06:00:00Z") });
    expect(isProductOnSale(p, NOW)).toBe(false);
    expect(effectiveProductPrice(p, NOW)).toBe(3200);
  });

  it("داخل النافذة [بداية، نهاية] → ساري", () => {
    const p = base({
      sale_price_halalas: 2400,
      sale_starts_at: new Date("2026-07-13T00:00:00Z"),
      sale_ends_at: new Date("2026-07-13T23:59:59Z")
    });
    expect(isProductOnSale(p, NOW)).toBe(true);
    expect(effectiveProductPrice(p, NOW)).toBe(2400);
  });
});
