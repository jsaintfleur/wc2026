import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/api/live",
        headers: [
          { key: "Cache-Control", value: "no-store, no-cache, max-age=0, must-revalidate" },
          { key: "CDN-Cache-Control", value: "no-store" },
          { key: "Vercel-CDN-Cache-Control", value: "no-store" },
        ],
      },
    ];
  },
};

export default nextConfig;
