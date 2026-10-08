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
      // 發佈給 Pixel Office 遊戲用的資料（三個角度裁好的身體圖尺寸、頸頂位置、頭的設定）；沒有就是還沒發佈
      await env.DB!.exec("ALTER TABLE outfit_items ADD COLUMN game_json TEXT NOT NULL DEFAULT ''").catch(() => undefined);
      // 一次生成三組供選：目前選的是第幾組（0、1、2）
      await env.DB!.exec("ALTER TABLE outfit_items ADD COLUMN variant INTEGER NOT NULL DEFAULT 0").catch(() => undefined);
      // 製作單種類：outfit（服裝，預設）或 head（頭像）
      await env.DB!.exec("ALTER TABLE outfit_items ADD COLUMN kind TEXT NOT NULL DEFAULT 'outfit'").catch(() => undefined);
    })
    .catch((error) => { ready = null; throw error; });
  return ready;
}

export type ItemRow = { id: string; owner_account: string; owner_name: string; name: string; status: string; is_default: number; description: string; generation_id: string; attempts: number; head_json: string; views_json: string; cover_key: string; game_json: string; variant: number; kind: string; created_at: string; updated_at: string; completed_at: string | null; deleted_at: string | null };

export function itemPublic(row: ItemRow) {
  const parse = (value: string) => { try { return value ? JSON.parse(value) : null; } catch { return null; } };
  return {
    id: row.id, name: row.name, status: row.status, isDefault: Boolean(row.is_default), description: row.description, attempts: row.attempts,
    head: parse(row.head_json), views: parse(row.views_json), ownerName: row.owner_name, ownerAccount: row.owner_account,
    createdAt: row.created_at, updatedAt: row.updated_at, completedAt: row.completed_at,
    game: parse(row.game_json), published: Boolean(row.game_json),
    coverUrl: row.cover_key ? `/api/outfit/items/${row.id}/cover` : "",
    variant: row.variant || 0, kind: ["head", "cap", "glasses"].includes(row.kind) ? row.kind : "outfit",
    bodyUrl: row.generation_id ? `/api/outfit/history/${row.generation_id}/image?v=${row.variant || 0}` : "",
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

export async function createDraft(input: { id: string; account: string; name: string; description: string; generationId: string; kind?: "outfit" | "head" | "cap" | "glasses" }) {
  await ensureItemsTable();
  await env.DB!.prepare("INSERT INTO outfit_items (id, owner_account, owner_name, description, generation_id, attempts, kind) VALUES (?, ?, ?, ?, ?, 1, ?)").bind(input.id, input.account, input.name, input.description.slice(0, 1000), input.generationId, ["head", "cap", "glasses"].includes(input.kind || "") ? input.kind : "outfit").run();
}

export async function setGeneration(id: string, generationId: string, description: string) {
  await ensureItemsTable();
  await env.DB!.prepare("UPDATE outfit_items SET generation_id = ?, variant = 0, attempts = attempts + 1, description = CASE WHEN ? != '' THEN ? ELSE description END, head_json = '', views_json = '', updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(generationId, description.slice(0, 1000), description.slice(0, 1000), id).run();
}

export type ItemUpdate = { variant?: number; name?: string; isDefault?: boolean; head?: unknown; views?: unknown; complete?: boolean; cover?: Uint8Array | null; game?: unknown; viewImages?: Uint8Array[] | null };

export async function updateItem(row: ItemRow, update: ItemUpdate) {
  await ensureItemsTable();
  let coverKey = row.cover_key;
  if (update.cover && assetStorageReady()) { coverKey = `outfit-item/${row.id}-cover.png`; await putAsset(coverKey, update.cover, "image/png"); }
  let gameJson = row.game_json;
  if (update.game !== undefined && update.viewImages && update.viewImages.length === 3 && assetStorageReady()) {
    for (let index = 0; index < 3; index += 1) await putAsset(`outfit-item/${row.id}-v${index}.png`, update.viewImages[index], "image/png");
    gameJson = JSON.stringify(update.game);
  }
  const status = update.complete ? "completed" : row.status;
  const isDefault = status === "completed" ? (update.isDefault === undefined ? Boolean(row.is_default) : update.isDefault) : false;
  const statements = [];
  if (isDefault) statements.push(env.DB!.prepare("UPDATE outfit_items SET is_default = 0 WHERE owner_account = ? AND id != ?").bind(row.owner_account, row.id));
  statements.push(env.DB!.prepare("UPDATE outfit_items SET name = ?, status = ?, is_default = ?, variant = ?, head_json = ?, views_json = ?, cover_key = ?, game_json = ?, updated_at = CURRENT_TIMESTAMP, completed_at = CASE WHEN ? = 'completed' AND completed_at IS NULL THEN CURRENT_TIMESTAMP ELSE completed_at END WHERE id = ?")
    .bind(update.name === undefined ? row.name : update.name, status, isDefault ? 1 : 0, update.variant === undefined ? (row.variant || 0) : update.variant, update.head === undefined ? row.head_json : JSON.stringify(update.head), update.views === undefined ? row.views_json : JSON.stringify(update.views), coverKey, gameJson, status, row.id));
  await env.DB!.batch(statements);
}

export async function deleteItem(row: ItemRow) {
  await ensureItemsTable();
  await env.DB!.prepare("UPDATE outfit_items SET status = 'deleted', is_default = 0, deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(row.id).run();
}

export async function itemCover(row: ItemRow): Promise<ReadableStream | null> {
  return row.cover_key ? getAsset(row.cover_key) : null;
}

/** Pixel Office 遊戲用：已完成、已發佈、有設計師名字的服裝或頭像（公開，不含帳號）。服裝與頭像分開回傳：舊版遊戲只認 items（服裝），不會被頭像資料搞亂。 */
async function listPublished(kind: "outfit" | "head" | "cap" | "glasses") {
  await ensureItemsTable();
  const { results } = await env.DB!.prepare("SELECT * FROM outfit_items WHERE status = 'completed' AND game_json != '' AND owner_name != '' AND kind = ? ORDER BY updated_at DESC LIMIT 300").bind(kind).all<ItemRow>();
  return (results || []).map((row) => {
    let game = null;
    try { game = JSON.parse(row.game_json); } catch { /* 壞掉的就略過 */ }
    return { id: row.id, name: row.name, owner: row.owner_name, isDefault: Boolean(row.is_default), game, v: row.updated_at };
  }).filter((entry) => entry.game);
}
export const listPublishedItems = () => listPublished("outfit");
export const listPublishedHeads = () => listPublished("head");
export const listPublishedCaps = () => listPublished("cap");
export const listPublishedGlasses = () => listPublished("glasses");

export async function publishedViewImage(id: string, view: number): Promise<ReadableStream | null> {
  const row = await getItem(id);
  if (!row || row.status !== "completed" || !row.game_json || view < 0 || view > 2) return null;
  return getAsset(`outfit-item/${id}-v${view}.png`);
}
