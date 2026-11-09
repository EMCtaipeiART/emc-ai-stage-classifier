import { edgeCached } from "@/lib/edge-cache";
import { readAsset } from "@/lib/character";

/** 已發佈角色的圖集：atlas.png（60px 格）、atlas-hd.png（240px 格）。網址帶 ?v=（版本）時內容不會變，可長時間快取。 */
export async function GET(request: Request, context: { params: Promise<{ name: string; file: string }> }) {
  const ttl = new URL(request.url).searchParams.get("v") ? 86400 : 300;
  return edgeCached(request, ttl, async () => {
    const { name: raw, file } = await context.params;
    const name = decodeURIComponent(raw), base = file.replace(/\.png$/, "");
    if (!["atlas", "atlas-hd", "walk", "walk-hd"].includes(base) || /[\\/?#]/.test(name)) return new Response("Not found", { status: 404 });
    const bytes = await readAsset(`charpub/${name}/${base}.png`);
    if (!bytes) return new Response("Not found", { status: 404, headers: { "Access-Control-Allow-Origin": "*" } });
    return new Response(bytes as BodyInit, { headers: { "Content-Type": "image/png", "Cache-Control": `public, max-age=${ttl}`, "Access-Control-Allow-Origin": "*" } });
  });
}
