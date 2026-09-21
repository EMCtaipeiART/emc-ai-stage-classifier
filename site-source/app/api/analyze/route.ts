import { env } from "cloudflare:workers";
import { getDb } from "@/db";
import { analysisHistory } from "@/db/schema";
import { MODEL as OPENAI_MODEL, usageCostUsd } from "@/lib/pricing";
import { assetStorageReady, putAsset } from "@/lib/storage";
import skillMarkdown from "../../../skills/emc-stage-classifier/SKILL.md?raw";

export const runtime = "edge";

// 判定規則統一放在 skills/emc-stage-classifier/SKILL.md，這裡去掉 frontmatter 後當作 instructions
const skillInstructions = skillMarkdown.replace(/^---[\s\S]*?---\s*/, "").trim();
const GEMINI_MODEL = "gemini-3.6-flash";

const schema = {
  type: "object", additionalProperties: false,
  required: ["stage", "confidence", "reason", "tasks", "basis", "missing"],
  properties: {
    stage: { type: "string", enum: ["新製", "再製", "資訊不足"] },
    confidence: { type: "integer", minimum: 0, maximum: 100 },
    reason: { type: "string" }, tasks: { type: "array", items: { type: "string" }, maxItems: 8 },
    basis: { type: "string" }, missing: { type: "array", items: { type: "string" }, maxItems: 5 },
  },
};
function bytesToDataUrl(bytes: Uint8Array, contentType: string) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${contentType};base64,${btoa(binary)}`;
}

async function fileToDataUrl(file: File) {
  return bytesToDataUrl(new Uint8Array(await file.arrayBuffer()), file.type);
}

function getSlidesId(value: string) {
  const url = new URL(value);
  if (url.hostname !== "docs.google.com") throw new Error("請貼上 Google Slides 的公開分享連結。");
  const match = url.pathname.match(/^\/presentation\/d\/([^/]+)/);
  if (!match || match[1] === "e") throw new Error("請使用一般 Google Slides 分享連結，並開啟『知道連結的任何人都可查看』。");
  return match[1];
}

async function fetchSlidesPdf(slidesUrl: string) {
  const id = getSlidesId(slidesUrl);
  const response = await fetch(`https://docs.google.com/presentation/d/${encodeURIComponent(id)}/export/pdf`, { redirect: "follow" });
  const contentType = response.headers.get("content-type") || "";
  if (!response.ok || !contentType.includes("application/pdf")) {
    throw new Error("無法讀取 Google Slides，請確認已設為『知道連結的任何人都可查看』。");
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.length || bytes.length > 15 * 1024 * 1024) throw new Error("Google Slides 匯出檔過大或內容為空，請改用截圖上傳。");
  return { bytes, dataUrl: bytesToDataUrl(bytes, "application/pdf") };
}

type OpenAIResponsePayload = {
  output_text?: string;
  output?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string }>;
  }>;
  error?: { message?: string };
  incomplete_details?: { reason?: string };
  usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number; input_tokens_details?: { cached_tokens?: number } };
};

type GeminiResponsePayload = {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  error?: { message?: string; status?: string };
  usageMetadata?: {
    promptTokenCount?: number;
    cachedContentTokenCount?: number;
    candidatesTokenCount?: number;
    thoughtsTokenCount?: number;
    totalTokenCount?: number;
  };
  modelVersion?: string;
};

type ProviderResult = {
  result: Record<string, unknown>;
  usage: {
    input: number;
    cached: number;
    output: number;
    total: number;
    costUsd: number;
    provider: "gemini" | "openai";
    model: string;
    fallbackUsed: boolean;
  };
};

type StoredMedia = { key: string; name: string; type: string; kind: "image" | "slides" };

