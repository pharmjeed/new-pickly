import type { MetadataRoute } from "next";

/**
 * بيان PWA — يجعل اختصار الشاشة الرئيسية تطبيقاً قائماً بذاته بأيقونة مقنّعة
 * (القرطاس الطليق يملأ قناع النظام — جولة المظهر الخارجي 2026-08-02).
 * maskable: ليموني كامل والرسم بنسبة أيقونة أندرويد التكيفية نفسها (620/1024).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "بيكلي",
    short_name: "بيكلي",
    description: "خلّك في سيارتك — طلبك يجيك.",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    dir: "rtl",
    lang: "ar",
    background_color: "#C8F542",
    theme_color: "#F7F3E9",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
