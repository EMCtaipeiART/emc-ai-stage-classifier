import { env } from "cloudflare:workers";

// 驗證：只認 X-EMC-Editor-Token（EMC 設計需求系統已登入帳號的 token，向 machi-design-api 驗證）。團隊密碼已於 2026-11-02 移除。
export const AUTH_COOKIE = "emc_stage_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30;
export const ACCESS_HEADER = "x-emc-access";
export const EDITOR_TOKEN_HEADER = "x-emc-editor-token";

const designApiUrl = () => process.env.DESIGN_API_URL || "https://machi-design-api.machi-chen.workers.dev/api"; // DESIGN_API_URL 只在本機測試時用來指向假的後端
const DEFAULT_ALLOWED_ORIGINS = ["https://emctaipeiart.github.io"];
const EDITOR_CACHE_MS = 5 * 60 * 1000;
const editorTokenCache = new Map<string, { account: string; expiresAt: number }>();

export function accessPassword() {
  return process.env.ACCESS_PASSWORD || "";
}

// Token 只是密碼的雜湊；改密碼後舊的登入狀態自動失效
export async function sessionToken(password: string) {
  const bytes = new TextEncoder().encode(`emc-stage-classifier:${password}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function safeReturnPath(value: string | null) {
  return value && value.startsWith("/") && !value.startsWith("//") ? value : "/";
}

export function allowedOrigin(origin: string | null) {
  if (!origin) return "";
  const configured = (process.env.ALLOWED_ORIGINS || "").split(",").map((value) => value.trim()).filter(Boolean);
  const allowed = configured.length ? configured : DEFAULT_ALLOWED_ORIGINS;
  const local = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  return allowed.includes(origin) || local ? origin : "";
}

export function corsHeaders(origin: string) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": `Content-Type, ${ACCESS_HEADER}, ${EDITOR_TOKEN_HEADER}`,
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}

async function verifyEditorToken(token: string): Promise<string> {
  const cached = editorTokenCache.get(token);
  if (cached && cached.expiresAt > Date.now()) return cached.account;
  const init = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "verifyToken", editorToken: token }),
  };
  // 同一個 Cloudflare 帳號的 Worker 互打 workers.dev 可能被擋，部署時用 Service Binding
  const response = env.DESIGN_API
    ? await env.DESIGN_API.fetch("https://machi-design-api/api", init)
    : await fetch(designApiUrl(), init);
  const payload = await response.json().catch(() => ({})) as { ok?: boolean; account?: string; user?: string };
  const account = payload.ok ? String(payload.account || payload.user || "") : "";
  if (account) editorTokenCache.set(token, { account, expiresAt: Date.now() + EDITOR_CACHE_MS });
  return account;
}

/** 回傳通過驗證的使用者代號；未通過回傳 null。只認 EMC 設計需求系統已登入帳號的 token（不再有團隊密碼）；只有本機開發（非 production）不擋。 */
export async function authorize(request: Request, _cookieValue?: string): Promise<string | null> {
  if (process.env.NODE_ENV !== "production") return "local-user";
  const editorToken = request.headers.get(EDITOR_TOKEN_HEADER);
  if (editorToken) {
    let account = await verifyEditorToken(editorToken).catch(() => "");
    if (!account) account = await verifyEditorToken(editorToken).catch(() => "");   // 後端瞬斷時再驗一次
    if (account) return account;
  }
  return null;
}

/** 目前登入者的代號（紀錄用）：已登入帳號用帳號名，團隊密碼登入是 "team-password"，本機沒設密碼是 "local-user"。 */
export async function currentUser(request: Request): Promise<string> {
  const cookie = (request.headers.get("cookie") || "").split(/;\s*/).find((part) => part.startsWith(`${AUTH_COOKIE}=`));
  return (await authorize(request, cookie ? cookie.slice(AUTH_COOKIE.length + 1) : undefined).catch(() => null)) || "unknown";
}
