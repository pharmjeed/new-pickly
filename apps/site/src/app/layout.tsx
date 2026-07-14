import type { Metadata } from "next";
import "./globals.css";
import { SiteNav, SiteFooter } from "@/components/chrome";

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
        <SiteNav />
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}
