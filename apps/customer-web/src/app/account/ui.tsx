"use client";

/**
 * مشتركات صفحات الحساب C-59: رأس فرعي بعودة، صفوف تنقّل، أيقونات خطية بأسلوب shell،
 * وأوصاف قيود المحفظة — كل الألوان رموز من tokens.css حصراً.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "../shell";
import styles from "./account.module.css";

/* ===== أيقونات خطية إضافية (نفس أسلوب P3 في shell) ===== */

export const IWallet = ({ size = 18 }: { size?: number }) => (
  <Icon size={size}>
    <rect x="16" y="30" width="68" height="46" rx="10" />
    <path d="M24,30 L66,16 L70,30" />
    <circle cx="68" cy="53" r="5" fill="currentColor" stroke="none" />
  </Icon>
);
export const IStarCoin = ({ size = 18 }: { size?: number }) => (
  <Icon size={size}>
    <circle cx="50" cy="50" r="34" />
    <path d="M50,32 L55,45 L69,45 L58,54 L62,68 L50,59 L38,68 L42,54 L31,45 L45,45 Z" />
  </Icon>
);
export const ICoupon = ({ size = 18 }: { size?: number }) => (
  <Icon size={size}>
    <path d="M16,34 H84 V46 C78,46 78,54 84,54 V66 H16 V54 C22,54 22,46 16,46 Z" />
    <path d="M44,42 L58,58 M46,44 h0 M56,56 h0" />
  </Icon>
);
export const ISend = ({ size = 18 }: { size?: number }) => (
  <Icon size={size}>
    <path d="M84,20 L16,46 L42,56 L52,82 L84,20 Z" />
    <path d="M42,56 L60,38" />
  </Icon>
);
export const IGift = ({ size = 18 }: { size?: number }) => (
  <Icon size={size}>
    <rect x="20" y="42" width="60" height="40" rx="6" />
    <path d="M16,30 H84 V42 H16 Z M50,30 V82" />
    <path d="M50,30 C40,30 30,24 36,16 C42,10 50,20 50,30 C50,20 58,10 64,16 C70,24 60,30 50,30 Z" />
  </Icon>
);
export const IGlobe = ({ size = 18 }: { size?: number }) => (
  <Icon size={size}>
    <circle cx="50" cy="50" r="32" />
    <path d="M18,50 H82 M50,18 C38,30 38,70 50,82 C62,70 62,30 50,18 Z" />
  </Icon>
);
export const IGear = ({ size = 18 }: { size?: number }) => (
  <Icon size={size}>
    <circle cx="50" cy="50" r="14" />
    <path d="M50,18 V30 M50,70 V82 M18,50 H30 M70,50 H82 M28,28 L36,36 M64,64 L72,72 M72,28 L64,36 M36,64 L28,72" />
  </Icon>
);
export const IHeadset = ({ size = 18 }: { size?: number }) => (
  <Icon size={size}>
    <path d="M22,58 V50 C22,32 34,20 50,20 C66,20 78,32 78,50 V58" />
    <rect x="16" y="56" width="14" height="22" rx="7" />
    <rect x="70" y="56" width="14" height="22" rx="7" />
    <path d="M78,74 C78,82 68,86 58,86" />
  </Icon>
);
export const IShield = ({ size = 18 }: { size?: number }) => (
  <Icon size={size}>
    <path d="M50,16 L80,28 C80,54 70,74 50,84 C30,74 20,54 20,28 Z" />
    <path d="M38,50 L47,59 L64,40" />
  </Icon>
);
export const ICardIcon = ({ size = 18 }: { size?: number }) => (
  <Icon size={size}>
    <rect x="14" y="26" width="72" height="48" rx="8" />
    <path d="M14,40 H86 M24,60 H44" />
  </Icon>
);
export const IPencil = ({ size = 16 }: { size?: number }) => (
  <Icon size={size}>
    <path d="M62,20 L80,38 L38,80 L18,84 L22,62 Z" />
    <path d="M54,28 L72,46" />
  </Icon>
);
export const ICopy = ({ size = 16 }: { size?: number }) => (
  <Icon size={size}>
    <rect x="34" y="34" width="46" height="46" rx="8" />
    <path d="M22,64 V22 C22,20 24,18 26,18 H64" />
  </Icon>
);
export const ITrash = ({ size = 16 }: { size?: number }) => (
  <Icon size={size}>
    <path d="M24,32 H76 M40,32 V24 H60 V32 M30,32 L34,82 H66 L70,32" />
    <path d="M44,44 V70 M56,44 V70" />
  </Icon>
);
/** سهم «للأمام» في RTL — يشير يساراً */
export const IChevron = ({ size = 14 }: { size?: number }) => (
  <Icon size={size} sw={9}>
    <path d="M60,26 L36,50 L60,74" />
  </Icon>
);
export const IBack = ({ size = 18 }: { size?: number }) => (
  <Icon size={size} sw={8}>
    <path d="M40,26 L64,50 L40,74" />
  </Icon>
);

/* ===== رأس الصفحات الفرعية: عودة + عنوان ===== */

export function SubHead({ title, backHref = "/account" }: { title: string; backHref?: string }) {
  const router = useRouter();
  return (
    <div className={styles.subHead}>
      <button
        type="button"
        aria-label="عودة"
        className={styles.backBtn}
        onClick={() => {
          if (window.history.length > 1) router.back();
          else router.push(backHref);
        }}
      >
        <IBack />
      </button>
      <h1>{title}</h1>
    </div>
  );
}

/* ===== صف تنقّل داخل بطاقة ===== */

export function NavRow({
  href,
  icon,
  label,
  value,
  testId,
  onClick
}: {
  href?: string;
  icon: React.ReactNode;
  label: string;
  value?: string | null;
  testId?: string;
  onClick?: () => void;
}) {
  const inner = (
    <>
      <span className={styles.rowIcon}>{icon}</span>
      <span className={styles.rowLabel}>{label}</span>
      {value && <span className={styles.rowValue}>{value}</span>}
      <span className={styles.rowChevron}>
        <IChevron />
      </span>
    </>
  );
  if (href) {
    return (
      <Link href={href} className={styles.navRow} data-testid={testId}>
        {inner}
      </Link>
    );
  }
  return (
    <button type="button" className={styles.navRow} onClick={onClick} data-testid={testId}>
      {inner}
    </button>
  );
}

/* ===== وصف قيود المحفظة بلغة العميل ===== */

export interface WalletEntry {
  id: string;
  amount_halalas: number;
  reference: string | null;
  created_at: string;
}

export const walletEntryLabel = (e: WalletEntry): string => {
  if (e.reference === "referral:welcome") return "هدية انضمامك بدعوة صديق";
  if (e.reference === "referral:reward") return "مكافأة دعوة صديق";
  if (e.reference?.startsWith("order:")) {
    const code = e.reference.slice(6).split(":")[0];
    return e.reference.endsWith(":failed") ? `ردّ حجز طلب ${code}` : `دفع طلب ${code}`;
  }
  if (e.reference?.startsWith("refund:")) return "استرجاع لمحفظتك";
  if (e.reference === "admin") return e.amount_halalas > 0 ? "إيداع من بيكلي" : "تسوية من بيكلي";
  return e.amount_halalas > 0 ? "إيداع" : "خصم";
};

/** تاريخ عربي قصير للقيود والحركات */
export const fmtDate = (iso: string): string =>
  new Date(iso).toLocaleDateString("ar-SA", { day: "numeric", month: "short" });
