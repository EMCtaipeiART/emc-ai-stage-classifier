import { outfitHistoryImage } from "@/lib/outfit-history";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response("Not found", { status: 404 });
  const variant = Number(new URL(request.url).searchParams.get("v") || 0);
  const body = await outfitHistoryImage(id, Number.isInteger(variant) ? variant : 0).catch(() => null);
  if (!body) return new Response("Not found", { status: 404 });
  return new Response(body, { headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=86400" } });
}
