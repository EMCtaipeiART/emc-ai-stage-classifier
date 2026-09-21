import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { analysisHistory } from "@/db/schema";
import { accessPassword } from "@/lib/access";
import { usageCostUsd } from "@/lib/pricing";

type StoredMedia = { key: string; name: string; type: string; kind: "image" | "slides" };
type StoredResult = { provider?: "gemini" | "openai"; model?: string; fallbackUsed?: boolean } & Record<string, unknown>;

function rowCost(result: StoredResult, input: number, cached: number, output: number) {
  return result.provider === "gemini" ? 0 : usageCostUsd({ input, cached, output });
}

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
    const usageRows = await db
      .select({
        resultJson: analysisHistory.resultJson,
        input: analysisHistory.usageInput,
        cached: analysisHistory.usageCached,
        output: analysisHistory.usageOutput,
        total: analysisHistory.usageTotal,
      })
      .from(analysisHistory)
      .where(eq(analysisHistory.userId, userId));

    const items = rows.map((row) => {
      const media = JSON.parse(row.mediaJson) as StoredMedia[];
      const result = JSON.parse(row.resultJson) as StoredResult;
      return {
        id: row.id,
        createdAt: row.createdAt,
        sourceType: row.sourceType,
        slidesUrl: row.slidesUrl,
        imageCount: row.imageCount,
        result,
        usage: {
          input: row.usageInput,
          cached: row.usageCached,
          output: row.usageOutput,
          total: row.usageTotal,
          costUsd: rowCost(result, row.usageInput, row.usageCached, row.usageOutput),
          provider: result.provider || "openai",
          model: result.model || "gpt-5-mini",
          fallbackUsed: Boolean(result.fallbackUsed),
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
        analyses: usageRows.length,
        tokens: usageRows.reduce((total, row) => total + row.total, 0),
        costUsd: usageRows.reduce((total, row) => {
          const result = JSON.parse(row.resultJson) as StoredResult;
          return total + rowCost(result, row.input, row.cached, row.output);
        }, 0),
      },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "無法讀取歷史紀錄。" }, { status: 500 });
  }
}
