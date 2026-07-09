import Link from "next/link";

/* شارة بيكلي — الكيس المندفع (منقولة حرفياً من design/identity/pickly-landing.html) */
export function BadgeDefs() {
  return (
    <svg style={{ display: "none" }} xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <symbol id="badge" viewBox="0 0 100 100">
        <rect width="100" height="100" rx="24" fill="#C9F339" />
        <g transform="skewX(-8) translate(4,0)" stroke="#10241B" fill="none">
          <path d="M36,34 L62,34 L59,72 L39,72 Z" strokeWidth="4" strokeLinejoin="round" />
          <path d="M43,34 Q49,24 55,34" strokeWidth="3.5" strokeLinecap="round" />
          <path d="M70,40 H88" strokeWidth="5" strokeLinecap="round" />
          <path d="M74,52 H88" strokeWidth="5" strokeLinecap="round" opacity="0.55" />
          <path d="M70,64 H80" strokeWidth="5" strokeLinecap="round" opacity="0.3" />
        </g>
      </symbol>
    </svg>
  );
}

export function Logo({ size = 42, wmSize }: { size?: number; wmSize?: number }) {
  return (
    <Link className="lock" dir="ltr" style={{ direction: "ltr" }} href="/" aria-label="بيكلي — الرئيسية">
      <svg width={size} height={size} aria-hidden="true">
        <use href="#badge" />
      </svg>
      <span className="wm disp" style={wmSize ? { fontSize: wmSize } : undefined}>
        pickly<small>بيكلي</small>
      </span>
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
        <Link className="btn" href="/#join" title="روابط التطبيق قريباً">
          حمّل التطبيق قريبًا
        </Link>
      </div>
    </nav>
  );
}

export function SiteFooter() {
  return (
    <footer className="site">
      <div className="wrap foot">
        <Logo size={34} wmSize={17} />
        <p>
          © ٢٠٢٦ بيكلي — طبقة تنسيق الاستلام الذكية · صُنع في السعودية ·{" "}
          <Link href="/terms">الشروط</Link> · <Link href="/privacy">الخصوصية</Link>
        </p>
      </div>
    </footer>
  );
}
