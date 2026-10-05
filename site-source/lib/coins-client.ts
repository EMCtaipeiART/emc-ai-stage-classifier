import { env } from "cloudflare:workers";

// 平台幣在設計系統 Worker（machi-design-api）的帳本裡。這個站只做兩件事：
//   1. 生成前扣點（coinReserve）、沒有成功就退回（coinRefund）——要帶 COIN_SERVICE_KEY（只有這個站有），使用者自己打 API 不能扣也不能退。
//   2. 代使用者查餘額（coinMe）與轉讓（coinTransfer）——用使用者的設計系統 token 驗證身分。
const designApiUrl = () => process.env.DESIGN_API_URL || "https://machi-design-api.machi-chen.workers.dev/api"; // 只在本機測試時指向假的後端

export type CoinResponse = { ok?: boolean; error?: string; [key: string]: unknown };

export async function designApi(action: string, payload: Record<string, unknown>, withServiceKey = false): Promise<CoinResponse> {
  const init = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...payload, ...(withServiceKey ? { serviceKey: process.env.COIN_SERVICE_KEY || "" } : {}) }),
  };
  const response = env.DESIGN_API ? await env.DESIGN_API.fetch("https://machi-design-api/api", init) : await fetch(designApiUrl(), init);
  return await response.json().catch(() => ({ ok: false, error: "平台幣服務沒有回應" })) as CoinResponse;
}

export const editorTokenOf = (request: Request) => request.headers.get("x-emc-editor-token") || "";
