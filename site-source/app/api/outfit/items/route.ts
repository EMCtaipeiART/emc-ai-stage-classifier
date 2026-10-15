import { canManageAll, whoami } from "@/lib/coins-client";
import { listAllItems, listItems } from "@/lib/outfit-items";

/** 我的服裝（製作中與已完成）。 */
export async function GET(request: Request) {
  const who = await whoami(request);
  if (!who) return Response.json({ error: "請從設計需求系統登入後進入這個頁面。" }, { status: 401 });
  try {
    const all = new URL(request.url).searchParams.get("all") === "1" && canManageAll(who);   // 管理者與 Machi：看全部人員的
    return Response.json({ items: all ? await listAllItems() : await listItems(who.account) }, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    return Response.json({ error: cause instanceof Error ? cause.message : "讀取失敗" }, { status: 500 });
  }
}
