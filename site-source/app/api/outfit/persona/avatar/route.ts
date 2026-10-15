import { designApi, editorTokenOf } from "@/lib/coins-client";

/** 個人形象完成後的頭像快照：轉給設計系統存成站內頭像（首頁、側邊欄的頭像框會直接用）。 */
export async function POST(request: Request) {
  const editorToken = editorTokenOf(request);
  if (!editorToken) return Response.json({ error: "請從設計需求系統登入後進入這個頁面。" }, { status: 401 });
  const body = await request.json().catch(() => ({})) as { png?: string; lookKey?: string; headId?: string; outfitId?: string };
  const result = await designApi("personaAvatarSnapshot", { editorToken, png: String(body.png || ""), lookKey: String(body.lookKey || "persona"), headId: String(body.headId || ""), outfitId: String(body.outfitId || "") });
  if (!result.ok) return Response.json({ error: result.error || "儲存頭像失敗" }, { status: 400 });
  return Response.json({ ok: true, name: result.name, version: result.version, changed: Boolean(result.changed), seat: Number(result.seat ?? -1) });
}