async function saveHistory(input: {
  request: Request;
  images: File[];
  slidesUrl: string;
  slidesPdf: { bytes: Uint8Array } | null;
  result: unknown;
  usage: { input: number; cached: number; output: number; total: number; costUsd: number };
}) {
  if (!env.DB || !assetStorageReady()) throw new Error("歷史紀錄儲存空間尚未啟用。");
  const userId = input.request.headers.get("oai-authenticated-user-id") || "local-user";
  const safeUserId = userId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const id = crypto.randomUUID();
  const media: StoredMedia[] = [];

  for (const [index, image] of input.images.entries()) {
    const extension = image.type === "image/png" ? "png" : image.type === "image/webp" ? "webp" : "jpg";
    const key = `analysis/${safeUserId}/${id}/image-${index + 1}.${extension}`;
    await putAsset(key, await image.arrayBuffer(), image.type);
    media.push({ key, name: image.name || `截圖 ${index + 1}`, type: image.type, kind: "image" });
  }

  if (input.slidesPdf) {
    const key = `analysis/${safeUserId}/${id}/google-slides.pdf`;
    await putAsset(key, input.slidesPdf.bytes, "application/pdf");
    media.push({ key, name: "Google Slides 快照.pdf", type: "application/pdf", kind: "slides" });
  }

  const sourceType = input.images.length && input.slidesPdf ? "截圖＋Google Slides" : input.images.length ? "截圖" : "Google Slides";
  const db = getDb();
  await db.insert(analysisHistory).values({
    id,
    userId,
    sourceType,
    slidesUrl: input.slidesUrl || null,
    imageCount: input.images.length,
    resultJson: JSON.stringify(input.result),
    mediaJson: JSON.stringify(media),
    usageInput: input.usage.input,
    usageOutput: input.usage.output,
    usageTotal: input.usage.total,
    usageCached: input.usage.cached,
  });
  return id;
}

function getResponseText(payload: OpenAIResponsePayload) {
  if (typeof payload.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  return (payload.output || [])
    .flatMap((item) => item.content || [])
    .filter((item) => item.type === "output_text" && typeof item.text === "string")
    .map((item) => item.text)
    .join("")
    .trim();
}

function getGeminiText(payload: GeminiResponsePayload) {
  return (payload.candidates || [])
    .flatMap((candidate) => candidate.content?.parts || [])
    .map((part) => part.text || "")
    .join("")
    .trim();
}

async function analyzeWithGemini(
  apiKey: string,
  images: File[],
  slidesPdf: { bytes: Uint8Array } | null,
): Promise<ProviderResult> {
  const parts: Array<Record<string, unknown>> = [{
    text: `請依附件判定案件階段。資料優先順序：第一優先為截圖，第二優先為 Google Slides PDF。可用截圖：${images.length} 張；可讀簡報：${slidesPdf ? "有" : "無"}。`,
  }];
  for (const image of images) {
    const dataUrl = await fileToDataUrl(image);
    parts.push({ inlineData: { mimeType: image.type, data: dataUrl.split(",")[1] } });
  }
  if (slidesPdf) {
    const dataUrl = bytesToDataUrl(slidesPdf.bytes, "application/pdf");
    parts.push({ inlineData: { mimeType: "application/pdf", data: dataUrl.split(",")[1] } });
  }

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: `${skillInstructions}\n\n## 資料優先順序\n1. 截圖是第一優先，仔細辨識其中的文字、來源素材檔名與尺寸、目標輸出尺寸、版型與修改指示。\n2. Google Slides PDF 是第二優先；若與截圖矛盾，以截圖為準。` }] },
      contents: [{ role: "user", parts }],
      generationConfig: {
        responseMimeType: "application/json",
        responseJsonSchema: schema,
      },
    }),
  });
  const payload = await response.json() as GeminiResponsePayload;
  if (!response.ok) throw new Error(payload.error?.message || `Gemini 回應失敗（${response.status}）`);
  const outputText = getGeminiText(payload);
  if (!outputText) throw new Error("Gemini 未回傳可用的判定結果。");
  const result = JSON.parse(outputText) as Record<string, unknown>;
  const metadata = payload.usageMetadata || {};
  const input = metadata.promptTokenCount || 0;
  const cached = metadata.cachedContentTokenCount || 0;
  const total = metadata.totalTokenCount || 0;
  const output = metadata.candidatesTokenCount || metadata.thoughtsTokenCount
    ? (metadata.candidatesTokenCount || 0) + (metadata.thoughtsTokenCount || 0)
    : Math.max(0, total - input);
  return {
    result,
    usage: { input, cached, output, total, costUsd: 0, provider: "gemini", model: payload.modelVersion || GEMINI_MODEL, fallbackUsed: false },
  };
}

