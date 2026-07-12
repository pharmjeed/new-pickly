import type { Metadata, Viewport } from "next";
import "./globals.css";
import Splash from "./splash";

export const metadata: Metadata = {
  title: "بيكلي — وصلت؟ إحنا عرفنا.",
  description: "خلّك في سيارتك — طلبك يجيك."
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

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
        <Splash />
        {children}
      </body>
    </html>
  );
}
