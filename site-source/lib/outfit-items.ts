import { env } from "cloudflare:workers";
import { assetStorageReady, getAsset, putAsset } from "@/lib/storage";

// 服裝製作單（2026-10-06）：一次生成 → 套上大頭微調 → 完成（可設為預設）→ 之後可以編輯、刪除。
// 草稿（draft）階段不滿意可以重新生成（每次 100 點，仍是同一張製作單）；完成後就是定稿。刪除是軟刪除（保留紀錄，避免爭議）。
// 資料表第一次用到才建（原因同 outfit-history.ts：部署權杖沒有 D1 migration 的權限）。
let ready: Promise<void> | null = null;
export function ensureItemsTable() {
  if (!env.DB) throw new Error("儲存空間尚未啟用。");
  ready ||= env.DB.exec("CREATE TABLE IF NOT EXISTS outfit_items (id TEXT PRIMARY KEY, owner_account TEXT NOT NULL, owner_name TEXT NOT NULL DEFAULT '', name TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'draft', is_default INTEGER NOT NULL DEFAULT 0, description TEXT NOT NULL DEFAULT '', generation_id TEXT NOT NULL DEFAULT '', attempts INTEGER NOT NULL DEFAULT 0, head_json TEXT NOT NULL DEFAULT '', views_json TEXT NOT NULL DEFAULT '', cover_key TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, completed_at TEXT, deleted_at TEXT)")
    .then(async () => {
      for (const column of ["item_id TEXT NOT NULL DEFAULT ''", "attempt INTEGER NOT NULL DEFAULT 1"]) await env.DB!.exec(`ALTER TABLE outfit_history ADD COLUMN ${column}`).catch(() => undefined);
    })
    .catch((error) => { ready = null; throw error; });
  return ready;
}

export type ItemRow = { id: string; owner_account: string; owner_name: string; name: string; status: string; is_default: number; description: string; generation_id: string; attempts: number; head_json: string; views_json: string; cover_key: string; created_at: string; updated_at: string; completed_at: string | null; deleted_at: string | null };

export function itemPublic(row: ItemRow) {
  const parse = (value: string) => { try { return value ? JSON.parse(value) : null; } catch { return null; } };
  return {
    id: row.id, name: row.name, status: row.status, isDefault: Boolean(row.is_default), description: row.description, attempts: row.attempts,
    head: parse(row.head_json), views: parse(row.views_json), ownerName: row.owner_name, ownerAccount: row.owner_account,
    createdAt: row.created_at, updatedAt: row.updated_at, completedAt: row.completed_at,
    coverUrl: row.cover_key ? `/api/outfit/items/${row.id}/cover` : "",
    bodyUrl: row.generation_id ? `/api/outfit/history/${row.generation_id}/image` : "",
  };
}

export async function listItems(account: string) {
  await ensureItemsTable();
  const { results } = await env.DB!.prepare("SELECT * FROM outfit_items WHERE owner_account = ? AND status != 'deleted' ORDER BY is_default DESC, updated_at DESC LIMIT 100").bind(account).all<ItemRow>();
  return (results || []).map(itemPublic);
}

export async function getItem(id: string): Promise<ItemRow | null> {
  await ensureItemsTable();
  return await env.DB!.prepare("SELECT * FROM outfit_items WHERE id = ?").bind(id).first<ItemRow>();
}

export async function createDraft(input: { id: string; account: string; name: string; description: string; generationId: string }) {
  await ensureItemsTable();
  await env.DB!.prepare("INSERT INTO outfit_items (id, owner_account, owner_name, description, generation_id, attempts) VALUES (?, ?, ?, ?, ?, 1)").bind(input.id, input.account, input.name, input.description.slice(0, 1000), input.generationId).run();
}

export async function setGeneration(id: string, generationId: string, description: string) {
  await ensureItemsTable();
  await env.DB!.prepare("UPDATE outfit_items SET generation_id = ?, attempts = attempts + 1, description = CASE WHEN ? != '' THEN ? ELSE description END, head_json = '', views_json = '', updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(generationId, description.slice(0, 1000), description.slice(0, 1000), id).run();
}

export type ItemUpdate = { name?: string; isDefault?: boolean; head?: unknown; views?: unknown; complete?: boolean; cover?: Uint8Array | null };

export async function updateItem(row: ItemRow, update: ItemUpdate) {
  await ensureItemsTable();
  let coverKey = row.cover_key;
  if (update.cover && assetStorageReady()) { coverKey = `outfit-item/${row.id}-cover.png`; await putAsset(coverKey, update.cover, "image/png"); }
  const status = update.complete ? "completed" : row.status;
  const isDefault = status === "completed" ? (update.isDefault === undefined ? Boolean(row.is_default) : update.isDefault) : false;
  const statements = [];
  if (isDefault) statements.push(env.DB!.prepare("UPDATE outfit_items SET is_default = 0 WHERE owner_account = ? AND id != ?").bind(row.owner_account, row.id));
  statements.push(env.DB!.prepare("UPDATE outfit_items SET name = ?, status = ?, is_default = ?, head_json = ?, views_json = ?, cover_key = ?, updated_at = CURRENT_TIMESTAMP, completed_at = CASE WHEN ? = 'completed' AND completed_at IS NULL THEN CURRENT_TIMESTAMP ELSE completed_at END WHERE id = ?")
    .bind(update.name === undefined ? row.name : update.name, status, isDefault ? 1 : 0, update.head === undefined ? row.head_json : JSON.stringify(update.head), update.views === undefined ? row.views_json : JSON.stringify(update.views), coverKey, status, row.id));
  await env.DB!.batch(statements);
}

export async function deleteItem(row: ItemRow) {
  await ensureItemsTable();
  await env.DB!.prepare("UPDATE outfit_items SET status = 'deleted', is_default = 0, deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(row.id).run();
}

export async function itemCover(row: ItemRow): Promise<ReadableStream | null> {
  return row.cover_key ? getAsset(row.cover_key) : null;
}
