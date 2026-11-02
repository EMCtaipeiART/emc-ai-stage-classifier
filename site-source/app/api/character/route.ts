import { canManageAll } from "@/lib/coins-client";
import { ensureCharacterTables, getJob, jobPublic, latestJob, listAllJobs, publishTargets, requireWho } from "@/lib/character";

/** 我目前的角色製作單（沒有就是 null）。 */
export async function GET(request: Request) {
  const auth = await requireWho(request);
  if ("error" in auth) return auth.error;
  await ensureCharacterTables();
  const url = new URL(request.url);
  if (canManageAll(auth.who) && url.searchParams.get("all") === "1") return Response.json({ jobs: await listAllJobs(), targets: await publishTargets(auth.who, request) }, { headers: { "Cache-Control": "no-store" } });
  const openId = canManageAll(auth.who) ? url.searchParams.get("id") : "";
  const job = openId ? await getJob(openId) : await latestJob(auth.who.account);
  return Response.json({ job: job ? jobPublic(job) : null, name: auth.who.name, targets: canManageAll(auth.who) ? await publishTargets(auth.who, request) : [] }, { headers: { "Cache-Control": "no-store" } });
}
