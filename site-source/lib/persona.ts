import { env } from "cloudflare:workers";
import { getItem } from "@/lib/outfit-items";

// 個人形象（企劃／專案人員第一次進服裝頁建立自己的角色）：上傳個人照 → 生成頭像與身體各三個 → 各選一個 → 拼接 → 完成。
// 完成後這個入口就不再出現。資料表第一次用到才建（原因同 outfit-history.ts）。
let ready: Promise<void> | null = null;
export function ensurePersonaTable() {
  if (!env.DB) throw new Error("儲存空間尚未啟用。");
  ready ||= env.DB.exec("CREATE TABLE IF NOT EXISTS persona_profiles (account TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '', head_item_id TEXT NOT NULL DEFAULT '', outfit_item_id TEXT NOT NULL DEFAULT '', step TEXT NOT NULL DEFAULT 'upload', free_runs INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, completed_at TEXT)")
    .then(() => undefined)
    .catch((error) => { ready = null; throw error; });
  return ready;
}

export type PersonaRow = { account: string; name: string; head_item_id: string; outfit_item_id: string; step: string; free_runs: number; created_at: string; updated_at: string; completed_at: string | null };

export function personaPublic(row: PersonaRow | null) {
  return row ? { step: row.step, headItemId: row.head_item_id, outfitItemId: row.outfit_item_id, completed: Boolean(row.completed_at), completedAt: row.completed_at } : { step: "upload", headItemId: "", outfitItemId: "", completed: false, completedAt: null };
}

export async function getPersona(account: string): Promise<PersonaRow | null> {
  await ensurePersonaTable();
  return await env.DB!.prepare("SELECT * FROM persona_profiles WHERE account = ?").bind(account).first<PersonaRow>();
}

export async function getPersonaByName(name: string): Promise<PersonaRow | null> {
  await ensurePersonaTable();
  return await env.DB!.prepare("SELECT * FROM persona_profiles WHERE name = ? AND head_item_id != '' ORDER BY updated_at DESC LIMIT 1").bind(name).first<PersonaRow>();
}

export async function upsertPersona(account: string, name: string, patch: { headItemId?: string; outfitItemId?: string; step?: string; complete?: boolean }) {
  await ensurePersonaTable();
  const row = await getPersona(account);
  if (!row) await env.DB!.prepare("INSERT OR IGNORE INTO persona_profiles (account, name) VALUES (?, ?)").bind(account, name).run();
  await env.DB!.prepare("UPDATE persona_profiles SET name = CASE WHEN ? != '' THEN ? ELSE name END, head_item_id = COALESCE(?, head_item_id), outfit_item_id = COALESCE(?, outfit_item_id), step = COALESCE(?, step), completed_at = CASE WHEN ? = 1 AND completed_at IS NULL THEN CURRENT_TIMESTAMP ELSE completed_at END, updated_at = CURRENT_TIMESTAMP WHERE account = ?")
    .bind(name, name, patch.headItemId ?? null, patch.outfitItemId ?? null, patch.step ?? null, patch.complete ? 1 : 0, account).run();
}

/** 每人每種（頭像、身體）只能生成一次：已經有一件還沒刪除的製作單就不能再生成。生成失敗沒有製作單，可以重試。 */
export async function alreadyGenerated(account: string, kind: "head" | "outfit"): Promise<boolean> {
  const row = await getPersona(account);
  const id = kind === "head" ? row?.head_item_id : row?.outfit_item_id;
  if (!id) return false;
  const item = await getItem(id);
  return Boolean(item && item.status !== "deleted");
}
