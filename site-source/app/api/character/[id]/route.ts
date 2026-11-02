import { canManageAll } from "@/lib/coins-client";
import { deleteJob, getJob, moveJobPublish, publishedAsOf, publishTargets, requireWho, unpublishJob } from "@/lib/character";

/** 管理：只有管理者與 Machi。PATCH { action: "unpublish" } 取消上線；PATCH { action: "move", name } 改發佈給別人；DELETE 刪除整張製作單（含圖片，已上線的一併取消）。 */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireWho(request);
  if ("error" in auth) return auth.error;
  if (!canManageAll(auth.who)) return Response.json({ error: "只有管理者可以管理角色製作單。" }, { status: 403 });
  const { id } = await context.params;
  const job = await getJob(id);
  if (!job) return Response.json({ error: "找不到這張製作單。" }, { status: 404 });
  const body = await request.json().catch(() => ({})) as { action?: string; name?: string };
  try {
    if (body.action === "unpublish") { await unpublishJob(id); }
    else if (body.action === "move") {
      const name = String(body.name || "").trim();
      if (!(await publishTargets(auth.who, request)).includes(name)) return Response.json({ error: "這個名字不在帳號設定的名單裡。" }, { status: 400 });
      await moveJobPublish(id, job.account, name);
    } else return Response.json({ error: "不支援的操作。" }, { status: 400 });
  } catch (cause) { return Response.json({ error: cause instanceof Error ? cause.message : "操作失敗" }, { status: 400 }); }
  return Response.json({ ok: true });
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireWho(request);
  if ("error" in auth) return auth.error;
  const { id } = await context.params;
  const job = await getJob(id);
  if (!job) return Response.json({ error: "找不到這張製作單。" }, { status: 404 });
  if (!canManageAll(auth.who)) {   // 本人可以刪自己「沒在用」的那幾套；正在當預設的要先換成別套
    if (job.account !== auth.who.account) return Response.json({ error: "只能刪除自己的製作單。" }, { status: 403 });
    if (await publishedAsOf(id)) return Response.json({ error: "這套正在當預設，請先把別套設為預設再刪除。" }, { status: 400 });
  }
  await deleteJob(id);
  return Response.json({ ok: true });
}
