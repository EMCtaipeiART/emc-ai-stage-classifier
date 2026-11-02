import { canManageAll, whoami } from "@/lib/coins-client";
import { deleteOutfitRecord, updateOutfitRecordDescription } from "@/lib/outfit-history";

/** 生成紀錄管理：只有管理者與 Machi 可以編輯說明、刪除紀錄（含圖片）。 */
async function admin(request: Request) {
  const who = await whoami(request);
  return who && canManageAll(who) ? who : null;
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!await admin(request)) return Response.json({ error: "只有管理者可以編輯生成紀錄。" }, { status: 403 });
  const { id } = await context.params;
  const body = await request.json().catch(() => ({})) as { description?: string };
  if (!/^[0-9a-f-]{36}$/.test(id) || typeof body.description !== "string") return Response.json({ error: "請求不正確。" }, { status: 400 });
  return await updateOutfitRecordDescription(id, body.description.trim()) ? Response.json({ ok: true }) : Response.json({ error: "找不到這筆紀錄。" }, { status: 404 });
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!await admin(request)) return Response.json({ error: "只有管理者可以刪除生成紀錄。" }, { status: 403 });
  const { id } = await context.params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return Response.json({ error: "請求不正確。" }, { status: 400 });
  return await deleteOutfitRecord(id) ? Response.json({ ok: true }) : Response.json({ error: "找不到這筆紀錄。" }, { status: 404 });
}
