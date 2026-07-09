"use client";

/**
 * لوحة Super Admin — Modular Panel واحدة (design/admin/panel.html):
 * Sidebar واحد + مساحة محتوى، كل وحدة مكوّن يُبدّل بالتبويب الجانبي.
 * وحدات الطيار: نظرة عامة، التجار، الطلبات، الاسترجاعات، العملاء، التسويات، الصحة، سجل العمليات.
 * المؤجل (مرحلة 2) يظهر معطلاً في الـSidebar.
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { THEME_KEY, TOKEN_KEY, getToken } from "@/lib/api";
import Overview from "@/components/modules/Overview";
import Merchants from "@/components/modules/Merchants";
import Orders from "@/components/modules/Orders";
import Refunds from "@/components/modules/Refunds";
import Customers from "@/components/modules/Customers";
import Settlements from "@/components/modules/Settlements";
import HealthOps from "@/components/modules/HealthOps";
import AuditLogs from "@/components/modules/AuditLogs";
import s from "./panel.module.css";

/** شارة بيكلي — كتاب الهوية */
function Badge({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <rect width="100" height="100" rx="24" fill="var(--pk-lime-500)" />
      <g transform="skewX(-8) translate(4,0)" stroke="var(--pk-ink-900)" fill="none">
        <path d="M36,34 L62,34 L59,72 L39,72 Z" strokeWidth="4" strokeLinejoin="round" />
        <path d="M43,34 Q49,24 55,34" strokeWidth="3.5" strokeLinecap="round" />
        <path d="M70,40 H88" strokeWidth="5" strokeLinecap="round" />
        <path d="M74,52 H88" strokeWidth="5" strokeLinecap="round" opacity="0.55" />
        <path d="M70,64 H80" strokeWidth="5" strokeLinecap="round" opacity="0.3" />
      </g>
    </svg>
  );
}

type ModuleKey =
  | "overview"
  | "orders"
  | "refunds"
  | "settlements"
  | "merchants"
  | "customers"
  | "audit"
  | "health";

type NavItem =
  | { gp: string }
  | { key: ModuleKey; label: string }
  | { deferred: string; label: string };

const NAV: readonly NavItem[] = [
  { gp: "العمليات" },
  { key: "overview", label: "نظرة عامة" },
  { key: "orders", label: "الطلبات" },
  { key: "refunds", label: "الاسترجاعات" },
  { key: "settlements", label: "التسويات" },
  { gp: "الشركاء" },
  { key: "merchants", label: "التجار" },
  { gp: "العملاء والمحتوى" },
  { key: "customers", label: "العملاء" },
  { deferred: "cms", label: "CMS" },
  { deferred: "promos", label: "العروض" },
  { deferred: "support", label: "الدعم" },
  { gp: "الحوكمة" },
  { key: "audit", label: "سجل العمليات" },
  { deferred: "risk", label: "المخاطر الآلي" },
  { gp: "التقنية" },
  { key: "health", label: "صحة النظام" },
  { deferred: "flags", label: "Feature Flags" }
];

const MODULES: Record<ModuleKey, { title: string; crumb: string; render: () => React.ReactNode }> = {
  overview: {
    title: "نظرة عامة",
    crumb: "منصة بيكلي — مؤشرات اليوم",
    render: () => <Overview />
  },
  merchants: {
    title: "التجار",
    crumb: "الاعتماد والتعليق — كل قرار بسبب يدخل سجل التدقيق (BR-15)",
    render: () => <Merchants />
  },
  orders: {
    title: "طلبات المنصة",
    crumb: "بحث شامل عبر كل التجار — سجل غير قابل للتعديل",
    render: () => <Orders />
  },
  refunds: {
    title: "الاسترجاعات",
    crumb: "طابور القرارات — الصلاحيات بسقوف (BR-12)",
    render: () => <Refunds />
  },
  customers: {
    title: "عملاء المنصة",
    crumb: "بيانات مقنّعة افتراضياً — الحظر بسبب يُسجل",
    render: () => <Customers />
  },
  settlements: {
    title: "تسويات التجار",
    crumb: "دورات أسبوعية — كل بند يرجع لحركة Ledger",
    render: () => <Settlements />
  },
  health: {
    title: "صحة النظام",
    crumb: "الوظائف الخلفية وDead Letters وآخر الأحداث",
    render: () => <HealthOps />
  },
  audit: {
    title: "سجل العمليات",
    crumb: "قابل للإلحاق فقط — لا حذف من الواجهة (FR-A12)",
    render: () => <AuditLogs />
  }
};

