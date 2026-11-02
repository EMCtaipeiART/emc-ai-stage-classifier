import { isPng, jobKey, ownJob, putAsset, requireWho, updateJob } from "@/lib/character";

/** 對位確認：前端把量好的三視圖「規格化版本」（三格同高、腳底對齊、置中）和對位參數送來，之後補角度都以它為準。 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireWho(request);
  if ("error" in auth) return auth.error;
  const { id } = await context.params;
  const job = await ownJob(id, auth.who);
  if (!job) return Response.json({ error: "找不到這張製作單。" }, { status: 404 });
  const form = await request.formData().catch(() => null);
  const sheet = form?.get("sheet");
  if (!(sheet instanceof File) || sheet.size > 8 * 1024 * 1024) return Response.json({ error: "缺少對位後的三視圖。" }, { status: 400 });
  const bytes = new Uint8Array(await sheet.arrayBuffer());
  if (!isPng(bytes)) return Response.json({ error: "三視圖必須是 PNG。" }, { status: 400 });
  let align = "";
  try { align = JSON.stringify(JSON.parse(String(form?.get("align") || "null"))); } catch { /* 沒帶就不存 */ }
  await putAsset(jobKey(id, "sheet"), bytes, "image/png");
  await updateJob(id, { status: "angles", alignJson: align || undefined });
  return Response.json({ ok: true });
}
