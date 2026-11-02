import { ensureCharacterTables, jobPublic, latestJob, requireWho } from "@/lib/character";

/** 我目前的角色製作單（沒有就是 null）。 */
export async function GET(request: Request) {
  const auth = await requireWho(request);
  if ("error" in auth) return auth.error;
  await ensureCharacterTables();
  const job = await latestJob(auth.who.account);
  return Response.json({ job: job ? jobPublic(job) : null, name: auth.who.name }, { headers: { "Cache-Control": "no-store" } });
}
