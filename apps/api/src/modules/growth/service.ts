import { prisma, type Prisma } from "@pickly/database";
import { GrowthSettingsSchema, type GrowthSettings } from "@pickly/contracts";
import { AppError } from "@pickly/observability";
import { flagEnabled } from "../../lib/flags.js";
import { walletBalance } from "../../lib/payment-methods.js";

/**
 * وحدة النمو: نقاط المكافآت (C-63) + دعوة الأصدقاء (قرار المالك 2026-07-19).
 * النقاط اكتساب وعرض فقط — الاستبدال مؤجل (docs/01§2)؛ مكافأة الدعوة تُصرف
 * رصيد محفظة للطرفين مرة واحدة عند أول طلب مكتمل للمدعو (ختم referral_rewarded_at).
 */

export const DEFAULT_GROWTH_SETTINGS: GrowthSettings = {
  points_per_sar: 1,
  referrer_reward_halalas: 1500,
  friend_reward_halalas: 1000
};

/** أحدث إعدادات سارية — system_settings:growth.rewards سجل تاريخي كبقية الإعدادات */
export async function growthSettings(): Promise<GrowthSettings> {
  const setting = await prisma.systemSetting.findFirst({
    where: { key: "growth.rewards", effective_at: { lte: new Date() } },
    orderBy: { effective_at: "desc" }
  });
  const parsed = GrowthSettingsSchema.safeParse(setting?.value);
  return parsed.success ? parsed.data : DEFAULT_GROWTH_SETTINGS;
}

/** حروف الكود بلا ملتبسات (لا O/0 ولا I/1) — يُقرأ من الشاشة ويُملى هاتفياً */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function randomCode(len = 6): string {
  let out = "";
  for (let i = 0; i < len; i++) out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return out;
}

/** كود الدعوة الدائم للعميل — يُولَّد عند أول فتح للصفحة ويثبت بعدها */
export async function ensureReferralCode(user_id: string): Promise<string> {
  const profile = await prisma.customerProfile.findUnique({ where: { user_id } });
  if (profile?.referral_code) return profile.referral_code;

  await prisma.customerProfile.upsert({ where: { user_id }, create: { user_id }, update: {} });
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomCode();
    try {
      // شرط referral_code=null يمنع سباق طلبين من استبدال كود ثبت للتو
      await prisma.customerProfile.updateMany({
        where: { user_id, referral_code: null },
        data: { referral_code: code }
      });
      const fresh = await prisma.customerProfile.findUniqueOrThrow({ where: { user_id } });
      if (fresh.referral_code) return fresh.referral_code;
    } catch {
      // تصادم على unique مع عميل آخر — أعد التوليد
    }
  }
  throw new AppError("SYS-9004", { hint: "تعذر توليد كود الدعوة — حاول لاحقاً" });
}

/** إدخال كود صديق — مرة واحدة، قبل أول طلب مكتمل، ولا يُقبل كود العميل نفسه */
export async function redeemReferralCode(user_id: string, code: string): Promise<void> {
  const referrerProfile = await prisma.customerProfile.findUnique({
    where: { referral_code: code }
  });
  if (!referrerProfile || referrerProfile.user_id === user_id) {
    throw new AppError("SYS-9004", { hint: "كود الدعوة غير صحيح" });
  }

  const [myProfile, completedOrders] = await Promise.all([
    prisma.customerProfile.findUnique({ where: { user_id } }),
    prisma.order.count({ where: { user_id, order_status: "COMPLETED" } })
  ]);
  if (myProfile?.referred_by_user_id) {
    throw new AppError("SYS-9004", { hint: "سبق تسجيل كود دعوة لحسابك" });
  }
  if (completedOrders > 0) {
    throw new AppError("SYS-9004", { hint: "كود الدعوة للعملاء الجدد قبل أول طلب" });
  }

  await prisma.customerProfile.upsert({
    where: { user_id },
    create: { user_id, referred_by_user_id: referrerProfile.user_id },
    update: { referred_by_user_id: referrerProfile.user_id }
  });
}

/**
 * منح النمو عند اكتمال الطلب — يُستدعى داخل معاملة completeHandoff نفسها.
 * آلة الحالات تمنع دخول COMPLETED مرتين، والفحوص الداخلية صمام أمان إضافي.
 */
