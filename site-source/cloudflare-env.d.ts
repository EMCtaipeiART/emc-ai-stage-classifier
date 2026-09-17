declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    // 沒有啟用 R2 的 Cloudflare 帳號改用 KV 存附件
    ASSETS_KV?: KVNamespace;
  }
}
