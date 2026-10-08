import { designApi, whoami } from "@/lib/coins-client";

/** 本人在元宇宙目前選用的頭像（帽子、眼鏡對位用）。瀏覽器不能直接問設計系統的 API（跨網站），所以由這裡用服務綁定代問。 */
export async function GET(request: Request) {
  const who = await whoami(request);
  if (!who) return Response.json({ error: "請從設計需求系統登入後進入這個頁面。" }, { status: 401 });
  const state = await designApi("pixelOfficeState", { since: 0 }) as unknown as { people?: Array<{ name: string; look?: { head?: string } }> };
  const head = state.people?.find((person) => person.name === who.name)?.look?.head || "";
  return Response.json({ head: /^h:[0-9a-f-]{36}$/.test(head) ? head : "" }, { headers: { "Cache-Control": "no-store" } });
}