export async function awardOrderGrowth(tx: Prisma.TransactionClient, order_id: string): Promise<void> {
  const order = await tx.order.findUniqueOrThrow({
    where: { id: order_id },
    select: { user_id: true, total_halalas: true, display_code: true }
  });
  if (!order.user_id) return;
  const user_id = order.user_id;
  const settings = await growthSettings();

  // ===== نقاط المكافآت: نقاط لكل ريال مدفوع =====
  if (await flagEnabled("loyalty_points")) {
    const points = Math.floor(order.total_halalas / 100) * settings.points_per_sar;
    if (points > 0) {
      const already = await tx.loyaltyTransaction.findFirst({
        where: { account: { user_id }, order_id }
      });
      if (!already) {
        await tx.loyaltyAccount.upsert({
          where: { user_id },
          create: { user_id, points },
          update: { points: { increment: points } }
        });
        await tx.loyaltyTransaction.create({
          data: {
            account_id: user_id,
            points,
            reason: `طلب ${order.display_code}`,
            order_id
          }
        });
      }
    }
  }

  // ===== مكافأة الدعوة: أول طلب مكتمل للمدعو يصرفها للطرفين =====
  if (await flagEnabled("referral_program")) {
    const profile = await tx.customerProfile.findUnique({ where: { user_id } });
    if (profile?.referred_by_user_id && !profile.referral_rewarded_at) {
      if (settings.friend_reward_halalas > 0) {
        await tx.customerWalletEntry.create({
          data: {
            user_id,
            amount_halalas: settings.friend_reward_halalas,
            entry_type: "credit",
            reference: "referral:welcome"
          }
        });
      }
      if (settings.referrer_reward_halalas > 0) {
        await tx.customerWalletEntry.create({
          data: {
            user_id: profile.referred_by_user_id,
            amount_halalas: settings.referrer_reward_halalas,
            entry_type: "credit",
            reference: "referral:reward"
          }
        });
      }
      await tx.customerProfile.update({
        where: { user_id },
        data: { referral_rewarded_at: new Date() }
      });
    }
  }
}

/** ملخص المكافآت للعميل — GET /me/rewards */
export async function customerRewards(user_id: string) {
  const [settings, account, transactions] = await Promise.all([
    growthSettings(),
    prisma.loyaltyAccount.findUnique({ where: { user_id } }),
    prisma.loyaltyTransaction.findMany({
      where: { account_id: user_id },
      orderBy: { created_at: "desc" },
      take: 50
    })
  ]);
  return {
    points: account?.points ?? 0,
    points_per_sar: settings.points_per_sar,
    transactions: transactions.map((t) => ({
      id: t.id,
      points: t.points,
      reason: t.reason,
      order_id: t.order_id,
      created_at: t.created_at.toISOString()
    }))
  };
}

/** ملخص الدعوة للعميل — GET /me/referral */
export async function customerReferral(user_id: string) {
  const [code, settings, myProfile, invited, rewarded, completedOrders] = await Promise.all([
    ensureReferralCode(user_id),
    growthSettings(),
    prisma.customerProfile.findUnique({
      where: { user_id },
      include: { referred_by: { include: { customer_profile: { select: { referral_code: true } } } } }
    }),
    prisma.customerProfile.count({ where: { referred_by_user_id: user_id } }),
    prisma.customerProfile.count({
      where: { referred_by_user_id: user_id, referral_rewarded_at: { not: null } }
    }),
    prisma.order.count({ where: { user_id, order_status: "COMPLETED" } })
  ]);
  return {
    code,
    referrer_reward_halalas: settings.referrer_reward_halalas,
    friend_reward_halalas: settings.friend_reward_halalas,
    invited_count: invited,
    rewarded_count: rewarded,
    can_redeem: !myProfile?.referred_by_user_id && completedOrders === 0,
    redeemed_code: myProfile?.referred_by?.customer_profile?.referral_code ?? null
  };
}

/** رصيد محفظة — إعادة تصدير للاستخدام في ملف العميل بالأدمن */
export { walletBalance };
