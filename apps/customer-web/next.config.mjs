/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    // بروكسي الـAPI محلياً — الإنتاج عبر نطاق api.pickly.sa
    return [
      {
        source: "/api/:path*",
        destination: `${process.env.API_INTERNAL_URL ?? "http://localhost:4000"}/:path*`
      }
    ];
  }
};

export default nextConfig;
