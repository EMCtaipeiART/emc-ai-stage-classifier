import { buildAnglePrompt, editImage, turntableReference } from "@/lib/character-ai";
import { AI_ANGLES, angleName, bumpAngle, heartbeatJson, jobKey, logGeneration, ownJob, putAsset, readAsset, requireWho, updateJob } from "@/lib/character";
import { canManageAll } from "@/lib/coins-client";

export const runtime = "edge";
const MAX_TRIES = 3;   // 每個角度最多重算幾次（管理者不限）

/** 生成單一角度（30、60、120、150、210、240、300、330）。前端一個一個呼叫，壞掉的角度可以單獨重算。 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return Response.json({ error: "伺服器沒有設定 OPENAI_API_KEY。" }, { status: 500 });
  const auth = await requireWho(request);
  if ("error" in auth) return auth.error;
  const { id } = await context.params;
  const job = await ownJob(id, auth.who);
  if (!job) return Response.json({ error: "找不到這張製作單。" }, { status: 404 });
  const body = await request.json().catch(() => ({})) as { deg?: number };
  const deg = Number(body.deg);
  if (!(AI_ANGLES as readonly number[]).includes(deg)) return Response.json({ error: "不支援的角度。" }, { status: 400 });
  const counts = (() => { try { return JSON.parse(job.angles_json || "{}") as Record<string, number>; } catch { return {}; } })();
  if (!canManageAll(auth.who) && (counts[deg] || 0) >= MAX_TRIES) return Response.json({ error: `這個角度最多重算 ${MAX_TRIES} 次，已用完。`, reason: "LIMIT" }, { status: 429 });
  const sheet = await readAsset(jobKey(id, "sheet"));
  if (!sheet) return Response.json({ error: "還沒完成對位確認。" }, { status: 409 });

  return heartbeatJson(async () => {
    const reference = await turntableReference();
    const started = Date.now(), secs = () => Math.round((Date.now() - started) / 100) / 10, userId = auth.who.name || auth.who.account;
    let result: Awaited<ReturnType<typeof editImage>>;
    try {
      result = await editImage(apiKey, { prompt: buildAnglePrompt(deg, job.described), images: [{ bytes: sheet, type: "image/png", name: "sheet.png" }, { bytes: reference, type: "image/png", name: "turntable-reference.png" }], size: "square" });
    } catch (cause) {
      await logGeneration({ userId, label: `${deg}°`, description: job.prompt, seconds: secs(), jobId: id, error: cause instanceof Error ? cause.message : "生成失敗" });
      throw cause;
    }
    const { png, costUsd } = result;
    await logGeneration({ userId, label: `${deg}°`, description: job.prompt, seconds: secs(), jobId: id, png, costUsd, usage: result.usage, model: result.model, transparent: result.transparent });
    await putAsset(jobKey(id, angleName(deg)), png, "image/png");
    await bumpAngle(id, deg, costUsd);
    return { ok: true, deg, tries: (counts[deg] || 0) + 1, limit: canManageAll(auth.who) ? 0 : MAX_TRIES };
  });
}
