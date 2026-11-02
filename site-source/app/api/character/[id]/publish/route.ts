import { designApi, editorTokenOf } from "@/lib/coins-client";
import { isPng, ownJob, putAsset, requireWho, setPublished, updateJob } from "@/lib/character";
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
  // 圖集發佈給哪個名字：本人的設計系統名字；管理者代做別人的，用製作單上的名字
  const name = job.account === who.account ? who.name : job.name;
  if (!name || /[\\/?#]/.test(name)) return Response.json({ error: "找不到對應的人物名字。" }, { status: 400 });
  await putAsset(`charpub/${name}/atlas.png`, small, "image/png");
  await putAsset(`charpub/${name}/atlas-hd.png`, big, "image/png");
  await setPublished(name, id, job.account);
  await updateJob(id, { status: "published" });
  await upsertPersona(job.account, name, { step: "done", complete: true }).catch(() => undefined);
  let avatarSaved = false;
  if (avatar.startsWith("data:image/png;base64,") && job.account === who.account) {
    const result = await designApi("personaAvatarSnapshot", { editorToken: editorTokenOf(request), png: avatar, lookKey: `char:${id}`, headId: "", outfitId: "" }).catch(() => null);
    avatarSaved = Boolean(result?.ok);
  }
  return Response.json({ ok: true, name, avatarSaved });
}
