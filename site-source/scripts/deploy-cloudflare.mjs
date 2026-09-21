// 部署到自己的 Cloudflare 帳號：建置 → 改寫 wrangler 設定 → 套用 D1 migration → 上傳 Worker
// 用法：npm run deploy:cloudflare
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const deploy = JSON.parse(readFileSync(new URL("../cloudflare.deploy.json", import.meta.url), "utf8"));
const configPath = "dist/server/wrangler.json";

function run(args) {
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
const wrangler = (...args) => run(["--import", "./scripts/sites-env.mjs", "./node_modules/wrangler/bin/wrangler.js", ...args]);

run(["scripts/run-framework.mjs", "build"]);

const config = JSON.parse(readFileSync(new URL(`../${configPath}`, import.meta.url), "utf8"));
config.name = deploy.workerName;
config.topLevelName = deploy.workerName;
config.workers_dev = true;
config.d1_databases = [{
  binding: "DB",
  database_name: deploy.d1.databaseName,
  database_id: deploy.d1.databaseId,
  migrations_dir: "../../drizzle",
}];
config.r2_buckets = deploy.r2BucketName ? [{ binding: "BUCKET", bucket_name: deploy.r2BucketName }] : [];
config.kv_namespaces = !deploy.r2BucketName && deploy.kvNamespaceId ? [{ binding: "ASSETS_KV", id: deploy.kvNamespaceId }] : [];
// 驗證 EMC 設計需求系統的登入 token；允許前台跨網站呼叫 API
config.services = deploy.designApiService ? [{ binding: "DESIGN_API", service: deploy.designApiService }] : [];
config.vars = { ...config.vars, ALLOWED_ORIGINS: (deploy.allowedOrigins || []).join(",") };
writeFileSync(new URL(`../${configPath}`, import.meta.url), JSON.stringify(config));

wrangler("d1", "migrations", "apply", "DB", "--remote", "--config", configPath);
wrangler("deploy", "--config", configPath);

console.log("\n部署完成。第一次部署請確認已設定 secrets：GEMINI_API_KEY、OPENAI_API_KEY、ACCESS_PASSWORD（見 README）。");
