import { jobKey, ownJob, readAsset, requireWho, PNG_HEADERS } from "@/lib/character";

/** 製作單的圖（本人或管理者）：views3、sheet、a030…a330。 */
export async function GET(request: Request, context: { params: Promise<{ id: string; file: string }> }) {
  const auth = await requireWho(request);
  if ("error" in auth) return auth.error;
  const { id, file } = await context.params;
  const name = file.replace(/\.png$/, "");
  if (!/^(views3|sheet|a\d{3})$/.test(name) || !await ownJob(id, auth.who)) return new Response("Not found", { status: 404 });
  const bytes = await readAsset(jobKey(id, name));
  return bytes ? new Response(bytes as BodyInit, { headers: PNG_HEADERS }) : new Response("Not found", { status: 404 });
}
