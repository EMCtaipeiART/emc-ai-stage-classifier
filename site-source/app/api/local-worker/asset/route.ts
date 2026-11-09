import { jobKey, readAsset, PNG_HEADERS } from "@/lib/character";
import { turntableReference } from "@/lib/character-ai";
import { keyOk } from "@/lib/local-worker";

/** 工作者下載素材：job + kind=sheet（對位後三視圖）｜reference（轉台畫風參考）｜atlas-hd（已發佈站姿圖集，要帶 name） */
export async function GET(request: Request) {
  if (!keyOk(request)) return Response.json({ error: "forbidden" }, { status: 403 });
  const url = new URL(request.url), kind = url.searchParams.get("kind") || "", job = url.searchParams.get("job") || "", name = url.searchParams.get("name") || "";
  let bytes: Uint8Array | null = null;
  if (kind === "reference") bytes = await turntableReference();
  else if (kind === "sheet" && /^[\w-]{8,64}$/.test(job)) bytes = await readAsset(jobKey(job, "sheet"));
  else if (kind === "atlas-hd" && name && !/[\\/?#]/.test(name)) bytes = await readAsset(`charpub/${name}/atlas-hd.png`);
  if (!bytes) return new Response("Not found", { status: 404 });
  return new Response(bytes as BodyInit, { headers: PNG_HEADERS });
}
