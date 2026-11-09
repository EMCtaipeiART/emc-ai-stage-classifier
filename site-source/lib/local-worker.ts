import { env } from "cloudflare:workers";

/**
 * 本機算圖工作者（Machi 的 iMac，用 Codex 內建畫圖，不計 API 費用）。
 * 工作單與心跳都存在 KV（ASSETS_KV），不需要資料庫遷移。工作者每 30 秒打一次心跳；超過 2 分鐘沒心跳就視為沒開機，
 * 前端會自動退回原本的 API 算圖。
 */
export type TaskKind = "grid" | "walk";
export type Task = {
  kind: TaskKind; id: string; status: "queued" | "running" | "done" | "failed" | "expired";
  createdAt: number; claimedAt?: number; updatedAt: number; finishedAt?: number;
  step?: string; pct?: number; note?: string; error?: string;
  name?: string; version?: number;   // walk：發佈給誰、圖集版本
};
export const ONLINE_MS = 120_000;
export const CLAIM_TIMEOUT_MS = 90_000;     // 排進佇列後 90 秒沒人接單 → 視為工作者沒反應，退回 API
export const STALE_RUN_MS = 12 * 60_000;    // 接單後 12 分鐘沒更新進度 → 視為中斷
const DEFAULT_SEC = { grid: 300, walk: 540 };

const kv = () => { if (!env.ASSETS_KV) throw new Error("沒有 KV"); return env.ASSETS_KV; };
const taskKey = (kind: TaskKind, id: string) => `lw/task/${kind}/${id}`;

export function keyOk(request: Request): boolean {
  const want = process.env.LOCAL_WORKER_KEY || "", got = request.headers.get("x-worker-key") || "";
  if (!want || want.length < 16 || got.length !== want.length) return false;
  let diff = 0; for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ got.charCodeAt(i);
  return diff === 0;
}

export async function beat() { await kv().put("lw/heartbeat", String(Date.now())); }
export async function isOnline(): Promise<boolean> {
  try { const t = Number(await kv().get("lw/heartbeat")); return Boolean(t) && Date.now() - t < ONLINE_MS; } catch { return false; }
}
export async function getTask(kind: TaskKind, id: string): Promise<Task | null> {
  try { const raw = await kv().get(taskKey(kind, id)); return raw ? JSON.parse(raw) as Task : null; } catch { return null; }
}
export async function putTask(task: Task) { await kv().put(taskKey(task.kind, task.id), JSON.stringify(task), { expirationTtl: 14 * 86400 }); }
export async function enqueue(kind: TaskKind, id: string, extra: Partial<Task> = {}): Promise<Task> {
  const now = Date.now();
  const task: Task = { kind, id, status: "queued", createdAt: now, updatedAt: now, step: "排隊中", pct: 0, ...extra };
  await putTask(task); return task;
}
/** 讀任務並套用逾時規則（沒人接單、或接單後太久沒更新）。 */
export async function currentTask(kind: TaskKind, id: string): Promise<Task | null> {
  const t = await getTask(kind, id); if (!t) return null;
  const now = Date.now();
  // 算圖（grid）要使用者在等：沒人接單就退回 API。走路（walk）不急，一直排隊等電腦開機
  if (kind === "grid" && t.status === "queued" && now - t.createdAt > CLAIM_TIMEOUT_MS) { t.status = "expired"; t.error = "電腦沒有回應"; await putTask(t); }
  if (t.status === "running" && now - t.updatedAt > STALE_RUN_MS) { t.status = "failed"; t.error = "電腦太久沒有回報進度"; await putTask(t); }
  return t;
}
export async function claimNext(): Promise<Task | null> {
  const list = await kv().list({ prefix: "lw/task/" });
  const tasks: Task[] = [];
  for (const k of list.keys) { try { const raw = await kv().get(k.name); if (raw) tasks.push(JSON.parse(raw) as Task); } catch { /* 略過壞掉的 */ } }
  const now = Date.now();
  const open = tasks.filter((t) => t.status === "queued" && !(t.kind === "grid" && now - t.createdAt > CLAIM_TIMEOUT_MS))
    .concat(tasks.filter((t) => t.status === "running" && now - t.updatedAt > STALE_RUN_MS));   // 接單的人當掉了：重新分配
  open.sort((a, b) => (a.kind === b.kind ? a.createdAt - b.createdAt : a.kind === "grid" ? -1 : 1));   // 使用者在等的 grid 優先
  const t = open[0]; if (!t) return null;
  t.status = "running"; t.claimedAt = now; t.updatedAt = now; t.step = "電腦接單了"; t.pct = 2; await putTask(t); return t;
}

export async function stats(): Promise<{ grid: number; walk: number }> {
  try { const raw = await kv().get("lw/stats"); const s = raw ? JSON.parse(raw) : {}; return { grid: s.grid || DEFAULT_SEC.grid, walk: s.walk || DEFAULT_SEC.walk }; } catch { return { ...DEFAULT_SEC }; }
}
export async function recordDuration(kind: TaskKind, sec: number) {
  const s = await stats(); s[kind] = Math.round(s[kind] * 0.6 + Math.max(30, Math.min(1800, sec)) * 0.4);   // 移動平均，越新的越重
  await kv().put("lw/stats", JSON.stringify(s));
}
export async function setWalkVersion(name: string, version: number) { await kv().put(`lw/walkver/${name}`, String(version)); }
export async function walkVersions(): Promise<Record<string, number>> {
  try {
    const list = await kv().list({ prefix: "lw/walkver/" });
    const out: Record<string, number> = {};
    for (const k of list.keys) { const v = Number(await kv().get(k.name)); if (v) out[k.name.slice("lw/walkver/".length)] = v; }
    return out;
  } catch { return {}; }
}
