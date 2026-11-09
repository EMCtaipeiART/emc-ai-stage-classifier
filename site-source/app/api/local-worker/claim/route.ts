import { buildGridPrompt } from "@/lib/character-ai";
import { getJob } from "@/lib/character";
import { beat, claimNext, keyOk } from "@/lib/local-worker";

/** 工作者領單：回傳一張待做的工作；grid 另外附上要給 Codex 的提示詞。 */
export async function POST(request: Request) {
  if (!keyOk(request)) return Response.json({ error: "forbidden" }, { status: 403 });
  await beat();
  const task = await claimNext();
  if (!task) return Response.json({ task: null });
  if (task.kind === "grid") {
    const job = await getJob(task.id);
    if (!job) return Response.json({ task: null });
    return Response.json({ task, prompt: buildGridPrompt(job.described) });
  }
  return Response.json({ task });
}
