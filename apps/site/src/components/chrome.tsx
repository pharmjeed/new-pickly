"use client";
import Link from "next/link";
import { LogoLockup } from "@/components/qirtas";
import { LangToggle, useT } from "@/lib/i18n";

/* الرأس والتذييل — الهوية الفنكية v2.0: شعار «القرطاس المبتسم»
   زر «اطلب الآن من المتصفح» حُذف بطلب المالك 2026-07-18 وحل محله مبدّل اللغة. */

export function Logo({ size = 40 }: { size?: number }) {
  const t = useT();
  return (
    <Link className="lock" href="/" aria-label={t.nav.home}>
      <LogoLockup badge={size} />
    </Link>
  );
}

export function SiteNav() {
  const t = useT();
  return (
    <nav className="site">
      <div className="wrap nav-in">
        <Logo />
        <div className="nav-links">
          <Link href="/#how">{t.nav.how}</Link>
          <Link href="/merchants">{t.nav.merchants}</Link>
          <Link href="/#pricing">{t.nav.pricing}</Link>
          <Link href="/#faq">{t.nav.faq}</Link>
        </div>
        <LangToggle />
      </div>
    </nav>
  );
}

export function SiteFooter() {
  const t = useT();
  return (
    <footer className="site">
      <div className="wrap foot">
        <Logo size={34} />
        <p>
          {t.footer.line} · <Link href="/terms">{t.footer.terms}</Link> ·{" "}
          <Link href="/privacy">{t.footer.privacy}</Link>
        </p>
      </div>
    </footer>
  );
}
