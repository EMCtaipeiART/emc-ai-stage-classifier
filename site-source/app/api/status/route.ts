import { MODEL as OPENAI_MODEL } from "@/lib/pricing";
import { GEMINI_MODELS } from "@/lib/models";

export const runtime = "edge";

/** 檢查目前實際會用哪個 AI 引擎：Gemini 為主、OpenAI 為備援。畫面與前台都靠這支確認設定是否正確。 */
export async function GET() {
  const geminiKey = process.env.GEMINI_API_KEY || "";
  const openAiKey = process.env.OPENAI_API_KEY || "";
  const models: Array<{ model: string; ok: boolean; error: string }> = [];

  if (geminiKey) {
    for (const model of GEMINI_MODELS) {
      try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}`, {
          headers: { "x-goog-api-key": geminiKey },
        });
        const payload = await response.json().catch(() => ({})) as { error?: { message?: string } };
        models.push({ model, ok: response.ok, error: response.ok ? "" : (payload.error?.message || `Gemini 回應失敗（${response.status}）`) });
      } catch (error) {
        models.push({ model, ok: false, error: error instanceof Error ? error.message : "Gemini 連線失敗。" });
      }
    }
  }
  const geminiOk = models.some((item) => item.ok);
  const geminiError = geminiKey ? (geminiOk ? "" : models.map((item) => `${item.model}: ${item.error}`).join("；")) : "尚未設定 GEMINI_API_KEY。";

  return Response.json({
    activeProvider: geminiOk ? "gemini" : (openAiKey ? "openai" : "none"),
    gemini: { configured: Boolean(geminiKey), models, ok: geminiOk, error: geminiError },
    openai: { configured: Boolean(openAiKey), model: OPENAI_MODEL },
    checkedAt: new Date().toISOString(),
  });
}
