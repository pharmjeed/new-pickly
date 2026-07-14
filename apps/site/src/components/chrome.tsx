import Link from "next/link";
import { LogoLockup } from "@/components/qirtas";

/* الرأس والتذييل — الهوية الفنكية v2.0: شعار «القرطاس المبتسم» بدل الكيس القديم */

export function Logo({ size = 40 }: { size?: number }) {
  return (
    <Link className="lock" href="/" aria-label="بيكلي — الرئيسية">
      <LogoLockup badge={size} />
    </Link>
  );
}

export function SiteNav() {
  return (
    <nav className="site">
      <div className="wrap nav-in">
        <Logo />
        <div className="nav-links">
          <Link href="/#how">كيف يعمل</Link>
          <Link href="/merchants">للمتاجر</Link>
          <Link href="/#pricing">الأسعار</Link>
          <Link href="/#faq">الأسئلة</Link>
        </div>
        {/* تطبيق الويب يعمل الآن — المتاجر (App Store/Play) تُضاف عند نشر تطبيق Expo */}
        <a className="btn" href={process.env.NEXT_PUBLIC_CUSTOMER_APP_URL ?? "https://app.pickly.sa"}>
          اطلب الآن من المتصفح
        </a>
      </div>
    </nav>
  );
}

export function SiteFooter() {
  return (
    <footer className="site">
      <div className="wrap foot">
        <Logo size={34} />
        <p>
          © ٢٠٢٦ بيكلي — طبقة تنسيق الاستلام الذكية · صُنع في السعودية ·{" "}
          <Link href="/terms">الشروط</Link> · <Link href="/privacy">الخصوصية</Link>
        </p>
      </div>
    </footer>
  );
}
