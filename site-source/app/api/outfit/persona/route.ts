import { whoami } from "@/lib/coins-client";
import { getPersona, personaPublic, upsertPersona } from "@/lib/persona";
import { getItem } from "@/lib/outfit-items";

/** 我的個人形象進度（企劃／專案人員第一次建立角色用）。 */
export async function GET(request: Request) {
  const who = await whoami(request);
  if (!who) return Response.json({ error: "請從設計需求系統登入後進入這個頁面。" }, { status: 401 });
  try {
    return Response.json({ persona: personaPublic(await getPersona(who.account)), department: who.department }, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    return Response.json({ error: cause instanceof Error ? cause.message : "讀取失敗" }, { status: 500 });
  }
}

/** 更新進度：選好的頭像／身體製作單、目前步驟、完成。製作單必須是自己的。 */
export async function POST(request: Request) {
  const who = await whoami(request);
  if (!who) return Response.json({ error: "請從設計需求系統登入後進入這個頁面。" }, { status: 401 });
  const body = await request.json().catch(() => ({})) as { headItemId?: string; outfitItemId?: string; step?: string; complete?: boolean};
  for (const id of [body.headItemId, body.outfitItemId]) {
    if (!id) continue;
    const item = await getItem(id);
    if (!item || item.owner_account !== who.account) return Response.json({ error: "找不到這件製作單。" }, { status: 404 });
  }
  const step = ["upload", "pick", "fit", "done"].includes(String(body.step)) ? String(body.step) : undefined;
  await upsertPersona(who.account, who.name || who.account, { headItemId: body.headItemId, outfitItemId: body.outfitItemId, step, complete: Boolean(body.complete) });
  return Response.json({ ok: true, persona: personaPublic(await getPersona(who.account)) });
}
