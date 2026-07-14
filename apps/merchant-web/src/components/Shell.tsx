"use client";

/**
 * هيكل بوابة التاجر — شريط جانبي داكن على يمين RTL (design/merchant، عرض 1440px)
 * يظهر في كل الصفحات عدا الدخول. حارس جلسة: لا mw_token → العودة للدخول.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { TOKEN_KEY, getToken } from "@/lib/api";
import { QirtasBadge, QirtasLoader, SpeedLines } from "./qirtas";
import s from "./shell.module.css";

const NAV = [
  { gp: "التشغيل" },
  { href: "/dashboard", label: "الرئيسية" },
  { href: "/menu", label: "المنيو والتوفر" },
  { href: "/scheduled", label: "الاستلام المجدول" },
  { gp: "الإدارة" },
  { href: "/profile", label: "معلومات المطعم" },
  { href: "/staff", label: "الطاقم" },
  { gp: "الأعمال" },
  { href: "/settlements", label: "المالية والتسويات" },
  { href: "/reviews", label: "التقييمات" }
] as const;

export default function Shell({
  title,
  crumb,
  actions,
  children
}: {
  title: string;
  crumb?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!getToken()) {
      router.replace("/");
      return;
    }
    setReady(true);
  }, [router]);

  const logout = () => {
    localStorage.removeItem(TOKEN_KEY);
    router.replace("/");
  };

  return (
    <div className={s.stage}>
      <div className={s.portal}>
        <aside className={s.side} data-testid="sidebar">
          <div className={s.lg}>
            <QirtasBadge size={36} />
            <div>
              <b>بوابة التاجر</b>
              <div className={s.sub}>نطاق الطيار</div>
            </div>
          </div>
          <nav className={s.nav}>
            {NAV.map((item, i) =>
              "gp" in item ? (
                <div key={`gp-${i}`} className={s.gp}>
                  {item.gp}
                </div>
              ) : (
                <Link
                  key={item.href}
                  href={item.href}
                  className={pathname.startsWith(item.href) ? s.on : undefined}
                  data-testid={`nav-${item.href.slice(1)}`}
                >
                  {item.label}
                </Link>
              )
            )}
          </nav>
          <button type="button" className={s.logout} onClick={logout} data-testid="logout">
            تسجيل الخروج
          </button>
          <div className={s.ft}>
            نطاق الطيار
            <br />
            <span className={s.ftMono}>merchant.pickly.sa</span>
          </div>
        </aside>

        <div className={s.pmain}>
          <header className={s.ptop}>
            <div>
              <h1>{title}</h1>
              {crumb && <div className={s.crumb}>{crumb}</div>}
            </div>
            <span className={s.lines}>
              <SpeedLines width={38} />
            </span>
            <div className={s.sp}>
              {actions}
              <span className={s.avatar} aria-hidden="true">
                ت
              </span>
            </div>
          </header>
          <section className={s.pbody}>
            {ready ? (
              children
            ) : (
              <div className={s.loading}>
                <QirtasLoader size={64} />
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
