import { buildViews3Prompt, describePerson, editImage, sniffImageMime, turntableReference } from "@/lib/character-ai";
import { ensureCharacterTables, FREE_START_RUNS, heartbeatJson, jobKey, logGeneration, ownJob, putAsset, requireWho, updateJob } from "@/lib/character";
import { canManageAll, designApi, editorTokenOf } from "@/lib/coins-client";
import { env } from "cloudflare:workers";

export const runtime = "edge";

/** 上傳照片＋提示詞 → 生成三視圖（正面、右側、背面）。可帶 jobId 重新生成同一張製作單（受次數限制）。 */
export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return Response.json({ error: "伺服器沒有設定 OPENAI_API_KEY。" }, { status: 500 });
  const auth = await requireWho(request);
  if ("error" in auth) return auth.error;
  const { who } = auth;
  let form: FormData;
  try { form = await request.formData(); } catch { return Response.json({ error: "請求格式不正確。" }, { status: 400 }); }
  const notes = String(form.get("prompt") || "").trim().slice(0, 300);
  const photo = form.get("image");
  const jobId = String(form.get("jobId") || "");
  if (!(photo instanceof File) || photo.size > 10 * 1024 * 1024) return Response.json({ error: "請上傳 10MB 內的個人照（JPG、PNG、WebP）。" }, { status: 400 });
  const bytes = new Uint8Array(await photo.arrayBuffer());
  const mime = sniffImageMime(bytes);
  if (!mime) return Response.json({ error: "照片格式無法讀取，請改用 JPG 或 PNG。" }, { status: 400 });

  await ensureCharacterTables();
  const admin = canManageAll(who);
  let id = jobId, charged = false;
  if (jobId) {
    const job = await ownJob(jobId, who);
    if (!job) return Response.json({ error: "找不到這張製作單。" }, { status: 404 });
    if (!admin && job.start_runs >= FREE_START_RUNS) return Response.json({ error: `三視圖最多重新生成 ${FREE_START_RUNS} 次，已用完。`, reason: "LIMIT" }, { status: 429 });
  } else {
    id = crypto.randomUUID();
    // 每人第一次建立人物免費，之後每新增一個人物扣 100 平台幣（和服裝生成同一套帳本；沒有平台幣帳戶的管理者不扣）
    await env.DB!.prepare("CREATE TABLE IF NOT EXISTS character_first_free (account TEXT PRIMARY KEY, job_id TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)").run();
    const used = await env.DB!.prepare("SELECT (SELECT COUNT(*) FROM character_first_free WHERE account = ?) + (SELECT COUNT(*) FROM character_jobs WHERE account = ?) AS n").bind(who.account, who.account).first<{ n: number }>();
    if (Number(used?.n) > 0) {
      const reserve = await designApi("coinReserve", { editorToken: editorTokenOf(request), ref: id, regenerate: false, character: true }, true);
      if (!reserve.ok) return Response.json({ error: reserve.error === "TOKEN_EXPIRED" ? "登入已過期，請回設計需求系統重新登入後再進入。" : (reserve.error || "平台幣扣款失敗"), reason: reserve.error === "TOKEN_EXPIRED" ? "TOKEN_EXPIRED" : "COIN" }, { status: reserve.error === "TOKEN_EXPIRED" ? 401 : 402 });
      charged = !reserve.exempt;
    } else {
      await env.DB!.prepare("INSERT OR IGNORE INTO character_first_free (account, job_id) VALUES (?, ?)").bind(who.account, id).run();
    }
    await env.DB!.prepare("INSERT INTO character_jobs (id, account, name, prompt, start_runs) VALUES (?, ?, ?, ?, 0)").bind(id, who.account, who.name, notes).run();
  }

  return heartbeatJson(async () => {
    const started = Date.now(), secs = () => Math.round((Date.now() - started) / 100) / 10;
    let described = "";
    let result: Awaited<ReturnType<typeof editImage>>;
    try {
      described = await describePerson(apiKey, bytes, mime);
      const reference = await turntableReference();
      result = await editImage(apiKey, { prompt: buildViews3Prompt(described, notes), images: [{ bytes: reference, type: "image/png", name: "turntable-reference.png" }] });
    } catch (cause) {
      await logGeneration({ userId: who.name || who.account, label: "三視圖", description: notes, described, seconds: secs(), jobId: id, error: cause instanceof Error ? cause.message : "生成失敗" });
      if (charged) { await designApi("coinRefund", { ref: id, reason: "人物生成未成功" }, true).catch(() => undefined); await env.DB!.prepare("DELETE FROM character_jobs WHERE id = ?").bind(id).run().catch(() => undefined); }   // 沒成功就把這次的 100 點退回
      throw cause;
    }
    const { png, costUsd } = result;
    await logGeneration({ userId: who.name || who.account, label: "三視圖", description: notes, described, seconds: secs(), jobId: id, png, costUsd, usage: result.usage, model: result.model, transparent: result.transparent });
    await putAsset(jobKey(id, "views3"), png, "image/png");
    const row = await env.DB!.prepare("SELECT start_runs FROM character_jobs WHERE id = ?").bind(id).first<{ start_runs: number }>();
    await updateJob(id, { status: "views3", described, addCost: costUsd, startRuns: (row?.start_runs ?? 0) + 1, anglesJson: "{}", alignJson: "" });
    return { jobId: id, charged, costUsd, startRuns: (row?.start_runs ?? 0) + 1, limit: admin ? 0 : FREE_START_RUNS };
  });
}
