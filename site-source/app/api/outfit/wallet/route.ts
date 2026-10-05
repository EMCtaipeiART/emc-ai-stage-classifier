import { designApi, editorTokenOf } from "@/lib/coins-client";

/** 我的平台幣：餘額、最近紀錄、可轉讓的對象。 */
export async function GET(request: Request) {
  const token = editorTokenOf(request);
  if (!token) return Response.json({ error: "請從設計需求系統登入後進入這個頁面。", reason: "LOGIN_REQUIRED" }, { status: 401 });
  const result = await designApi("coinMe", { editorToken: token });
  if (!result.ok) return Response.json({ error: result.error || "讀取平台幣失敗", reason: result.reason || "TOKEN_EXPIRED" }, { status: result.error === "TOKEN_EXPIRED" ? 401 : 400 });
  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
}
