import { publishedViewImage } from "@/lib/outfit-items";

/** 一件服裝的單一角度身體圖（0 正面、1 側面朝右、2 背面）。編號是不可猜的 UUID。 */
export async function GET(_request: Request, context: { params: Promise<{ id: string; view: string }> }) {
  const { id, view } = await context.params;
  const index = Number(view.replace(/\.png$/, ""));
  if (!/^[0-9a-f-]{36}$/.test(id) || !Number.isInteger(index)) return new Response("Not found", { status: 404 });
  const body = await publishedViewImage(id, index).catch(() => null);
  if (!body) return new Response("Not found", { status: 404, headers: { "Access-Control-Allow-Origin": "*" } });
  return new Response(body, { headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=300", "Access-Control-Allow-Origin": "*" } });
}
