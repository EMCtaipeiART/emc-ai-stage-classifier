import { buildGridPrompt, editImage, turntableReference } from "@/lib/character-ai";
import { deleteAsset } from "@/lib/storage";
import { AI_ANGLES, angleName, GRID_KEY, bumpAngle, heartbeatJson, jobKey, logGeneration, ownJob, putAsset, readAsset, requireWho } from "@/lib/character";
import { canManageAll } from "@/lib/coins-client";
import { env } from "cloudflare:workers";

export const runtime = "edge";
const MAX_TRIES = 3;   // 整組 8 角度合圖最多重算幾次（管理者不限）

/** 一次生成其餘 8 個角度（4×2 合圖）。前端切成 8 張；不滿意的角度再用 angle 單獨補算。 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return Response.json({ error: "伺服器沒有設定 OPENAI_API_KEY。" }, { status: 500 });
  const auth = await requireWho(request);
  if ("error" in auth) return auth.error;
  const { id } = await context.params;
  const job = await ownJob(id, auth.who);
  if (!job) return Response.json({ error: "找不到這張製作單。" }, { status: 404 });
  const body = await request.json().catch(() => ({})) as { quality?: string };
  const quality = canManageAll(auth.who) && body.quality === "high" ? "high" : "medium";
  const counts = (() => { try { return JSON.parse(job.angles_json || "{}") as Record<string, number>; } catch { return {}; } })();
  if (!canManageAll(auth.who) && (counts[GRID_KEY] || 0) >= MAX_TRIES) return Response.json({ error: `整組角度最多重算 ${MAX_TRIES} 次，已用完；可以改成單獨補算某個角度。`, reason: "LIMIT" }, { status: 429 });
  const sheet = await readAsset(jobKey(id, "sheet"));
  if (!sheet) return Response.json({ error: "還沒完成對位確認。" }, { status: 409 });

  return heartbeatJson(async () => {
    const reference = await turntableReference();
    const started = Date.now(), secs = () => Math.round((Date.now() - started) / 100) / 10, userId = auth.who.name || auth.who.account;
    let result: Awaited<ReturnType<typeof editImage>>;
    try {
      result = await editImage(apiKey, { prompt: buildGridPrompt(job.described), images: [{ bytes: sheet, type: "image/png", name: "sheet.png" }, { bytes: reference, type: "image/png", name: "turntable-reference.png" }], size: "grid", quality });
    } catch (cause) {
      await logGeneration({ userId, label: "8角度合圖", description: job.prompt, seconds: secs(), jobId: id, error: cause instanceof Error ? cause.message : "生成失敗" });
      throw cause;
    }
    await putAsset(jobKey(id, "grid"), result.png, "image/png");
    await bumpAngle(id, GRID_KEY, result.costUsd);
    await env.DB!.prepare("UPDATE character_jobs SET angles_json = json_remove(COALESCE(NULLIF(angles_json, ''), '{}'), '$.\"-1\"') WHERE id = ?").bind(id).run();   // 代放合圖的旗標作廢
    for (const deg of AI_ANGLES) await deleteAsset(jobKey(id, angleName(deg))).catch(() => undefined);   // 整組重算後，舊的單獨補算圖作廢
    await logGeneration({ userId, label: `8角度合圖・${quality}`, description: job.prompt, seconds: secs(), jobId: id, png: result.png, costUsd: result.costUsd, usage: result.usage, model: result.model, transparent: result.transparent });
    return { ok: true, tries: (counts[GRID_KEY] || 0) + 1, limit: canManageAll(auth.who) ? 0 : MAX_TRIES, costUsd: result.costUsd };
  });
}
