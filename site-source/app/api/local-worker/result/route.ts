import { jobKey, isPng, putAsset } from "@/lib/character";
import { getTask, keyOk, putTask, recordDuration, setWalkVersion, type TaskKind } from "@/lib/local-worker";

/** 工作者交成品：multipart，kind/id 加檔案。grid：grid（4×2 合圖）；walk：hd（2880×480）與 lo（720×120）。 */
export async function POST(request: Request) {
  if (!keyOk(request)) return Response.json({ error: "forbidden" }, { status: 403 });
  const form = await request.formData().catch(() => null);
  const kind = String(form?.get("kind") || "") as TaskKind, id = String(form?.get("id") || "");
  const t = form && (kind === "grid" || kind === "walk") ? await getTask(kind, id) : null;
  if (!form || !t) return Response.json({ error: "no task" }, { status: 404 });
  const bytes = async (k: string) => { const f = form.get(k); if (!(f instanceof File) || f.size > 12 * 1024 * 1024) return null; const b = new Uint8Array(await f.arrayBuffer()); return isPng(b) ? b : null; };
  if (kind === "grid") {
    const grid = await bytes("grid"); if (!grid) return Response.json({ error: "缺少合圖" }, { status: 400 });
    await putAsset(jobKey(id, "grid"), grid, "image/png");
  } else {
    const hd = await bytes("hd"), lo = await bytes("lo");
    if (!hd || !lo || !t.name || /[\\/?#]/.test(t.name)) return Response.json({ error: "缺少走路圖" }, { status: 400 });
    await putAsset(`charpub/${t.name}/walk-hd.png`, hd, "image/png");
    await putAsset(`charpub/${t.name}/walk.png`, lo, "image/png");
    await setWalkVersion(t.name, t.version || 1);
  }
  const now = Date.now();
  await recordDuration(kind, ((now - (t.claimedAt || t.createdAt)) / 1000));
  t.status = "done"; t.pct = 100; t.step = "完成"; t.finishedAt = now; t.updatedAt = now; await putTask(t);
  return Response.json({ ok: true });
}
