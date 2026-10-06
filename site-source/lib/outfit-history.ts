import { env } from "cloudflare:workers";
import { assetStorageReady, getAsset, putAsset } from "@/lib/storage";
import { ensureItemsTable } from "@/lib/outfit-items";

// 服裝生成紀錄（2026-10-05）：每次生成（成功與失敗）都記一筆；圖片存在 R2／KV，資料存在 D1。
// 資料表在第一次用到時才建立（CREATE TABLE IF NOT EXISTS）：部署用的權杖沒有 D1 migration 的權限，
// 而 Worker 本身的 D1 綁定可以建表，所以不另外做 drizzle migration。
let tableReady: Promise<void> | null = null;
function ensureTable() {
  if (!env.DB) throw new Error("歷史紀錄儲存空間尚未啟用。");
  tableReady ||= env.DB.exec("CREATE TABLE IF NOT EXISTS outfit_history (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, status TEXT NOT NULL, model TEXT, quality TEXT, description TEXT, described TEXT, photo_count INTEGER NOT NULL DEFAULT 0, seconds REAL, input_tokens INTEGER, output_tokens INTEGER, total_tokens INTEGER, cost_usd REAL, transparent INTEGER, image_key TEXT, error TEXT)").then(async () => {
    // 後來才加的欄位：已經存在就會報錯，忽略即可
    for (const column of ["coin_cost REAL NOT NULL DEFAULT 0", "coin_exempt INTEGER NOT NULL DEFAULT 0", "variants INTEGER NOT NULL DEFAULT 1"]) await env.DB!.exec(`ALTER TABLE outfit_history ADD COLUMN ${column}`).catch(() => undefined);
  }).catch((error) => { tableReady = null; throw error; });
  return tableReady;
}

export const variantKey = (id: string, k: number) => (k === 0 ? `outfit/${id}.png` : `outfit/${id}-${k}.png`);
export type OutfitRecord = {
  id: string; userId: string; status: "ok" | "failed"; model: string; quality: string;
  description: string; described: string; photoCount: number; seconds: number;
  usage: { input: number; output: number; total: number; costUsd: number };
  transparent: boolean; error: string; pngs: Uint8Array[];
  coinCost: number; coinExempt: boolean; itemId: string; attempt: number;
};

export async function saveOutfitRecord(record: OutfitRecord) {
  await ensureTable();
  await ensureItemsTable();
  let imageKey = "";
  if (record.pngs.length && assetStorageReady()) {
    // 一次生成三組供選：第 1 組沿用原本的檔名，第 2、3 組加 -1、-2
    for (let k = 0; k < record.pngs.length; k += 1) await putAsset(variantKey(record.id, k), record.pngs[k], "image/png");
    imageKey = variantKey(record.id, 0);
  }
  await env.DB!.prepare("INSERT INTO outfit_history (id, user_id, status, model, quality, description, described, photo_count, seconds, input_tokens, output_tokens, total_tokens, cost_usd, transparent, image_key, error, coin_cost, coin_exempt, item_id, attempt, variants) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(record.id, record.userId, record.status, record.model, record.quality, record.description.slice(0, 1000), record.described.slice(0, 1000), record.photoCount, record.seconds, record.usage.input, record.usage.output, record.usage.total, record.usage.costUsd, record.transparent ? 1 : 0, imageKey, record.error.slice(0, 1500), record.coinCost, record.coinExempt ? 1 : 0, record.itemId, record.attempt, Math.max(1, record.pngs.length))
    .run();
}

type Row = { id: string; user_id: string; created_at: string; status: string; model: string; quality: string; description: string; described: string; photo_count: number; seconds: number; input_tokens: number; output_tokens: number; total_tokens: number; cost_usd: number; transparent: number; image_key: string; error: string; coin_cost: number; coin_exempt: number; variants: number };

export async function listOutfitHistory(limit = 50) {
  await ensureTable();
  const { results } = await env.DB!.prepare("SELECT * FROM outfit_history ORDER BY created_at DESC, rowid DESC LIMIT ?").bind(limit).all<Row>();
  const totals = await env.DB!.prepare("SELECT COUNT(*) AS runs, SUM(CASE WHEN status = 'ok' THEN 1 ELSE 0 END) AS ok, COALESCE(SUM(total_tokens), 0) AS tokens, COALESCE(SUM(cost_usd), 0) AS cost FROM outfit_history").first<{ runs: number; ok: number; tokens: number; cost: number }>();
  const items = (results || []).map((row) => ({
    id: row.id, createdAt: row.created_at, userId: row.user_id, status: row.status, model: row.model, quality: row.quality,
    description: row.description, described: row.described, photoCount: row.photo_count, seconds: row.seconds,
    usage: { input: row.input_tokens, output: row.output_tokens, total: row.total_tokens, costUsd: row.cost_usd },
    transparent: Boolean(row.transparent), error: row.error, coinCost: row.coin_cost || 0, coinExempt: Boolean(row.coin_exempt), variants: row.variants || 1, imageUrl: row.image_key ? `/api/outfit/history/${row.id}/image` : "",
  }));
  return { items, totals: { runs: totals?.runs ?? 0, ok: totals?.ok ?? 0, tokens: totals?.tokens ?? 0, costUsd: totals?.cost ?? 0 } };
}

export async function outfitHistoryImage(id: string, variant = 0): Promise<ReadableStream | null> {
  await ensureTable();
  const row = await env.DB!.prepare("SELECT image_key, variants FROM outfit_history WHERE id = ?").bind(id).first<{ image_key: string; variants: number }>();
  if (!row?.image_key || variant < 0 || variant >= (row.variants || 1)) return null;
  return getAsset(variantKey(id, variant));
}
