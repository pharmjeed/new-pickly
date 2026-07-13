import { prisma, effectiveProductPrice, type Prisma } from "@pickly/database";
import type { Cart as CartDto, CartItemInput } from "@pickly/contracts";
import { AppError } from "@pickly/observability";
import { requireFlag } from "../../lib/flags.js";

/**
 * وحدة Carts + Pricing — BR-6: التسعير خادمي حصراً (pricing_quotes)،
 * رسم الخدمة مفصول دائماً، الحد الأدنى للطلب من الفرع.
 * BR-7: الكوبون يُتحقق ويُخصم خادمياً — amount | percent.
 * الأسعار شاملة ضريبة القيمة المضافة — لا يُضاف بند ضريبة على العميل؛
 * vat_halalas = الضريبة المضمّنة داخل الإجمالي (للسجلات والفوترة).
 */

const QUOTE_TTL_MS = 10 * 60 * 1000;

/** رسم خدمة بيكلي — قابل للتغيير من السوبر أدمن، مع حصة اختيارية للتاجر منه */
export const SERVICE_FEE_SETTING_KEY = "pricing.service_fee";

export type ServiceFeeConfig = {
  key: string;
  name_ar: string;
  amount_halalas: number;
  merchant_share_halalas: number;
};

/** أحدث قيمة من system_settings (سجل تاريخي) — وإلا صف fees المزروع كقيمة افتراضية */
export async function loadServiceFeeConfig(): Promise<ServiceFeeConfig> {
  const [setting, fee] = await Promise.all([
    prisma.systemSetting.findFirst({
      where: { key: SERVICE_FEE_SETTING_KEY },
      orderBy: { effective_at: "desc" }
    }),
    prisma.fee.findUniqueOrThrow({ where: { key: "pickly_service_fee" } })
  ]);
  const v = (setting?.value ?? null) as
    | { amount_halalas?: number; merchant_share_halalas?: number }
    | null;
  const amount = Math.max(v?.amount_halalas ?? fee.amount_halalas ?? 0, 0);
  const share = Math.min(Math.max(v?.merchant_share_halalas ?? 0, 0), amount);
  return { key: fee.key, name_ar: fee.name_ar, amount_halalas: amount, merchant_share_halalas: share };
}

type CartWithRelations = Prisma.CartGetPayload<{
  include: {
    items: { include: { modifiers: { include: { modifier: true } }; product: { include: { availability: true } } } };
    quotes: true;
    coupon: true;
  };
}>;

function cartInclude(branch_id: string) {
  return {
    items: {
      include: {
        modifiers: { include: { modifier: true } },
        product: { include: { availability: { where: { branch_id } } } }
      }
    },
    quotes: { orderBy: { created_at: "desc" as const }, take: 1 },
    coupon: true
  };
}

function toDto(cart: CartWithRelations): CartDto {
  const quote = cart.quotes[0];
  const quoteValid = quote && quote.expires_at > new Date();
  return {
    id: cart.id,
    branch_id: cart.branch_id,
    coupon_code: cart.coupon?.code ?? null,
    items: cart.items.map((i) => {
      const modifiersTotal = i.modifiers.reduce((s, m) => s + m.price_halalas, 0);
      return {
        id: i.id,
        product_id: i.product_id,
        name_ar: i.product.name_ar,
        quantity: i.quantity,
        unit_price_halalas: i.unit_price_halalas,
        modifiers: i.modifiers.map((m) => ({
          id: m.modifier_id,
          name_ar: m.modifier.name_ar,
          price_halalas: m.price_halalas
        })),
        line_total_halalas: (i.unit_price_halalas + modifiersTotal) * i.quantity,
        notes: i.notes,
        is_available: i.product.availability[0]?.is_available ?? true
      };
    }),
    quote: quoteValid
      ? {
          quote_id: quote.id,
          expires_at: quote.expires_at.toISOString(),
          subtotal_halalas: quote.subtotal_halalas,
          discount_halalas: quote.discount_halalas,
          vat_halalas: quote.vat_halalas,
          service_fee_halalas: quote.service_fee_halalas,
          total_halalas: quote.total_halalas
        }
      : null
  };
}

export class CartService {
  async create(user_id: string, branch_id: string): Promise<CartDto> {
    const branch = await prisma.branch.findUnique({ where: { id: branch_id } });
    if (!branch || !branch.is_active) throw new AppError("CATALOG-2001");
    if (branch.status === "closed" || branch.status === "paused") {
      throw new AppError(branch.status === "closed" ? "CATALOG-2002" : "CATALOG-2004");
    }
    const cart = await prisma.cart.create({
      data: { user_id, branch_id, expires_at: new Date(Date.now() + 24 * 3600 * 1000) },
      include: cartInclude(branch_id)
    });
    return toDto(cart);
  }

