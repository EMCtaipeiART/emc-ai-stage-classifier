import { env, waitUntil } from "cloudflare:workers";
import { deleteAsset, getAsset, putAsset } from "@/lib/storage";
import { saveOutfitRecord } from "@/lib/outfit-history";
import { IMAGE_MODEL_DEFAULT } from "@/lib/outfit-spec";
import { FIXED_SEATS, SEAT_KEYS } from "@/lib/seat-layout";
import { canManageAll, designApi, editorTokenOf, whoami, type Who } from "@/lib/coins-client";

// 角色工坊（2026-11-02）：上傳照片 → AI 三視圖 → 對位確認 → AI 補其餘 8 個角度 → 烘焙 12 視角圖集 → 發佈給 3D 辦公室。
// 資料表第一次用到才建（原因同 outfit-history.ts）。圖檔存 R2／KV：char/<jobId>/<name>.png、發佈版 charpub/<人名>/<檔名>。
let ready: Promise<void> | null = null;
export function ensureCharacterTables() {
  if (!env.DB) throw new Error("儲存空間尚未啟用。");
  ready ||= env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS character_jobs (id TEXT PRIMARY KEY, account TEXT NOT NULL, name TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'views3', prompt TEXT NOT NULL DEFAULT '', described TEXT NOT NULL DEFAULT '', start_runs INTEGER NOT NULL DEFAULT 1, angles_json TEXT NOT NULL DEFAULT '{}', align_json TEXT NOT NULL DEFAULT '', cost_usd REAL NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS character_seats (name TEXT PRIMARY KEY, seat TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS character_published (name TEXT PRIMARY KEY, version INTEGER NOT NULL DEFAULT 1, job_id TEXT NOT NULL DEFAULT '', account TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"),
  ]).then(() => env.DB!.prepare("ALTER TABLE character_jobs ADD COLUMN publish_name TEXT NOT NULL DEFAULT ''").run().catch(() => undefined))   // 這張製作單要發佈給誰（已有欄位會報錯，略過）
    .then(() => undefined).catch((error) => { ready = null; throw error; });
  return ready;
}

export type JobRow = { id: string; account: string; name: string; status: string; prompt: string; described: string; start_runs: number; angles_json: string; align_json: string; cost_usd: number; created_at: string; updated_at: string };
/** 視角（度）：0 正面、90 朝右側面、180 背面；270 是 90 的鏡像（不用生成）。要 AI 生成的是其餘 8 個。 */
/** 8 角度合圖在次數紀錄裡用的編號（不是真的角度）。 */
export const GRID_KEY = 0;
export const AI_ANGLES = [30, 60, 120, 150, 210, 240, 300, 330] as const;
export const FREE_START_RUNS = 3;   // 每人最多重新生成三視圖幾次（管理者不限）

export const jobKey = (id: string, name: string) => `char/${id}/${name}.png`;
export const angleName = (deg: number) => `a${String(deg).padStart(3, "0")}`;

/** 能用角色工坊的人：設計部、企劃部、專案部同仁與管理者。 */
export function canUseCharacterStudio(who: Who) {
  return canManageAll(who) || who.designer || who.pixelDesigner || /企劃部|專案部|設計部/.test(who.department || "");
}

/** 管理者可以把角色發佈給誰：後台資料庫「帳號設定」裡全部人員（所有部門），加上 Pixel Office 12 人與自己。 */
export async function publishTargets(who: Who, request: Request): Promise<string[]> {
  const roster = await designApi("characterRoster", { editorToken: editorTokenOf(request) }).catch(() => null);
  const names = roster?.ok && Array.isArray(roster.names) ? (roster.names as unknown[]).map(String) : who.directory;   // 後端還沒更新時退回舊名單
  return [...new Set([...names, who.name].filter(Boolean))];
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

export async function publishedAsOf(jobId: string): Promise<string> {
  await ensureCharacterTables();
  return (await env.DB!.prepare("SELECT name FROM character_published WHERE job_id = ?").bind(jobId).first<{ name: string }>())?.name || "";
}

export function jobPublic(job: JobRow) {
  const parse = (value: string, fallback: unknown) => { try { return value ? JSON.parse(value) : fallback; } catch { return fallback; } };
  return { id: job.id, status: job.status, prompt: job.prompt, startRuns: job.start_runs, angles: parse(job.angles_json, {}), align: parse(job.align_json, null), updatedAt: job.updated_at };
}

export async function updateJob(id: string, patch: { status?: string; anglesJson?: string; alignJson?: string; addCost?: number; startRuns?: number; described?: string }) {
  await env.DB!.prepare("UPDATE character_jobs SET status = COALESCE(?, status), angles_json = COALESCE(?, angles_json), align_json = COALESCE(?, align_json), cost_usd = cost_usd + ?, start_runs = COALESCE(?, start_runs), described = COALESCE(?, described), updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .bind(patch.status ?? null, patch.anglesJson ?? null, patch.alignJson ?? null, patch.addCost ?? 0, patch.startRuns ?? null, patch.described ?? null, id).run();
}

/** 原子地把某個角度的次數加一（兩個角度同時完成時，不能互相蓋掉對方的紀錄）。 */
export async function bumpAngle(id: string, deg: number, cost: number) {
  await env.DB!.prepare(`UPDATE character_jobs SET angles_json = json_set(COALESCE(NULLIF(angles_json, ''), '{}'), '$."${Math.trunc(deg)}"', COALESCE(json_extract(COALESCE(NULLIF(angles_json, ''), '{}'), '$."${Math.trunc(deg)}"'), 0) + 1), cost_usd = cost_usd + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(cost, id).run();
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
      // 生成會花錢：就算使用者中途關掉頁面，也要讓伺服器把這一張做完並存起來（waitUntil），下次回來直接讀取，不用重算
      const job = work();
      try { waitUntil(job.catch(() => undefined)); } catch { /* 沒有 waitUntil（本機）就照常 */ }
      try { controller.enqueue(encoder.encode(JSON.stringify(await job))); }
      catch (cause) { controller.enqueue(encoder.encode(JSON.stringify({ error: cause instanceof Error ? cause.message : "生成失敗，請稍後再試。" }))); }
      finally { clearInterval(beat); controller.close(); }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}

export const PNG_HEADERS = { "Content-Type": "image/png", "Cache-Control": "no-store" } as const;
export const isPng = (b: Uint8Array) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;

/** 每次 AI 呼叫（成功或失敗）都記進「生成紀錄」（和服裝生成同一張表），描述前面加 [角色工坊・…] 方便辨認。記錄失敗不影響生成。 */
export async function logGeneration(opts: { userId: string; label: string; description: string; described?: string; seconds: number; jobId: string; png?: Uint8Array; costUsd?: number; usage?: { input: number; output: number; total: number }; model?: string; transparent?: boolean; error?: string }) {
  try {
    await saveOutfitRecord({
      id: crypto.randomUUID(), userId: opts.userId, status: opts.error ? "failed" : "ok", model: opts.model || process.env.OPENAI_IMAGE_MODEL || IMAGE_MODEL_DEFAULT, quality: "high",
      description: `[角色工坊・${opts.label}] ${opts.description}`, described: opts.described || "", photoCount: opts.label === "三視圖" ? 1 : 0, seconds: opts.seconds,
      usage: { input: opts.usage?.input ?? 0, output: opts.usage?.output ?? 0, total: opts.usage?.total ?? 0, costUsd: opts.costUsd ?? 0 },
      transparent: opts.transparent ?? true, error: opts.error || "", pngs: opts.png ? [opts.png] : [], coinCost: 0, coinExempt: true, itemId: opts.jobId, attempt: 1,
    });
  } catch { /* 紀錄寫入失敗就算了 */ }
}

export async function listAllJobs(account = "") {
  await ensureCharacterTables();
  const { results } = await env.DB!.prepare(`SELECT j.*, p.name AS published_as FROM character_jobs j LEFT JOIN character_published p ON p.job_id = j.id ${account ? "WHERE j.account = ?" : ""} ORDER BY j.created_at DESC LIMIT 100`).bind(...(account ? [account] : [])).all<JobRow & { published_as: string | null; publish_name?: string }>();
  return (results || []).map((row) => {
    let done = 0; try { done = Object.keys(JSON.parse(row.angles_json || "{}")).length; } catch { /* 略過 */ }
    return { id: row.id, account: row.account, ownerName: row.name, status: row.status, prompt: row.prompt, startRuns: row.start_runs, anglesDone: done, costUsd: row.cost_usd, createdAt: row.created_at, updatedAt: row.updated_at, publishedAs: row.published_as || "", target: row.publish_name || "" };
  });
}

/** 取消上線：3D 辦公室下次載入就退回本機圖集。 */
export async function unpublishJob(jobId: string) {
  await ensureCharacterTables();
  const rows = await env.DB!.prepare("SELECT name FROM character_published WHERE job_id = ?").bind(jobId).all<{ name: string }>();
  for (const row of rows.results || []) {
    await deleteAsset(`charpub/${row.name}/atlas.png`).catch(() => undefined);
    await deleteAsset(`charpub/${row.name}/atlas-hd.png`).catch(() => undefined);
  }
  await env.DB!.prepare("DELETE FROM character_published WHERE job_id = ?").bind(jobId).run();
}

/** 把已發佈的圖集改發佈給另一個人（原本那位退回本機圖集）。 */
export async function moveJobPublish(jobId: string, account: string, to: string) {
  await ensureCharacterTables();
  const from = await env.DB!.prepare("SELECT name FROM character_published WHERE job_id = ?").bind(jobId).first<{ name: string }>();
  if (!from) throw new Error("這張製作單還沒有發佈。");
  if (from.name === to) return;
  for (const file of ["atlas", "atlas-hd"]) {
    const bytes = await readAsset(`charpub/${from.name}/${file}.png`);
    if (!bytes) throw new Error("找不到已發佈的圖集。");
    await putAsset(`charpub/${to}/${file}.png`, bytes, "image/png");
  }
  await unpublishJob(jobId);
  await setPublished(to, jobId, account);
}

export async function deleteJob(jobId: string) {
  await unpublishJob(jobId);
  for (const name of ["views3", "sheet", "grid", "atlas", "atlas-hd", "avatar", ...AI_ANGLES.map(angleName)]) await deleteAsset(jobKey(jobId, name)).catch(() => undefined);
  await env.DB!.prepare("DELETE FROM character_jobs WHERE id = ?").bind(jobId).run();
}

// ---- 座位（3D 辦公室）：每個發佈角色可以指定一個座位，沒指定就在辦公室自由走動；隨時可以改。 ----
// 座位編號與座標表在 lib/seat-layout.ts（"S:x:z:t|b"）；固定座位的人（3D 辦公室寫死的 12 位設計部人物）不能被別人佔走。
export { FIXED_SEATS } from "@/lib/seat-layout";
export const validSeat = (seat: string) => SEAT_KEYS.has(seat);

export async function seatMap(): Promise<Record<string, string>> {
  await ensureCharacterTables();
  const { results } = await env.DB!.prepare("SELECT name, seat FROM character_seats WHERE seat != ''").all<{ name: string; seat: string }>();
  return Object.fromEntries((results || []).map((row) => [row.name, row.seat]));
}

/** 設定座位（空字串＝清除、自由走動）。座位已被固定人物或別人佔用會丟錯。 */
export async function setSeat(name: string, seat: string) {
  await ensureCharacterTables();
  if (seat) {
    if (!validSeat(seat)) throw new Error("座位編號不正確。");
    const fixed = Object.entries(FIXED_SEATS).find(([, s]) => s === seat);
    if (fixed && fixed[0] !== name) throw new Error(`這個座位是 ${fixed[0]} 的固定座位。`);
    const taken = Object.entries(await seatMap()).find(([n, s]) => s === seat && n !== name);
    if (taken) throw new Error(`這個座位已經是 ${taken[0]} 的了。`);
  }
  await env.DB!.prepare("INSERT INTO character_seats (name, seat) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET seat = excluded.seat, updated_at = CURRENT_TIMESTAMP").bind(name, seat).run();
}

/** 把這張製作單設為某人的預設角色：把它存好的圖集複製到發佈位置，並（本人的）頭像快照一起換成這套的正面。 */
export async function makeDefault(job: JobRow, who: Who, request: Request, name: string): Promise<{ avatarSaved: boolean }> {
  const small = await readAsset(jobKey(job.id, "atlas")), big = await readAsset(jobKey(job.id, "atlas-hd"));
  if (!small || !big) throw new Error("這套還沒有存好的圖集（舊版製作單），請開啟後重新按「確認上線」一次。");
  await putAsset(`charpub/${name}/atlas.png`, small, "image/png");
  await putAsset(`charpub/${name}/atlas-hd.png`, big, "image/png");
  await setPublished(name, job.id, job.account);
  await env.DB!.prepare("UPDATE character_jobs SET status = 'published', publish_name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(name, job.id).run();
  let avatarSaved = false;
  if (job.account === who.account && name === who.name) {
    const avatar = await readAsset(jobKey(job.id, "avatar"));
    if (avatar) {
      let bin = ""; for (const byte of avatar) bin += String.fromCharCode(byte);
      const result = await designApi("personaAvatarSnapshot", { editorToken: editorTokenOf(request), png: "data:image/png;base64," + btoa(bin), lookKey: `char:${job.id}`, headId: "", outfitId: "" }).catch(() => null);
      avatarSaved = Boolean(result?.ok);
    }
  }
  return { avatarSaved };
}
