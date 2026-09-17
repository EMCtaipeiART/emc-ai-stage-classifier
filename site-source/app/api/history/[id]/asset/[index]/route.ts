import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { analysisHistory } from "@/db/schema";
import { assetStorageReady, getAsset } from "@/lib/storage";

type StoredMedia = { key: string; name: string; type: string; kind: "image" | "slides" };

export async function GET(request: Request, context: { params: Promise<{ id: string; index: string }> }) {
  try {
    if (!assetStorageReady()) return Response.json({ error: "檔案儲存空間尚未啟用。" }, { status: 503 });
    const { id, index } = await context.params;
    const assetIndex = Number(index);
    if (!Number.isInteger(assetIndex) || assetIndex < 0) return Response.json({ error: "無效的檔案索引。" }, { status: 400 });

    const userId = request.headers.get("oai-authenticated-user-id") || "local-user";
    const db = getDb();
    const [row] = await db
      .select({ mediaJson: analysisHistory.mediaJson })
      .from(analysisHistory)
      .where(and(eq(analysisHistory.id, id), eq(analysisHistory.userId, userId)))
      .limit(1);
    if (!row) return Response.json({ error: "找不到此紀錄。" }, { status: 404 });

    const media = JSON.parse(row.mediaJson) as StoredMedia[];
    const asset = media[assetIndex];
    if (!asset) return Response.json({ error: "找不到此檔案。" }, { status: 404 });
    const body = await getAsset(asset.key);
    if (!body) return Response.json({ error: "檔案已不存在。" }, { status: 404 });

    return new Response(body, {
      headers: {
        "Content-Type": asset.type,
        "Content-Disposition": `${asset.kind === "image" ? "inline" : "attachment"}; filename="${asset.kind === "image" ? `screenshot-${assetIndex + 1}` : "google-slides.pdf"}"`,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "無法讀取紀錄檔案。" }, { status: 500 });
  }
}
