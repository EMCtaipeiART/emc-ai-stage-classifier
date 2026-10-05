import { whoami } from "@/lib/coins-client";
import { getItem, itemCover } from "@/lib/outfit-items";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const who = await whoami(request);
  if (!who) return new Response("Unauthorized", { status: 401 });
  const { id } = await context.params;
  const row = await getItem(id);
  if (!row || row.owner_account !== who.account || row.status === "deleted") return new Response("Not found", { status: 404 });
  const body = await itemCover(row);
  return body ? new Response(body, { headers: { "Content-Type": "image/png", "Cache-Control": "private, no-store" } }) : new Response("Not found", { status: 404 });
}
