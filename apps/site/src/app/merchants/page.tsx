import type { Metadata } from "next";
import { InterestForm } from "./interest-form";

export const metadata: Metadata = {
  title: "للمتاجر",
  description:
    "كاونتر أهدأ، عملاء أوفى — وصفر عمولة على قيمة الطلب. سجّل اهتمام متجرك ببيكلي وسنتواصل معك."
};

/* صفحة المتاجر — من S-03 (للتجار + الانضمام) وقسم merchants في اللاندنج */
export default function MerchantsPage() {
  return (
    <main>
      <div className="wrap hero2">
        <span className="kicker">FOR MERCHANTS</span>
        <h1 className="sec">
          كاونتر أهدأ، عملاء أوفى —
          <br />
          <span className="lm">وصفر عمولة على قيمة الطلب.</span>
        </h1>
        <p className="lead" style={{ marginBottom: 0 }}>
          بيكلي يدير لحظة الاستلام كاملة: من يقترب، متى يصل، وأي سيارة بالضبط — بينما أرباح طلبك تبقى لك.
        </p>
      </div>

      <section className="wrap" style={{ paddingTop: 36, paddingBottom: 36 }}>
        <div className="cards3">
          <div className="scard">
            <h3>شاشة فرع جاهزة</h3>
            <p>تابلت واحد يعرض الجديدة والتحضير والقادمين والواصلين بألوان أولوية صارخة — وتنبيهات صوتية.</p>
          </div>
          <div className="scard">
            <h3>تكامل Foodics وPOS</h3>
            <p>قوائمك وطلباتك في نظامك الحالي — مزامنة تلقائية كل ١٥ دقيقة مع سجل فروقات واضح.</p>
          </div>
          <div className="scard">
            <h3>نموذج رباعي عادل</h3>
            <p>اشتراك شهري + رسم خدمة يدفعه العميل + ظهور اختياري — لا نسبة من مبيعاتك أبدًا.</p>
          </div>
        </div>
      </section>

      <section className="gray-band" style={{ paddingTop: 44, paddingBottom: 44 }}>
        <div className="wrap">
          <span className="kicker">WHY PICKLY</span>
          <h2 className="sec">لمتجرك: كاونتر أهدأ، وعملاء أوفى.</h2>
          <ul className="check">
            <li>
              <strong>بلا عمولة على قيمة الطلب</strong> — رسوم بوابة الدفع القياسية فقط.
            </li>
            <li>لوحة موظف بسيطة: من قادم، متى يصل، وأي سيارة بالضبط.</li>
            <li>تكامل مع Foodics POS — طلباتك في نظامك الحالي، بلا شاشة إضافية.</li>
            <li>وداعًا لازدحام الاستلام ومكالمات «أنا واقف برا».</li>
          </ul>
        </div>
      </section>

      <section className="wrap" id="join" style={{ paddingTop: 44 }}>
        <div className="join-grid">
          <div>
            <span className="kicker">JOIN</span>
            <h2 className="sec" style={{ fontSize: 26 }}>
              سجّل اهتمام منشأتك الآن
            </h2>
            <p className="lead" style={{ fontSize: 14.5, marginBottom: 0 }}>
              بعد الإرسال يتواصل فريق نجاح التجار خلال يوم عمل: تحقق المستندات ← العقد ← إعداد الفروع ←{" "}
              <b>طلب تجريبي كامل</b> ← الانطلاق.
            </p>
            <ul className="join-list">
              <li>✓ إعداد الفرع الأول خلال يومين</li>
              <li>✓ لوحة تاجر كاملة: تقارير، تسويات، عروض</li>
              <li>✓ ندرب فريقك على شاشة الفرع مجانًا</li>
            </ul>
          </div>
          <InterestForm />
        </div>
      </section>
    </main>
  );
}
