"use client";
import Link from "next/link";
import { Qirtas, QirtasBadge, SpeedLines } from "@/components/qirtas";
import { CountUp, Reveal } from "@/components/motion";
import { useT } from "@/lib/i18n";

/* الرئيسية — S-01 / pickly-landing (الهوية الفنكية v2.0)
   ديناميكية 2026-07-18: قاموس عربي/إنجليزي + دخول متدرج + كشف تمرير + عدّادات + شريط قطاعات متحرك */

const CHIP_TONES = ["ok", "warn", "wait"] as const;
const ORDER_CODES = ["P-4821", "P-4822", "P-4823"] as const;

export default function HomePage() {
  const t = useT();
  return (
    <main>
      <header className="wrap hero">
        <div>
          <span className="pill">{t.hero.pill}</span>
          <h1 className="hero-h">
            {t.hero.h1a}
            <br />
            <span className="lm">{t.hero.h1b}</span>
          </h1>
          <p className="sub">{t.hero.sub}</p>
          <div className="hero-ctas">
            <Link className="btn" href="#join">
              {t.hero.cta1}
            </Link>
            <Link className="btn btn-ghost" href="/merchants">
              {t.hero.cta2}
            </Link>
          </div>
          <div className="mini-feats">
            {t.hero.feats.map((f) => (
              <span key={f}>{f}</span>
            ))}
          </div>
        </div>
        <div>
          {/* القرطاس البطل — مندفع بخطوط سرعته، يطفو فوق شاشة الهاتف */}
          <div className="hero-mascot">
            <Qirtas mood="excited" lines size={104} title={t.hero.mascotTitle} />
          </div>
          <div className="phone">
            <div className="screen">
              <p className="scr-mode">{t.phone.mode}</p>
              <p className="disp scr-time">{t.phone.time}</p>
              <p className="scr-sub">{t.phone.sub}</p>
              <div className="scr-bar">
                <i />
              </div>
              <div className="scr-card">
                <p className="t-lime">{t.phone.card1t}</p>
                <p className="t-dim">{t.phone.card1d}</p>
              </div>
              <div className="scr-card last">
                <p className="t-cloud">{t.phone.card2t}</p>
                <p className="t-dim sm">{t.phone.card2d}</p>
              </div>
              <div className="scr-code">
                <span dir="ltr">P-4821</span>
              </div>
            </div>
          </div>
        </div>
      </header>

      <Reveal className="wrap stats rv-stagger">
        {t.stats.map((s) => (
          <div className="stat" key={s.label}>
            <CountUp to={s.to} prefix={s.prefix} suffix={s.suffix} />
            <span>{s.label}</span>
          </div>
        ))}
      </Reveal>
      <p className="wrap footnote">{t.footnote}</p>

      <section className="wrap" id="features">
        <Reveal>
          <SpeedLines width={54} style={{ display: "block", marginBottom: 6 }} />
          <span className="kicker">FEATURES</span>
          <h2 className="sec">{t.features.title}</h2>
          <p className="lead">{t.features.lead}</p>
        </Reveal>
        <Reveal className="cards3 rv-stagger">
          <div className="card dark">
            <div className="ic">
              <svg width="30" height="30" viewBox="0 0 100 100" fill="none" stroke="var(--pk-lime-500)" aria-hidden="true">
                <path d="M34,30 A22,22 0 0 1 66,30" strokeWidth="7" strokeLinecap="round" />
                <path d="M24,17 A36,36 0 0 1 76,17" strokeWidth="7" strokeLinecap="round" opacity=".5" />
                <circle cx="50" cy="55" r="12" strokeWidth="7" />
                <path d="M50,67 V84" strokeWidth="7" strokeLinecap="round" />
              </svg>
            </div>
            <h3>{t.features.cards[0].title}</h3>
            <p>{t.features.cards[0].text}</p>
            <div className="tags">
              {t.features.cards[0].tags.map((tag) => (
                <span key={tag}>{tag}</span>
              ))}
            </div>
          </div>
          <div className="card">
            <div className="ic">
              <svg width="30" height="30" viewBox="0 0 100 100" fill="none" stroke="var(--pk-lime-900)" aria-hidden="true">
                <path d="M30,58 Q35,42 50,42 Q65,42 70,58" strokeWidth="7" strokeLinecap="round" />
                <rect x="18" y="56" width="64" height="18" rx="9" strokeWidth="7" />
                <circle cx="34" cy="80" r="6" strokeWidth="6" />
                <circle cx="66" cy="80" r="6" strokeWidth="6" />
              </svg>
            </div>
            <h3>{t.features.cards[1].title}</h3>
            <p>{t.features.cards[1].text}</p>
            <div className="tags">
              {t.features.cards[1].tags.map((tag) => (
                <span key={tag}>{tag}</span>
              ))}
            </div>
          </div>
          <div className="card">
            <div className="ic">
              <svg width="30" height="30" viewBox="0 0 100 100" fill="none" stroke="var(--pk-lime-900)" aria-hidden="true">
                <rect x="26" y="12" width="48" height="76" rx="12" strokeWidth="7" />
                <path d="M40,72 H60" strokeWidth="7" strokeLinecap="round" />
              </svg>
            </div>
            <h3>{t.features.cards[2].title}</h3>
            <p>{t.features.cards[2].text}</p>
            <div className="tags">
              {t.features.cards[2].tags.map((tag) => (
                <span key={tag}>{tag}</span>
              ))}
            </div>
          </div>
        </Reveal>
      </section>

      <section className="gray-band" id="how">
        <div className="wrap">
          <Reveal>
            <span className="kicker">HOW IT WORKS</span>
            <h2 className="sec">{t.how.title}</h2>
            <p className="lead">{t.how.lead}</p>
          </Reveal>
          <Reveal className="steps rv-stagger">
            {t.how.steps.map((s) => (
              <div className="step" key={s.n}>
                <div className="n">{s.n}</div>
                <h3 className="disp">{s.title}</h3>
                <p>{s.text}</p>
              </div>
            ))}
          </Reveal>
        </div>
      </section>

      <section className="wrap" id="merchants">
        <Reveal className="split rv-stagger">
          <div>
            <span className="kicker">FOR MERCHANTS</span>
            <h2 className="sec">
              {t.merch.title1}
              <br />
              {t.merch.title2}
            </h2>
            <ul className="check">
              {t.merch.checks.map((c, i) => (
                <li key={i}>
                  {c.strong && <strong>{c.strong}</strong>}
                  {c.text}
                </li>
              ))}
            </ul>
            <Link className="btn" href="/merchants">
              {t.merch.cta}
            </Link>
          </div>
          <div className="card dark board">
            <p className="board-h">{t.merch.boardTitle}</p>
            {t.merch.rows.map((r, i) => (
              <div className="board-row" key={ORDER_CODES[i]}>
                <div className="in">
                  <div>
                    <p className="v">{r.car}</p>
                    <p className="o">
                      {t.merch.orderWord}{" "}
                      <span dir="ltr" className="mono">
                        {ORDER_CODES[i]}
                      </span>
                      {r.order ? ` · ${r.order}` : ""}
                    </p>
                  </div>
                  <span className={`chip ${CHIP_TONES[i]}`}>{r.chip}</span>
                </div>
              </div>
            ))}
          </div>
        </Reveal>
      </section>

      <section className="gray-band">
        <div className="wrap">
          <Reveal>
            <span className="kicker">SECTORS</span>
            <h2 className="sec">{t.sectors.title}</h2>
            <p className="lead">{t.sectors.lead}</p>
          </Reveal>
          {/* شريط متحرك: نسختان متطابقتان للدوران اللانهائي — الثانية زخرفية */}
          <div className="marquee" dir="ltr">
            <div className="marquee-track">
              <div className="sectors">
                {t.sectors.items.map((s) => (
                  <span key={s}>{s}</span>
                ))}
              </div>
              <div className="sectors" aria-hidden="true">
                {t.sectors.items.map((s) => (
                  <span key={s}>{s}</span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="wrap" id="pricing">
        <Reveal>
          <SpeedLines width={54} style={{ display: "block", marginBottom: 6 }} />
          <span className="kicker">PRICING</span>
          <h2 className="sec">{t.pricing.title}</h2>
          <p className="lead">{t.pricing.lead}</p>
        </Reveal>
        <Reveal className="cards3 rv-stagger">
          <div className="price">
            <p className="pname">{t.pricing.cards[0].name}</p>
            <b className="amount">{t.pricing.cards[0].amount}</b>
            <p className="pd">{t.pricing.cards[0].text}</p>
          </div>
          <div className="price hot">
            <span className="tagp">{t.pricing.hotTag}</span>
            <p className="pname">{t.pricing.cards[1].name}</p>
            <b className="amount">{t.pricing.cards[1].amount}</b>
            <p className="pd">{t.pricing.cards[1].text}</p>
          </div>
          <div className="price">
            <p className="pname">{t.pricing.cards[2].name}</p>
            <b className="amount">{t.pricing.cards[2].amount}</b>
            <p className="pd">{t.pricing.cards[2].text}</p>
          </div>
        </Reveal>
      </section>

      <section className="wrap faq" id="faq" style={{ paddingTop: 20 }}>
        <Reveal>
          <span className="kicker">FAQ</span>
          <h2 className="sec">{t.faq.title}</h2>
        </Reveal>
        <Reveal className="rv-stagger">
          {t.faq.items.map((f) => (
            <details key={f.q}>
              <summary>{f.q}</summary>
              <p>{f.a}</p>
            </details>
          ))}
        </Reveal>
      </section>

      <section className="wrap" id="join">
        <Reveal>
          <div className="cta-final">
            <span className="cta-badge" style={{ marginBottom: 14 }}>
              <QirtasBadge size={76} style={{ transform: "rotate(var(--pk-sticker-tilt))" }} />
            </span>
            <h2>
              {t.join.title1}
              <br />
              <span className="lm">{t.join.title2}</span>
            </h2>
            <p className="ctasub">{t.join.sub}</p>
            <div className="cta-btns">
              {/* تطبيق الويب يعمل الآن — متاجر التطبيقات تُضاف عند نشر تطبيق Expo */}
              <a className="btn" href={process.env.NEXT_PUBLIC_CUSTOMER_APP_URL ?? "https://app.thepickly.com"}>
                {t.join.order}
              </a>
              <Link className="btn btn-ghost" href="/merchants">
                {t.join.merchants}
              </Link>
            </div>
          </div>
        </Reveal>
      </section>
    </main>
  );
}
