import { listPublishedItems } from "@/lib/outfit-items";

/** Pixel Office 遊戲讀取：各設計師已完成並發佈的服裝（公開、不需登入，不含帳號；proxy.ts 對 /api/public/ 放行）。 */
export async function GET() {
  try {
    return Response.json({ items: await listPublishedItems() }, { headers: { "Cache-Control": "public, max-age=30", "Access-Control-Allow-Origin": "*" } });
  } catch (cause) {
    return Response.json({ items: [], error: cause instanceof Error ? cause.message : "讀取失敗" }, { status: 500, headers: { "Access-Control-Allow-Origin": "*" } });
  }
}
