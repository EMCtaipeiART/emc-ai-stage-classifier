declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    // 沒有啟用 R2 的 Cloudflare 帳號改用 KV 存附件
    ASSETS_KV?: KVNamespace;
    // EMC 設計需求系統的 Worker（machi-design-api），用來驗證已登入帳號的 token
    DESIGN_API?: Fetcher;
  }
}
