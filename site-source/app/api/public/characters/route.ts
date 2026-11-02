import { edgeCached } from "@/lib/edge-cache";
import { publishedList } from "@/lib/character";

/** 3D 辦公室讀取：已發佈的角色圖集版本（公開，不含帳號）。{ characters: { 名字: 版本 } } */
export async function GET(request: Request) {
  return edgeCached(request, 20, async () => {
    try { return Response.json({ characters: await publishedList() }, { headers: { "Cache-Control": "public, max-age=20", "Access-Control-Allow-Origin": "*" } }); }
    catch (cause) { return Response.json({ characters: {}, error: cause instanceof Error ? cause.message : "讀取失敗" }, { status: 500, headers: { "Access-Control-Allow-Origin": "*" } }); }
  });
}
