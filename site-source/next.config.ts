import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // 截圖最多 3 張、每張 10MB，預設 1MB 上限會讓上傳被擋下（413）
      bodySizeLimit: "35mb",
      // vinext 會把跨網站的 multipart POST 當成 server action 做 CSRF 檢查；
      // EMC 設計需求系統前台（與本機測試）要能呼叫 /api/analyze。驗證改由標頭 token 負責，不靠 cookie。
      allowedOrigins: ["emctaipeiart.github.io", "localhost:8787", "127.0.0.1:8787"],
    },
  },
};

export default nextConfig;
