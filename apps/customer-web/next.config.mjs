/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    // بروكسي الـAPI محلياً — الإنتاج عبر نطاق api.pickly.sa
    return [
      {
        source: "/api/:path*",
        destination: `${process.env.API_INTERNAL_URL ?? "http://localhost:4000"}/:path*`
      },
      {
        // بروكسي محرك المسارات الذاتي OSRM — نفس الأصل (بلا CORS)، داخلياً لخدمة osrm:5000
        source: "/osrm/:path*",
        destination: `${process.env.OSRM_INTERNAL_URL ?? "http://localhost:5000"}/:path*`
      }
    ];
  }
};

export default nextConfig;
