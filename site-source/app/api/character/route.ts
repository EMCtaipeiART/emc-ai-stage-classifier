import { canManageAll } from "@/lib/coins-client";
import { ensureCharacterTables, jobPublic, latestJob, listAllJobs, ownJob, publishedAsOf, publishTargets, requireWho } from "@/lib/character";

/** 我目前的角色製作單（沒有就是 null）。 */
export async function GET(request: Request) {
  const auth = await requireWho(request);
  if ("error" in auth) return auth.error;
  await ensureCharacterTables();
  const url = new URL(request.url);
  if (canManageAll(auth.who) && url.searchParams.get("all") === "1") return Response.json({ jobs: await listAllJobs(), targets: await publishTargets(auth.who, request) }, { headers: { "Cache-Control": "no-store" } });
  if (url.searchParams.get("mine") === "1") return Response.json({ jobs: await listAllJobs(auth.who.account), targets: [] }, { headers: { "Cache-Control": "no-store" } });
  const openId = url.searchParams.get("id") || "";
  const job = openId ? await ownJob(openId, auth.who) : await latestJob(auth.who.account);
  return Response.json({ job: job ? { ...jobPublic(job), publishedAs: await publishedAsOf(job.id), target: (job as { publish_name?: string }).publish_name || "" } : null, name: auth.who.name, targets: canManageAll(auth.who) ? await publishTargets(auth.who, request) : [] }, { headers: { "Cache-Control": "no-store" } });
}
