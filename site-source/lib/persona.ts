import { env } from "cloudflare:workers";

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
export const FREE_RUN_LIMIT = 8;   // 測試期免費：每個帳號最多生成 8 次（頭像與身體各算一次）

export function personaPublic(row: PersonaRow | null) {
  return row ? { step: row.step, headItemId: row.head_item_id, outfitItemId: row.outfit_item_id, freeRuns: row.free_runs, freeLimit: FREE_RUN_LIMIT, completed: Boolean(row.completed_at), completedAt: row.completed_at } : { step: "upload", headItemId: "", outfitItemId: "", freeRuns: 0, freeLimit: FREE_RUN_LIMIT, completed: false, completedAt: null };
}

export async function getPersona(account: string): Promise<PersonaRow | null> {
  await ensurePersonaTable();
  return await env.DB!.prepare("SELECT * FROM persona_profiles WHERE account = ?").bind(account).first<PersonaRow>();
}

export async function upsertPersona(account: string, name: string, patch: { headItemId?: string; outfitItemId?: string; step?: string; complete?: boolean }) {
  await ensurePersonaTable();
  const row = await getPersona(account);
  if (!row) await env.DB!.prepare("INSERT OR IGNORE INTO persona_profiles (account, name) VALUES (?, ?)").bind(account, name).run();
  await env.DB!.prepare("UPDATE persona_profiles SET name = CASE WHEN ? != '' THEN ? ELSE name END, head_item_id = COALESCE(?, head_item_id), outfit_item_id = COALESCE(?, outfit_item_id), step = COALESCE(?, step), completed_at = CASE WHEN ? = 1 AND completed_at IS NULL THEN CURRENT_TIMESTAMP ELSE completed_at END, updated_at = CURRENT_TIMESTAMP WHERE account = ?")
    .bind(name, name, patch.headItemId ?? null, patch.outfitItemId ?? null, patch.step ?? null, patch.complete ? 1 : 0, account).run();
}

/** 免費生成次數 +1；超過上限回傳 false（不增加）。 */
export async function takeFreeRun(account: string, name: string): Promise<boolean> {
  await ensurePersonaTable();
  const row = await getPersona(account);
  if (!row) await env.DB!.prepare("INSERT OR IGNORE INTO persona_profiles (account, name) VALUES (?, ?)").bind(account, name).run();
  if ((row?.free_runs || 0) >= FREE_RUN_LIMIT) return false;
  await env.DB!.prepare("UPDATE persona_profiles SET free_runs = free_runs + 1, updated_at = CURRENT_TIMESTAMP WHERE account = ?").bind(account).run();
  return true;
}
