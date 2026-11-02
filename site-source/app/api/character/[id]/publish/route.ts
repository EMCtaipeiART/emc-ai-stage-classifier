import { canManageAll, designApi, editorTokenOf } from "@/lib/coins-client";
import { isPng, ownJob, publishTargets, putAsset, requireWho, setPublished, updateJob } from "@/lib/character";
import { upsertPersona } from "@/lib/persona";

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
  await putAsset(`charpub/${name}/atlas.png`, small, "image/png");
  await putAsset(`charpub/${name}/atlas-hd.png`, big, "image/png");
  await setPublished(name, id, job.account);
  await updateJob(id, { status: "published" });
  if (job.account === who.account && name === who.name) await upsertPersona(job.account, name, { step: "done", complete: true }).catch(() => undefined);
  let avatarSaved = false;
  if (avatar.startsWith("data:image/png;base64,") && job.account === who.account && name === who.name) {
    const result = await designApi("personaAvatarSnapshot", { editorToken: editorTokenOf(request), png: avatar, lookKey: `char:${id}`, headId: "", outfitId: "" }).catch(() => null);
    avatarSaved = Boolean(result?.ok);
  }
  return Response.json({ ok: true, name, avatarSaved });
}
