import { env } from "cloudflare:workers";
import { getAsset, putAsset } from "@/lib/storage";
import { canManageAll, whoami, type Who } from "@/lib/coins-client";

// 角色工坊（2026-11-02）：上傳照片 → AI 三視圖 → 對位確認 → AI 補其餘 8 個角度 → 烘焙 12 視角圖集 → 發佈給 3D 辦公室。
// 資料表第一次用到才建（原因同 outfit-history.ts）。圖檔存 R2／KV：char/<jobId>/<name>.png、發佈版 charpub/<人名>/<檔名>。
let ready: Promise<void> | null = null;
export function ensureCharacterTables() {
  if (!env.DB) throw new Error("儲存空間尚未啟用。");
  ready ||= env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS character_jobs (id TEXT PRIMARY KEY, account TEXT NOT NULL, name TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'views3', prompt TEXT NOT NULL DEFAULT '', described TEXT NOT NULL DEFAULT '', start_runs INTEGER NOT NULL DEFAULT 1, angles_json TEXT NOT NULL DEFAULT '{}', align_json TEXT NOT NULL DEFAULT '', cost_usd REAL NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS character_published (name TEXT PRIMARY KEY, version INTEGER NOT NULL DEFAULT 1, job_id TEXT NOT NULL DEFAULT '', account TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"),
  ]).then(() => undefined).catch((error) => { ready = null; throw error; });
  return ready;
}

export type JobRow = { id: string; account: string; name: string; status: string; prompt: string; described: string; start_runs: number; angles_json: string; align_json: string; cost_usd: number; created_at: string; updated_at: string };
/** 視角（度）：0 正面、90 朝右側面、180 背面；270 是 90 的鏡像（不用生成）。要 AI 生成的是其餘 8 個。 */
export const AI_ANGLES = [30, 60, 120, 150, 210, 240, 300, 330] as const;
export const FREE_START_RUNS = 3;   // 每人最多重新生成三視圖幾次（管理者不限）

export const jobKey = (id: string, name: string) => `char/${id}/${name}.png`;
export const angleName = (deg: number) => `a${String(deg).padStart(3, "0")}`;

/** 能用角色工坊的人：設計部、企劃部、專案部同仁與管理者。 */
export function canUseCharacterStudio(who: Who) {
  return canManageAll(who) || who.designer || who.pixelDesigner || /企劃部|專案部|設計部/.test(who.department || "");
}

export async function requireWho(request: Request): Promise<{ who: Who } | { error: Response }> {
  const who = await whoami(request);
  if (!who) return { error: Response.json({ error: "登入已過期，請回設計需求系統重新登入後再進入。", reason: "TOKEN_EXPIRED" }, { status: 401 }) };
  if (!canUseCharacterStudio(who)) return { error: Response.json({ error: "角色工坊僅限設計部、企劃部、專案部同仁與管理者使用。" }, { status: 403 }) };
  return { who };
}

export async function getJob(id: string): Promise<JobRow | null> {
  await ensureCharacterTables();
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  return await env.DB!.prepare("SELECT * FROM character_jobs WHERE id = ?").bind(id).first<JobRow>();
}

/** 取得自己的製作單；管理者與 Machi 可以看別人的（除錯用）。 */
export async function ownJob(id: string, who: Who): Promise<JobRow | null> {
  const job = await getJob(id);
  return job && (job.account === who.account || canManageAll(who)) ? job : null;
}

export async function latestJob(account: string): Promise<JobRow | null> {
  await ensureCharacterTables();
  return await env.DB!.prepare("SELECT * FROM character_jobs WHERE account = ? ORDER BY created_at DESC, rowid DESC LIMIT 1").bind(account).first<JobRow>();
}

export function jobPublic(job: JobRow) {
  const parse = (value: string, fallback: unknown) => { try { return value ? JSON.parse(value) : fallback; } catch { return fallback; } };
  return { id: job.id, status: job.status, prompt: job.prompt, startRuns: job.start_runs, angles: parse(job.angles_json, {}), align: parse(job.align_json, null), updatedAt: job.updated_at };
}

export async function updateJob(id: string, patch: { status?: string; anglesJson?: string; alignJson?: string; addCost?: number; startRuns?: number; described?: string }) {
  await env.DB!.prepare("UPDATE character_jobs SET status = COALESCE(?, status), angles_json = COALESCE(?, angles_json), align_json = COALESCE(?, align_json), cost_usd = cost_usd + ?, start_runs = COALESCE(?, start_runs), described = COALESCE(?, described), updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .bind(patch.status ?? null, patch.anglesJson ?? null, patch.alignJson ?? null, patch.addCost ?? 0, patch.startRuns ?? null, patch.described ?? null, id).run();
}

export async function readAsset(key: string): Promise<Uint8Array | null> {
  const stream = await getAsset(key);
  return stream ? new Uint8Array(await new Response(stream).arrayBuffer()) : null;
}
export { putAsset };

export async function publishedList(): Promise<Record<string, number>> {
  await ensureCharacterTables();
  const { results } = await env.DB!.prepare("SELECT name, version FROM character_published").all<{ name: string; version: number }>();
  return Object.fromEntries((results || []).map((row) => [row.name, row.version]));
}

export async function setPublished(name: string, jobId: string, account: string) {
  await ensureCharacterTables();
  await env.DB!.prepare("INSERT INTO character_published (name, version, job_id, account) VALUES (?, 1, ?, ?) ON CONFLICT(name) DO UPDATE SET version = version + 1, job_id = excluded.job_id, account = excluded.account, updated_at = CURRENT_TIMESTAMP").bind(name, jobId, account).run();
}

/** 長時間生成：先回應、每 8 秒送一個空白當心跳（Cloudflare 約 100 秒沒回應會中斷），最後才送 JSON。 */
export function heartbeatJson(work: () => Promise<unknown>): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const beat = setInterval(() => { try { controller.enqueue(encoder.encode(" ")); } catch { /* 已關閉 */ } }, 8000);
      try { controller.enqueue(encoder.encode(JSON.stringify(await work()))); }
      catch (cause) { controller.enqueue(encoder.encode(JSON.stringify({ error: cause instanceof Error ? cause.message : "生成失敗，請稍後再試。" }))); }
      finally { clearInterval(beat); controller.close(); }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}

export const PNG_HEADERS = { "Content-Type": "image/png", "Cache-Control": "no-store" } as const;
export const isPng = (b: Uint8Array) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