export default function AdminPanelPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [active, setActive] = useState<ModuleKey>("overview");
  const [dark, setDark] = useState(false);

  // حارس الجلسة: لا aw_token → العودة للدخول
  useEffect(() => {
    if (!getToken()) {
      router.replace("/");
      return;
    }
    setReady(true);
  }, [router]);

  // الوضع الداكن — data-theme="dark" على html (مسموح للوحة الأدمن)
  useEffect(() => {
    const saved = localStorage.getItem(THEME_KEY) === "dark";
    setDark(saved);
    document.documentElement.setAttribute("data-theme", saved ? "dark" : "");
    return () => document.documentElement.removeAttribute("data-theme");
  }, []);

  const toggleTheme = () => {
    const next = !dark;
    setDark(next);
    localStorage.setItem(THEME_KEY, next ? "dark" : "light");
    document.documentElement.setAttribute("data-theme", next ? "dark" : "");
  };

  const logout = () => {
    localStorage.removeItem(TOKEN_KEY);
    router.replace("/");
  };

  const mod = MODULES[active];

  return (
    <div className={s.stage}>
      <div className={s.portal}>
        <aside className={s.side} data-testid="admin-sidebar">
          <div className={s.lg}>
            <Badge />
            <div>
              <b>Super Admin</b>
              <div className={s.sub}>منصة بيكلي — نطاق الطيار</div>
            </div>
          </div>
          <nav className={s.nav}>
            {NAV.map((item, i) => {
              if ("gp" in item) {
                return (
                  <div key={`gp-${i}`} className={s.gp}>
                    {item.gp}
                  </div>
                );
              }
              if ("deferred" in item) {
                return (
                  <span key={item.deferred} className={s.navOff} data-testid={`nav-deferred-${item.deferred}`}>
                    {item.label}
                    <span className={s.phase2}>مرحلة 2</span>
                  </span>
                );
              }
              return (
                <button
                  key={item.key}
                  type="button"
                  className={active === item.key ? s.on : undefined}
                  data-testid={`nav-${item.key}`}
                  onClick={() => setActive(item.key)}
                >
                  {item.label}
                </button>
              );
            })}
          </nav>
          <button type="button" className={s.logout} onClick={logout} data-testid="logout">
            تسجيل الخروج
          </button>
          <div className={s.ft}>
            admin.pickly.sa
            <br />
            <span className={s.ftMono}>نطاق الطيار</span>
          </div>
        </aside>

        <div className={s.pmain}>
          <header className={s.ptop}>
            <div>
              <h1 data-testid="module-title">{mod.title}</h1>
              <div className={s.crumb}>{mod.crumb}</div>
            </div>
            <div className={s.sp}>
              <button
                type="button"
                className={s.thm}
                onClick={toggleTheme}
                data-testid="theme-toggle"
                aria-label={dark ? "الوضع الفاتح" : "الوضع الداكن"}
              >
                {dark ? "☀" : "☾"}
              </button>
              <span className={s.avatar} aria-hidden="true">
                أ
              </span>
            </div>
          </header>
          <section className={s.pbody} data-testid={`module-${active}`}>
            {ready ? mod.render() : null}
          </section>
        </div>
      </div>
    </div>
  );
}
