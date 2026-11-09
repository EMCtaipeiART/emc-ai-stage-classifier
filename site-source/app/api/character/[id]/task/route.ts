import { ownJob, requireWho } from "@/lib/character";
import { currentTask, isOnline, stats } from "@/lib/local-worker";

/** 前端進度軸用：這張製作單的本機算圖狀態（8 角度、走路影格）、電腦在不在線、各步驟預估秒數。 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireWho(request);
  if ("error" in auth) return auth.error;
  const { id } = await context.params;
  const job = await ownJob(id, auth.who);
  if (!job) return Response.json({ error: "找不到這張製作單。" }, { status: 404 });
  const [grid, walk, online, est] = await Promise.all([currentTask("grid", id), currentTask("walk", id), isOnline(), stats()]);
  return Response.json({ grid, walk, online, estimate: est, now: Date.now() }, { headers: { "Cache-Control": "no-store" } });
}
