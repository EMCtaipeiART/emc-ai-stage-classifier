import { canManageAll, designApi, editorTokenOf } from "@/lib/coins-client";
import { env } from "cloudflare:workers";
import { saveAvatarSnapshot, isPng, jobKey, ownJob, publishTargets, putAsset, requireWho, setPublished, updateJob } from "@/lib/character";
import { upsertPersona } from "@/lib/persona";
import { currentTask, enqueue } from "@/lib/local-worker";

/** 發佈：前端烘焙好的 12 視角圖集（一般 60px 格、高清 240px 格）存到雲端，3D 辦公室下次載入就會用；同時更新頭像快照並結束新人精靈。 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireWho(request);
  if ("error" in auth) return auth.error;
  const { who } = auth;
  const { id } = await context.params;
  const job = await ownJob(id, who);
  if (!job) return Response.json({ error: "找不到這張製作單。" }, { status: 404 });
  const form = await request.formData().catch(() => null);
  const atlas = form?.get("atlas"), atlasHd = form?.get("atlasHd"), avatar = String(form?.get("avatar") || "");
  if (!(atlas instanceof File) || !(atlasHd instanceof File) || atlas.size > 4 * 1024 * 1024 || atlasHd.size > 12 * 1024 * 1024) return Response.json({ error: "缺少圖集。" }, { status: 400 });
  const small = new Uint8Array(await atlas.arrayBuffer()), big = new Uint8Array(await atlasHd.arrayBuffer());
  if (!isPng(small) || !isPng(big)) return Response.json({ error: "圖集必須是 PNG。" }, { status: 400 });
  // 圖集發佈給哪個名字：一般同仁只能發佈給自己；管理者與 Machi 可以指定 3D 辦公室裡的任何一位（自己沒有設計師名字也能測試）
  const asked = String(form?.get("name") || "").trim();
  const name = canManageAll(who) ? asked : who.name;
  if (canManageAll(who) && asked && !(await publishTargets(who, request)).includes(asked)) return Response.json({ error: "這個名字不在帳號設定的名單裡。" }, { status: 400 });
  if (!name || name.length > 40 || /[\\/?#]/.test(name)) return Response.json({ error: canManageAll(who) ? "請先選擇這套角色要發佈給誰。" : "找不到你的人物名字，請聯絡管理者。" }, { status: 400 });
  await putAsset(jobKey(id, "atlas"), small, "image/png");   // 每套各自留一份，之後可以隨時切換預設
  await putAsset(jobKey(id, "atlas-hd"), big, "image/png");
  if (avatar.startsWith("data:image/png;base64,")) { try { const raw = atob(avatar.slice(22)); const buf = new Uint8Array(raw.length); for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i); if (isPng(buf)) await putAsset(jobKey(id, "avatar"), buf, "image/png"); } catch { /* 頭像存不起來不影響上線 */ } }
  await putAsset(`charpub/${name}/atlas.png`, small, "image/png");
  await putAsset(`charpub/${name}/atlas-hd.png`, big, "image/png");
  await setPublished(name, id, job.account);
  await notifyWalkFrames();   // 通知 GitHub 開始替這位補走路／跑步影格（沒設定 token 就略過，30 分鐘排程仍會撿到）
  await updateJob(id, { status: "published" });
  await env.DB!.prepare("UPDATE character_jobs SET publish_name = ? WHERE id = ?").bind(name, id).run();
  if (job.account === who.account && name === who.name) await upsertPersona(job.account, name, { step: "done", complete: true }).catch(() => undefined);
  let avatarSaved = false;
  if (avatar.startsWith("data:image/png;base64,")) {
    avatarSaved = await saveAvatarSnapshot(request, who, avatar, `char:${id}`, name);
  }
  // 走路／跑步影格：交給家裡電腦（Codex）做，不扣 API；電腦沒開就排隊等開機。做好前網站先用簡單的擺動動畫
  try {
    const ver = (await env.DB!.prepare("SELECT version FROM character_published WHERE name = ?").bind(name).first<{ version: number }>())?.version || 1;
    const open = await currentTask("walk", id);
    if (!open || open.status !== "running") await enqueue("walk", id, { name, version: ver });
  } catch { /* 排程失敗不影響上線 */ }
  // 管理者代同事發佈：直接幫他完成入座（企劃部／專案部同仁不用再回去走完「建立你的角色」）；後端還沒更新或對象不是這類同仁時略過
  let seated = false;
  if (canManageAll(who) && name !== who.name) {
    const r = await designApi("characterSeatFor", { editorToken: editorTokenOf(request), name }).catch(() => null);
    seated = Boolean(r?.ok && typeof r.seat === "number" && r.seat >= 0);
  }
  return Response.json({ ok: true, name, avatarSaved, seated });
}

/** 發佈完成後通知 GitHub Actions（repository_dispatch）。token 放在 Worker 的 Secret GITHUB_DISPATCH_TOKEN（只給該專案 Contents 讀寫）；失敗或沒設定都不影響發佈。 */
async function notifyWalkFrames() {
  const token = (env as unknown as Record<string, string | undefined>).GITHUB_DISPATCH_TOKEN;
  if (!token) return;
  try {
    await fetch("https://api.github.com/repos/EMCtaipeiART/EMCtaipeiART.github.io/dispatches", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "emc-character-workshop", "Content-Type": "application/json" },
      body: JSON.stringify({ event_type: "character-published" }),
      signal: AbortSignal.timeout(4000),
    });
  } catch { /* 通知失敗不影響發佈 */ }
}
