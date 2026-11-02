import { canManageAll } from "@/lib/coins-client";
import { FIXED_SEATS, publishTargets, requireWho, seatMap, setSeat } from "@/lib/character";

/** 座位圖資料：固定座位的人、目前所有指定座位、我自己的名字、管理者可選的對象名單。 */
export async function GET(request: Request) {
  const auth = await requireWho(request);
  if ("error" in auth) return auth.error;
  return Response.json({ fixed: FIXED_SEATS, seats: await seatMap(), me: auth.who.name, targets: canManageAll(auth.who) ? await publishTargets(auth.who, request) : [] }, { headers: { "Cache-Control": "no-store" } });
}

/** 設定座位。一般同仁只能設定自己；管理者與 Machi 可以替名單裡任何人設定。seat 空字串＝清除（回到自由走動）。 */
export async function POST(request: Request) {
  const auth = await requireWho(request);
  if ("error" in auth) return auth.error;
  const { who } = auth;
  const body = await request.json().catch(() => ({})) as { name?: string; seat?: string };
  const name = canManageAll(who) ? String(body.name || who.name).trim() : who.name;
  if (!name) return Response.json({ error: "找不到你的人物名字。" }, { status: 400 });
  if (canManageAll(who) && !(await publishTargets(who, request)).includes(name)) return Response.json({ error: "這個名字不在帳號設定的名單裡。" }, { status: 400 });
  if (Object.keys(FIXED_SEATS).includes(name) && body.seat) return Response.json({ error: `${name} 在 3D 辦公室有固定座位，不能另外指定。` }, { status: 400 });
  try { await setSeat(name, String(body.seat || "")); } catch (cause) { return Response.json({ error: cause instanceof Error ? cause.message : "設定失敗" }, { status: 400 }); }
  return Response.json({ ok: true, name });
}