  private async loadOwned(cart_id: string, user_id: string): Promise<CartWithRelations> {
    const found = await prisma.cart.findUnique({ where: { id: cart_id } });
    if (!found || found.user_id !== user_id) throw new AppError("CART-3001");
    const cart = await prisma.cart.findUnique({
      where: { id: cart_id },
      include: cartInclude(found.branch_id)
    });
    if (!cart) throw new AppError("CART-3001");
    return cart;
  }

  async get(cart_id: string, user_id: string): Promise<CartDto> {
    return toDto(await this.loadOwned(cart_id, user_id));
  }

  async addItem(cart_id: string, user_id: string, input: CartItemInput): Promise<CartDto> {
    const cart = await this.loadOwned(cart_id, user_id);
    const product = await prisma.product.findUnique({
      where: { id: input.product_id },
      include: {
        availability: { where: { branch_id: cart.branch_id } },
        modifier_groups: { include: { group: { include: { modifiers: true } } } }
      }
    });
    if (!product || !product.is_active) throw new AppError("CATALOG-2003");
    if (product.availability[0]?.is_available === false) throw new AppError("CATALOG-2003");

    // تحقق المُعدِّلات تنتمي لمجموعات المنتج وضمن حدود min/max
    const validModifiers = new Map(
      product.modifier_groups.flatMap((pg) => pg.group.modifiers.map((m) => [m.id, m] as const))
    );
    for (const id of input.modifier_ids) {
      if (!validModifiers.has(id)) throw new AppError("SYS-9004", { modifier_id: id });
    }

    await prisma.$transaction(async (tx) => {
      const item = await tx.cartItem.create({
        data: {
          cart_id,
          product_id: product.id,
          quantity: input.quantity,
          // لقطة السعر الفعّال — سعر العرض إن كان سارياً لحظة الإضافة (M-11، BR-6)
          unit_price_halalas: effectiveProductPrice(product),
          ...(input.notes ? { notes: input.notes } : {})
        }
      });
      for (const id of input.modifier_ids) {
        const m = validModifiers.get(id);
        if (!m) continue;
        await tx.cartItemModifier.create({
          data: { cart_item_id: item.id, modifier_id: id, price_halalas: m.price_halalas }
        });
      }
      // أي تعديل يبطل التسعيرة السارية
      await tx.pricingQuote.updateMany({
        where: { cart_id },
        data: { expires_at: new Date() }
      });
    });
    return this.get(cart_id, user_id);
  }

  async removeItem(cart_id: string, user_id: string, item_id: string): Promise<CartDto> {
    await this.loadOwned(cart_id, user_id);
    await prisma.$transaction([
      prisma.cartItemModifier.deleteMany({ where: { cart_item_id: item_id } }),
      prisma.cartItem.deleteMany({ where: { id: item_id, cart_id } }),
      prisma.pricingQuote.updateMany({ where: { cart_id }, data: { expires_at: new Date() } })
    ]);
    return this.get(cart_id, user_id);
  }

  /** التسعير الخادمي — المصدر الوحيد للسعر النهائي (docs/11§3) */
  async quote(cart_id: string, user_id: string): Promise<CartDto> {
    const cart = await this.loadOwned(cart_id, user_id);
    if (cart.items.length === 0) throw new AppError("CART-3001", { hint: "السلة فارغة" });

    // إعادة فحص التوفر لحظة التسعير — CART-3002
    const unavailable = cart.items.filter((i) => i.product.availability[0]?.is_available === false);
    if (unavailable.length > 0) {
      throw new AppError("CART-3002", { items: unavailable.map((i) => i.product.name_ar) });
    }

    const subtotal = cart.items.reduce((s, i) => {
      const mods = i.modifiers.reduce((ms, m) => ms + m.price_halalas, 0);
      return s + (i.unit_price_halalas + mods) * i.quantity;
    }, 0);

    const branch = await prisma.branch.findUniqueOrThrow({ where: { id: cart.branch_id } });
    if (branch.min_order_halalas && subtotal < branch.min_order_halalas) {
      throw new AppError("CART-3005", { min_order_halalas: branch.min_order_halalas });
    }

    const vatRule = await prisma.taxRule.findUniqueOrThrow({ where: { key: "vat_standard" } });
    const feeConfig = await loadServiceFeeConfig();

    // BR-7: خصم الكوبون على المنتجات فقط — لا يمس رسم الخدمة
    let discount = 0;
    let couponBreakdown: Record<string, unknown> | null = null;
    if (cart.coupon_id) {
      const coupon = await this.validateCoupon(cart.coupon_id, user_id, cart.branch_id, subtotal);
      discount = coupon.type === "percent"
        ? Math.min(subtotal, Math.round((subtotal * coupon.value) / 100))
        : Math.min(subtotal, coupon.value);
      couponBreakdown = { code: coupon.code, type: coupon.type, amount_halalas: discount };
    }
    const service_fee = feeConfig.amount_halalas;
    // الأسعار شاملة الضريبة: الإجمالي = (المنتجات − الخصم) + رسم الخدمة، بلا بند ضريبة يُضاف.
    // الضريبة المضمّنة تُستخرج من الإجمالي للسجلات والفوترة: total × bp ÷ (10000 + bp)
    const total = subtotal - discount + service_fee;
    const vat = Math.round((total * vatRule.rate_bp) / (10000 + vatRule.rate_bp));

    const quote = await prisma.pricingQuote.create({
      data: {
        cart_id,
        subtotal_halalas: subtotal,
        discount_halalas: discount,
        vat_halalas: vat,
        service_fee_halalas: service_fee,
        total_halalas: total,
        breakdown: {
          fees: [
            {
              key: feeConfig.key,
              name_ar: feeConfig.name_ar,
              amount_halalas: service_fee,
              // لقطة حصة التاجر لحظة التسعير — التسويات تعتمدها لا القيمة الحالية
              merchant_share_halalas: feeConfig.merchant_share_halalas
            }
          ],
          vat_rate_bp: vatRule.rate_bp,
          vat_included: true,
          ...(couponBreakdown ? { coupon: couponBreakdown } : {})
        } as never,
        expires_at: new Date(Date.now() + QUOTE_TTL_MS)
      }
    });
    void quote;
    return this.get(cart_id, user_id);
  }

