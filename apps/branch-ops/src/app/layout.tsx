import type { Metadata } from "next";
import "./globals.css";
import VersionWatch from "./version-watch";

export const metadata: Metadata = {
  title: "بيكلي — لوحة الفرع"
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
        <VersionWatch />
        {children}
      </body>
    </html>
  );
}
