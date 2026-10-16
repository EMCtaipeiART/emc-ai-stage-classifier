import { getPersonaByName } from "@/lib/persona";
import { canManageAll, designApi, whoami } from "@/lib/coins-client";

/** 本人在元宇宙目前選用的頭像（帽子、眼鏡對位用）。瀏覽器不能直接問設計系統的 API（跨網站），所以由這裡用服務綁定代問。 */
export async function GET(request: Request) {
  const who = await whoami(request);
  if (!who) return Response.json({ error: "請從設計需求系統登入後進入這個頁面。" }, { status: 401 });
  const state = await designApi("pixelOfficeState", { since: 0 }) as unknown as { people?: Array<{ name: string; look?: { head?: string } }> };
  const asked = new URL(request.url).searchParams.get("name") || "";   // 管理者與 Machi 編輯別人的服裝時，要拼的是那個人選用的頭像
  const target = asked && canManageAll(who) ? asked : who.name;
  let head = state.people?.find((person) => person.name === target)?.look?.head || "";
  // 同仁還沒在元宇宙選過造型時，look 是空的；別人（管理者）編輯他的服裝時，改用他建立角色時做好的頭像，不能退回編輯者自己的頭
  if (!/^h:[0-9a-f-]{36}$/.test(head) && target !== who.name) {
    const persona = await getPersonaByName(target).catch(() => null);
    if (persona?.head_item_id) head = `h:${persona.head_item_id}`;
  }
  return Response.json({ head: /^h:[0-9a-f-]{36}$/.test(head) ? head : "" }, { headers: { "Cache-Control": "no-store" } });
}
