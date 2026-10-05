import { listOutfitHistory } from "@/lib/outfit-history";

export async function GET() {
  try {
    return Response.json(await listOutfitHistory(50), { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    return Response.json({ error: cause instanceof Error ? cause.message : "讀取紀錄失敗。" }, { status: 500 });
  }
}
