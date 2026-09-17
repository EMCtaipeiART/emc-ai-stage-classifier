// 團隊密碼登入：Cloudflare 上設定 ACCESS_PASSWORD secret 才會啟用；本機未設定時不擋。
export const AUTH_COOKIE = "emc_stage_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30;

export function accessPassword() {
  return process.env.ACCESS_PASSWORD || "";
}

// Cookie 只存密碼的雜湊；改密碼後舊的登入狀態自動失效
export async function sessionToken(password: string) {
  const bytes = new TextEncoder().encode(`emc-stage-classifier:${password}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function safeReturnPath(value: string | null) {
  return value && value.startsWith("/") && !value.startsWith("//") ? value : "/";
}