async function analyzeWithOpenAI(
  apiKey: string,
  images: File[],
  slidesPdf: { bytes: Uint8Array; dataUrl: string } | null,
  fallbackUsed: boolean,
): Promise<ProviderResult> {
  const content: Array<Record<string, string>> = [{ type: "input_text", text: `請依附件判定案件階段。資料優先順序：第一優先為截圖，第二優先為 Google Slides PDF。可用截圖：${images.length} 張；可讀簡報：${slidesPdf ? "有" : "無"}。` }];
  for (const image of images) content.push({ type: "input_image", image_url: await fileToDataUrl(image) });
  if (slidesPdf) content.push({ type: "input_file", filename: "google-slides.pdf", file_data: slidesPdf.dataUrl, detail: "auto" });
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      instructions: `${skillInstructions}\n\n## 資料優先順序\n1. 截圖是第一優先，仔細辨識其中的文字、來源素材檔名與尺寸、目標輸出尺寸、版型與修改指示。\n2. Google Slides PDF 是第二優先；若與截圖矛盾，以截圖為準。`,
      reasoning: { effort: "medium" },
      input: [{ role: "user", content }], text: { format: { type: "json_schema", name: "stage_decision", strict: true, schema } },
    }),
  });
  const payload = await response.json() as OpenAIResponsePayload;
  if (!response.ok) throw new Error(payload.error?.message || "OpenAI 分析服務回應失敗。");
  const outputText = getResponseText(payload);
  if (!outputText) {
    const detail = payload.incomplete_details?.reason;
    throw new Error(detail ? `OpenAI 回應未完成（${detail}）。` : "OpenAI 未回傳可用的判定結果。");
  }
  const result = JSON.parse(outputText) as Record<string, unknown>;
  const tokens = {
    input: payload.usage?.input_tokens || 0,
    cached: payload.usage?.input_tokens_details?.cached_tokens || 0,
    output: payload.usage?.output_tokens || 0,
    total: payload.usage?.total_tokens || 0,
  };
  return {
    result,
    usage: { ...tokens, costUsd: usageCostUsd(tokens), provider: "openai", model: OPENAI_MODEL, fallbackUsed },
  };
}

export async function POST(request: Request) {
  try {
    const geminiApiKey = process.env.GEMINI_API_KEY;
    const openAiApiKey = process.env.OPENAI_API_KEY;
    if (!geminiApiKey && !openAiApiKey) return Response.json({ error: "網站尚未完成 AI 金鑰設定。" }, { status: 503 });
    const form = await request.formData();
    const slidesUrl = String(form.get("slidesUrl") || "").trim();
    const images = form.getAll("images")
      .filter((item): item is File => item instanceof File && /^image\/(png|jpeg|webp)$/.test(item.type) && item.size <= 10 * 1024 * 1024)
      .slice(0, 3);
    if (!slidesUrl && !images.length) return Response.json({ error: "請上傳截圖，或貼上公開的 Google Slides 連結。" }, { status: 400 });
    let slidesPdf: { bytes: Uint8Array; dataUrl: string } | null = null;
    let slidesWarning = "";
    if (slidesUrl) {
      try {
        slidesPdf = await fetchSlidesPdf(slidesUrl);
      } catch (error) {
        slidesWarning = error instanceof Error ? error.message : "Google Slides 無法讀取。";
        if (!images.length) return Response.json({ error: slidesWarning }, { status: 422 });
      }
    }
    let analysis: ProviderResult | null = null;
    let geminiFailure = "";
    if (geminiApiKey) {
      try {
        analysis = await analyzeWithGemini(geminiApiKey, images, slidesPdf);
      } catch (error) {
        geminiFailure = error instanceof Error ? error.message : "Gemini 分析失敗。";
        console.warn("Gemini primary failed; using OpenAI fallback.", geminiFailure);
      }
    }
    if (!analysis && openAiApiKey) {
      analysis = await analyzeWithOpenAI(openAiApiKey, images, slidesPdf, Boolean(geminiApiKey));
    }
    if (!analysis) {
      return Response.json({ error: geminiFailure || "AI 分析服務目前無法使用。" }, { status: 502 });
    }
    const result = { ...analysis.result, provider: analysis.usage.provider, model: analysis.usage.model, fallbackUsed: analysis.usage.fallbackUsed };
    const usage = analysis.usage;
    let historyId: string | null = null;
    let historyWarning = "";
    try {
      historyId = await saveHistory({ request, images, slidesUrl, slidesPdf, result, usage });
    } catch (error) {
      historyWarning = error instanceof Error ? error.message : "歷史紀錄儲存失敗。";
    }
    return Response.json({ ...result, usage, historyId, historySaved: Boolean(historyId), historyWarning, slidesWarning });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "分析時發生未預期錯誤。" }, { status: 500 }); }
}
