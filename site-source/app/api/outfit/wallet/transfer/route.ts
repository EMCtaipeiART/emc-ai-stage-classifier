import { designApi, editorTokenOf } from "@/lib/coins-client";

/** 轉讓平台幣給另一位設計師（立即入帳）。 */
export async function POST(request: Request) {
  const token = editorTokenOf(request);
  if (!token) return Response.json({ error: "請從設計需求系統登入後進入這個頁面。" }, { status: 401 });
  const body = await request.json().catch(() => ({})) as { to?: string; amount?: number | string; memo?: string };
  const result = await designApi("coinTransfer", { editorToken: token, to: String(body.to || ""), amount: Number(body.amount), memo: String(body.memo || "") });
  if (!result.ok) return Response.json({ error: result.error || "轉讓失敗" }, { status: 400 });
  return Response.json(result);
}
