import { canManageAll } from "@/lib/coins-client";
import { makeDefault, ownJob, publishTargets, requireWho } from "@/lib/character";

/** 把這套設為預設（3D 辦公室上的樣子）：本人只能設自己的；管理者可以設任何一套。 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireWho(request);
  if ("error" in auth) return auth.error;
  const { who } = auth;
  const { id } = await context.params;
  const job = await ownJob(id, who);
  if (!job) return Response.json({ error: "找不到這張製作單。" }, { status: 404 });
  const body = await request.json().catch(() => ({})) as { name?: string };
  const stored = (job as { publish_name?: string }).publish_name || "";
  const name = canManageAll(who) ? String(body.name || stored || "").trim() : who.name;
  if (!name || name.length > 40 || /[\/?#]/.test(name)) return Response.json({ error: "找不到要發佈給誰。" }, { status: 400 });
  if (canManageAll(who) && !(await publishTargets(who, request)).includes(name)) return Response.json({ error: "這個名字不在帳號設定的名單裡。" }, { status: 400 });
  try { return Response.json({ ok: true, name, ...(await makeDefault(job, who, request, name)) }); }
  catch (cause) { return Response.json({ error: cause instanceof Error ? cause.message : "設定失敗" }, { status: 400 }); }
}
