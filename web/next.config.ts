import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

const nextConfig: NextConfig = {
  output: "standalone",
  experimental: {
    middlewareClientMaxBodySize: "500mb",
  },
  async rewrites() {
    // Only proxy in dev. In production, nginx routes /api/* to FastAPI.
    if (!isDev) return [];
    return [
      {
        source: "/api/:path*",
        destination: "http://localhost:8765/api/:path*",
      },
    ];
  },
};

export default nextConfig;
