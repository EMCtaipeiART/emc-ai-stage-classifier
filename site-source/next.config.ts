import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 截圖最多 3 張、每張 10MB，預設 1MB 上限會讓上傳被擋下（413）
  experimental: {
    serverActions: { bodySizeLimit: "35mb" },
  },
};

export default nextConfig;
