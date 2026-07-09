import Link from "next/link";

/* الرئيسية — S-01 / pickly-landing (النصوص حرفياً) */
export default function HomePage() {
  return (
    <main>
      <header className="wrap hero">
        <div>
          <span className="pill">قريبًا في السعودية · استلام ذكي من السيارة</span>
          <h1 className="hero-h">
            وصلت؟
            <br />
            <span className="lm">إحنا عرفنا.</span>
          </h1>
          <p className="sub">
            بيكلي يبلّغ المطعم تلقائيًا لحظة اقتراب سيارتك — فيطلع لك الموظف بطلبك وأنت في مقعدك. بلا اتصال، بلا «وين
            طلبي؟»، بلا نزول مع الأطفال.
          </p>
          <div className="hero-ctas">
            <Link className="btn" href="#join">
              حمّل التطبيق قريبًا
            </Link>
            <Link className="btn btn-ghost" href="/merchants">
              سجّل متجرك
            </Link>
          </div>
          <div className="mini-feats">
            <span>رصد تلقائي ١٠٠–٣٠٠ م</span>
            <span>سيارتك هي عنوانك</span>
            <span>بلا عمولة على المتاجر</span>
            <span>تكامل Foodics</span>
          </div>
        </div>
        <div className="phone">
          <div className="screen">
            <p className="scr-mode">وضع القيادة</p>
            <p className="disp scr-time">١٢ دقيقة</p>
            <p className="scr-sub">حتى وصولك لبيست برجر — العليا</p>
            <div className="scr-bar">
              <i />
            </div>
            <div className="scr-card">
              <p className="t-lime">الإبلاغ تلقائي</p>
              <p className="t-dim">عند دخولك نطاق ٣٠٠ متر يعرف المطعم أنك وصلت</p>
            </div>
            <div className="scr-card last">
              <p className="t-cloud">سيارتك: كامري · بيضاء · ٨٢٤١</p>
              <p className="t-dim sm">الموظف يعرف شكل سيارتك مسبقًا</p>
            </div>
            <div className="scr-code">
              <span dir="ltr">P-4821</span>
            </div>
          </div>
        </div>
      </header>

      <div className="wrap stats">
        <div className="stat">
          <b>٩٠ ث</b>
          <span>متوسط التسليم بعد الرصد*</span>
        </div>
        <div className="stat">
          <b>٠</b>
          <span>مكالمات «وين طلبي؟»</span>
        </div>
        <div className="stat">
          <b>٪٠</b>
          <span>عمولة على قيمة الطلب</span>
        </div>
        <div className="stat">
          <b>٣٠٠ م</b>
          <span>نطاق الاستشعار الذكي</span>
        </div>
      </div>
      <p className="wrap footnote">* أرقام مستهدفة من تصميم التجربة — ليست بيانات إنتاج.</p>

      <section className="wrap" id="features">
        <span className="kicker">FEATURES</span>
        <h2 className="sec">ثلاث قدرات تلغي الانتظار.</h2>
        <p className="lead">
          بيكلي ليس تطبيق توصيل ولا منصة طلبات — هو طبقة تنسيق الاستلام الذكية بين سيارتك وباب المتجر.
        </p>
        <div className="cards3">
          <div className="card dark">
            <div className="ic">
              <svg width="30" height="30" viewBox="0 0 100 100" fill="none" stroke="var(--pk-lime-500)" aria-hidden="true">
                <path d="M34,30 A22,22 0 0 1 66,30" strokeWidth="7" strokeLinecap="round" />
                <path d="M24,17 A36,36 0 0 1 76,17" strokeWidth="7" strokeLinecap="round" opacity=".5" />
                <circle cx="50" cy="55" r="12" strokeWidth="7" />
                <path d="M50,67 V84" strokeWidth="7" strokeLinecap="round" />
              </svg>
            </div>
            <h3>رصد وصول تلقائي</h3>
            <p>
              نطاق ذكي حول الفرع (١٠٠–٣٠٠ متر) يستشعر اقترابك ويبلّغ الموظف تلقائيًا — بلا زر، بلا اتصال. ولو تعطّل
              GPS؟ زر «وصلت» اليدوي موجود دائمًا.
            </p>
            <div className="tags">
              <span>GEOFENCE</span>
              <span>AUTO-DETECT</span>
              <span>FALLBACK</span>
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
            <h3>سيارتك هي عنوانك</h3>
            <p>
              سجّل سيارتك مرة واحدة — النوع واللون واللوحة — وتصبح «عنوان استلامك» الدائم. الموظف يعرف بالضبط أي سيارة
              يقصد، من أول مرة.
            </p>
            <div className="tags">
              <span>ملف السيارة</span>
              <span>إعداد مرة واحدة</span>
            </div>
          </div>
          <div className="card">
            <div className="ic">
              <svg width="30" height="30" viewBox="0 0 100 100" fill="none" stroke="var(--pk-lime-900)" aria-hidden="true">
                <rect x="26" y="12" width="48" height="76" rx="12" strokeWidth="7" />
                <path d="M40,72 H60" strokeWidth="7" strokeLinecap="round" />
              </svg>
            </div>
            <h3>وضع قيادة آمن</h3>
            <p>
              بعد الدفع تتحول الشاشة لوضع داكن هادئ: الوقت المتبقي وحالة طلبك فقط، بأحرف كبيرة — كل شيء يحدث تلقائيًا
              وأنت تسوق.
            </p>
            <div className="tags">
              <span>DARK MODE</span>
              <span>بلا تشتيت</span>
            </div>
          </div>
        </div>
      </section>

      <section className="gray-band" id="how">
        <div className="wrap">
          <span className="kicker">HOW IT WORKS</span>
          <h2 className="sec">من الطلب إلى يدك في ٣ خطوات.</h2>
          <p className="lead">إعداد أول مرة أقل من دقيقتين: سيارتك + إذن الموقع. بعدها كل شيء تلقائي.</p>
          <div className="steps">
            <div className="step">
              <div className="n">١</div>
              <h3 className="disp">اطلب وادفع</h3>
              <p>اطلب من متجرك المفضل وادفع داخل التطبيق. تظهر شاشة الاستلام فورًا مع كود طلبك.</p>
            </div>
            <div className="step">
              <div className="n">٢</div>
              <h3 className="disp">انطلق وحنا نراقب</h3>
              <p>اضغط «انطلقت» ويبدأ وضع القيادة. المتجر يجهّز طلبك على وقت وصولك المتوقع.</p>
            </div>
            <div className="step">
              <div className="n">٣</div>
              <h3 className="disp">وصلت؟ إحنا عرفنا</h3>
              <p>لحظة دخولك النطاق يُبلَّغ الموظف تلقائيًا ويخرج إليك بطلبك. تطابق الكود، استلم، وامشِ.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="wrap" id="merchants">
        <div className="split">
          <div>
            <span className="kicker">FOR MERCHANTS</span>
            <h2 className="sec">
              لمتجرك: كاونتر أهدأ،
              <br />
              وعملاء أوفى.
            </h2>
            <ul className="check">
              <li>
                <strong>بلا عمولة على قيمة الطلب</strong> — رسوم بوابة الدفع القياسية فقط.
              </li>
              <li>لوحة موظف بسيطة: من قادم، متى يصل، وأي سيارة بالضبط.</li>
              <li>تكامل مع Foodics POS — طلباتك في نظامك الحالي، بلا شاشة إضافية.</li>
              <li>وداعًا لازدحام الاستلام ومكالمات «أنا واقف برا».</li>
            </ul>
            <Link className="btn" href="/merchants">
              سجّل متجرك مبكرًا
            </Link>
          </div>
          <div className="card dark board">
            <p className="board-h">لوحة الفرع — بيست برجر العليا</p>
            <div className="board-row">
              <div className="in">
                <div>
                  <p className="v">كامري بيضاء · ٨٢٤١</p>
                  <p className="o">
                    طلب <span dir="ltr" className="mono">P-4821</span> · موقف ٣
                  </p>
                </div>
                <span className="chip ok">وصل الآن</span>
              </div>
            </div>
            <div className="board-row">
              <div className="in">
                <div>
                  <p className="v">يوكن أسود · ٣٣١٩</p>
                  <p className="o">
                    طلب <span dir="ltr" className="mono">P-4822</span>
                  </p>
                </div>
                <span className="chip warn">٤ دقائق</span>
              </div>
            </div>
            <div className="board-row">
              <div className="in">
                <div>
                  <p className="v">سوناتا رمادية · ٧٥٦٢</p>
                  <p className="o">
                    طلب <span dir="ltr" className="mono">P-4823</span>
                  </p>
                </div>
                <span className="chip wait">١١ دقيقة</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="gray-band">
        <div className="wrap">
          <span className="kicker">SECTORS</span>
          <h2 className="sec">مبني للمطاعم. جاهز لكل استلام.</h2>
          <p className="lead">أي متجر يسلّم طلبات محضّرة مسبقًا يستفيد من بيكلي:</p>
          <div className="sectors">
            <span>مطاعم</span>
            <span>مقاهي</span>
            <span>مخابز وحلويات</span>
            <span>صيدليات</span>
            <span>بقالة وسوبرماركت</span>
            <span>ورد وهدايا</span>
            <span>تجزئة (اطلب واستلم)</span>
          </div>
        </div>
      </section>

      <section className="wrap" id="pricing">
        <span className="kicker">PRICING</span>
        <h2 className="sec">تسعير بلا مفاجآت.</h2>
        <p className="lead">نربح فقط عندما يكتمل استلام — لا اشتراكات إجبارية ولا عمولات مخفية.</p>
        <div className="cards3">
          <div className="price">
            <p className="pname">للعملاء</p>
            <b className="amount">رسوم رمزية</b>
            <p className="pd">لكل عملية استلام ناجحة — تُعرض بوضوح قبل الدفع. التطبيق مجاني.</p>
          </div>
          <div className="price hot">
            <span className="tagp">للمتاجر</span>
            <p className="pname">بلا عمولة</p>
            <b className="amount">٪٠</b>
            <p className="pd">على قيمة الطلب. رسوم بوابة الدفع القياسية فقط — أرباح طلبك تبقى لك بالكامل.</p>
          </div>
          <div className="price">
            <p className="pname">التكاملات</p>
            <b className="amount">Foodics</b>
            <p className="pd">ربط مباشر مع نظام نقاط البيع — الطلبات والحالات في مكان واحد.</p>
          </div>
        </div>
      </section>

      <section className="wrap faq" id="faq" style={{ paddingTop: 20 }}>
        <span className="kicker">FAQ</span>
        <h2 className="sec">أسئلة تدور في بالك.</h2>
        <details>
          <summary>ماذا لو تعطّل الـ GPS أو رفضت إذن الموقع؟</summary>
          <p>
            الرصد التلقائي هو الأساس، لكن زر «وصلت» اليدوي موجود دائمًا في شاشة الاستلام — التجربة لا تتوقف أبدًا على
            الاستشعار.
          </p>
        </details>
        <details>
          <summary>هل بيكلي تطبيق توصيل؟</summary>
          <p>
            لا. بيكلي لا يوصّل ولا يتدخل في تجهيز الطلب — نحن ننسق لحظة الاستلام فقط: نخبر المتجر أنك وصلت، وأي سيارة
            أنت.
          </p>
        </details>
        <details>
          <summary>كيف يعرف الموظف سيارتي؟</summary>
          <p>
            ملف سيارتك (النوع، اللون، اللوحة) يظهر للموظف مع طلبك، مع رقم الموقف إن وجد — يمشي إليك مباشرة دون بحث.
          </p>
        </details>
        <details>
          <summary>ماذا لو لم يجدني الموظف؟</summary>
          <p>
            يتواصل معك عبر التطبيق برسالة جاهزة، ويظهر لكما كود التطابق نفسه — التسليم لا يتم إلا بتطابق الكود.
          </p>
        </details>
        <details>
          <summary>ماذا عن خصوصية موقعي؟</summary>
          <p>نستخدم موقعك فقط أثناء رحلة استلام نشطة ولنطاق الفرع، ولا نتتبعك خارجها.</p>
        </details>
      </section>

      <section className="wrap" id="join">
        <div className="cta-final">
          <svg width="72" height="72" style={{ marginBottom: 14 }} aria-hidden="true">
            <use href="#badge" />
          </svg>
          <h2>
            خلّك في سيارتك.
            <br />
            <span className="lm">الباقي علينا.</span>
          </h2>
          <p className="ctasub">انضم لقائمة الانتظار وكن أول من يجرب بيكلي في مدينتك.</p>
          <div className="cta-btns">
            <a className="btn" href="#join" title="التطبيق قريباً — لا متاجر بعد">
              سجّل اهتمامك — عميل
            </a>
            <Link className="btn btn-lime-line" href="/merchants">
              سجّل متجرك
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