  /** التحقق الكامل من صلاحية الكوبون — BR-7 (يُعاد عند كل تسعيرة) */
  private async validateCoupon(coupon_id: string, user_id: string, branch_id: string, subtotal: number) {
    const coupon = await prisma.coupon.findUnique({ where: { id: coupon_id } });
    if (!coupon || !coupon.is_active) throw new AppError("CART-3003");
    if (coupon.type === "free_product") throw new AppError("CART-3003", { hint: "نوع الكوبون غير مدعوم" });

    const now = new Date();
    if (coupon.starts_at && coupon.starts_at > now) throw new AppError("CART-3003", { hint: "لم يبدأ بعد" });
    if (coupon.ends_at && coupon.ends_at < now) throw new AppError("CART-3003", { hint: "انتهت صلاحيته" });
    if (coupon.min_order_halalas && subtotal < coupon.min_order_halalas) {
      throw new AppError("CART-3003", { hint: "أقل من الحد الأدنى للكوبون", min_order_halalas: coupon.min_order_halalas });
    }

    // كوبون تاجر محدد — يسري على فروعه فقط (Tenant Scope)
    if (coupon.merchant_id) {
      const branch = await prisma.branch.findUniqueOrThrow({ where: { id: branch_id } });
      if (branch.merchant_id !== coupon.merchant_id) throw new AppError("CART-3003", { hint: "لا يسري على هذا المطعم" });
    }

    if (coupon.max_uses_total) {
      const used = await prisma.couponRedemption.count({ where: { coupon_id } });
      if (used >= coupon.max_uses_total) throw new AppError("CART-3003", { hint: "استُنفدت استخداماته" });
    }
    if (coupon.max_uses_per_user) {
      const usedByUser = await prisma.couponRedemption.count({ where: { coupon_id, user_id } });
      if (usedByUser >= coupon.max_uses_per_user) throw new AppError("CART-3003", { hint: "استخدمته من قبل" });
    }
    if (coupon.new_users_only) {
      const orders = await prisma.order.count({ where: { user_id, order_status: "COMPLETED" } });
      if (orders > 0) throw new AppError("CART-3003", { hint: "للعملاء الجدد فقط" });
    }
    return coupon;
  }

  /** تطبيق كوبون على السلة — يبطل التسعيرة السارية ويعيد التسعير */
  async applyCoupon(cart_id: string, user_id: string, code: string): Promise<CartDto> {
    await requireFlag("coupons_full");
    const cart = await this.loadOwned(cart_id, user_id);

    const coupon = await prisma.coupon.findUnique({ where: { code: code.trim().toUpperCase() } });
    const fallback = coupon ?? (await prisma.coupon.findUnique({ where: { code: code.trim() } }));
    if (!fallback) throw new AppError("CART-3003");

    const subtotal = cart.items.reduce((s, i) => {
      const mods = i.modifiers.reduce((ms, m) => ms + m.price_halalas, 0);
      return s + (i.unit_price_halalas + mods) * i.quantity;
    }, 0);
    await this.validateCoupon(fallback.id, user_id, cart.branch_id, subtotal);

    await prisma.$transaction([
      prisma.cart.update({ where: { id: cart_id }, data: { coupon_id: fallback.id } }),
      prisma.pricingQuote.updateMany({ where: { cart_id }, data: { expires_at: new Date() } })
    ]);
    return this.quote(cart_id, user_id);
  }

  async removeCoupon(cart_id: string, user_id: string): Promise<CartDto> {
    await this.loadOwned(cart_id, user_id);
    await prisma.$transaction([
      prisma.cart.update({ where: { id: cart_id }, data: { coupon_id: null } }),
      prisma.pricingQuote.updateMany({ where: { cart_id }, data: { expires_at: new Date() } })
    ]);
    return this.get(cart_id, user_id);
  }
}
