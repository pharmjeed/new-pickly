import type { Metadata, Viewport } from "next";
import "./globals.css";
import { SiteNav, SiteFooter } from "@/components/chrome";
import { LanguageProvider } from "@/lib/i18n";

export const metadata: Metadata = {
  title: {
    default: "بيكلي — طلبك يوصلك لسيارتك",
    template: "%s · بيكلي"
  },
  description:
    "بيكلي يبلّغ المطعم تلقائيًا لحظة اقتراب سيارتك — فيطلع لك الموظف بطلبك وأنت في مقعدك. استلام ذكي من السيارة، قريبًا في السعودية.",
  keywords: ["بيكلي", "pickly", "استلام من السيارة", "كيرب سايد", "استلام ذكي", "السعودية", "بلا عمولة"],
  openGraph: {
    title: "بيكلي — وصلت؟ إحنا عرفنا.",
    description: "طبقة تنسيق الاستلام الذكية بين سيارتك وباب المتجر — قريبًا في السعودية.",
    locale: "ar_SA",
    type: "website",
    siteName: "بيكلي"
  }
};

/* منفذ عرض ثابت بعرض حاوية الموقع (‎.wrap = 1080px) — قرار المالك 2026-07-22:
   الجوال يعرض نفس تصميم الديسكتوب مصغّراً ليملأ الشاشة، لا تخطيطاً مختلفاً.
   initialScale: 0 ليست مقياساً — إنها الطريقة الوحيدة لحذف initial-scale=1 الذي يدمجه Next
   افتراضياً (يُسقطه عند القيمة الكاذبة)، فيتولى المتصفح حساب التصغير المناسب لعرض الشاشة.
   userScalable مفتوح لأن الخط يصغر على الجوال والتزويم لا بد أن يبقى متاحاً. */
export const viewport: Viewport = {
  width: 1080,
  initialScale: 0,
  userScalable: true
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <head>
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Baloo+Bhaijaan+2:wght@700;800&family=IBM+Plex+Sans+Arabic:wght@400;500;700&family=IBM+Plex+Mono:wght@500&display=swap"
        />
      </head>
      <body>
        <LanguageProvider>
          <SiteNav />
          {children}
          <SiteFooter />
        </LanguageProvider>
      </body>
    </html>
  );
}
