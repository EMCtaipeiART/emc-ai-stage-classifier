import { count, desc, eq, sum } from "drizzle-orm";
import { getDb } from "@/db";
import { analysisHistory } from "@/db/schema";
import { accessPassword } from "@/lib/access";
import { usageCostUsd } from "@/lib/pricing";

type StoredMedia = { key: string; name: string; type: string; kind: "image" | "slides" };

export async function GET(request: Request) {
  try {
    const userId = request.headers.get("oai-authenticated-user-id") || "local-user";
    const db = getDb();
    const rows = await db
      .select()
      .from(analysisHistory)
      .where(eq(analysisHistory.userId, userId))
      .orderBy(desc(analysisHistory.createdAt))
      .limit(50);
    const [aggregate] = await db
      .select({
        analyses: count(),
        tokens: sum(analysisHistory.usageTotal),
        input: sum(analysisHistory.usageInput),
        cached: sum(analysisHistory.usageCached),
        output: sum(analysisHistory.usageOutput),
      })
      .from(analysisHistory)
      .where(eq(analysisHistory.userId, userId));

    const items = rows.map((row) => {
      const media = JSON.parse(row.mediaJson) as StoredMedia[];
      return {
        id: row.id,
        createdAt: row.createdAt,
        sourceType: row.sourceType,
        slidesUrl: row.slidesUrl,
        imageCount: row.imageCount,
        result: JSON.parse(row.resultJson),
        usage: {
          input: row.usageInput,
          cached: row.usageCached,
          output: row.usageOutput,
          total: row.usageTotal,
          costUsd: usageCostUsd({ input: row.usageInput, cached: row.usageCached, output: row.usageOutput }),
        },
        assets: media.map((item, index) => ({
          name: item.name,
          type: item.type,
          kind: item.kind,
          url: `/api/history/${row.id}/asset/${index}`,
        })),
      };
    });

    return Response.json({
      items,
      accessProtected: Boolean(accessPassword()),
      totals: {
        analyses: Number(aggregate?.analyses || 0),
        tokens: Number(aggregate?.tokens || 0),
        costUsd: usageCostUsd({
          input: Number(aggregate?.input || 0),
          cached: Number(aggregate?.cached || 0),
          output: Number(aggregate?.output || 0),
        }),
      },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "無法讀取歷史紀錄。" }, { status: 500 });
  }
}
