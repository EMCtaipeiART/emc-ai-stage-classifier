import { buildOutfitPrompt, IMAGE_MODEL_DEFAULT, IMAGE_PRICE_PER_MILLION, IMAGE_SIZE } from "@/lib/outfit-spec";
import { OUTFIT_TEMPLATE_B64 } from "@/lib/outfit-template";

export const runtime = "edge";

// 生成一張約 30–120 秒，Cloudflare 對「一直沒有回應」的連線約 100 秒就會中斷（524）。
// 所以先回應、之後每 8 秒送一個空白當心跳，最後才送 JSON（前端用 JSON.parse，前面的空白不影響）。
const HEARTBEAT_MS = 8000;
const OPENAI_TIMEOUT_MS = 240_000;
const QUALITIES = ["low", "medium", "high"];

function base64ToBlob(base64: string, type: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type });
}

function friendlyError(status: number, message: string) {
  if (status === 401) return "OpenAI 金鑰無效或已被撤銷，請重新設定 OPENAI_API_KEY。";
  if (status === 403 || /verif/i.test(message)) return "這把 OpenAI 金鑰的組織尚未通過圖片模型的驗證（gpt-image-1 需要先在 OpenAI 後台完成組織驗證）。";
  if (status === 429) return "OpenAI 額度不足或請求太頻繁，請稍後再試，或到 OpenAI 後台檢查額度。";
  if (/safety|moderation|content[_ ]policy/i.test(message)) return "OpenAI 的安全審查拒絕了這次內容，請改一下服裝描述（避免真人、品牌或敏感內容）再試。";
  return message || `OpenAI 回應異常（${status}）`;
}

type ImageUsage = { input_tokens?: number; output_tokens?: number; total_tokens?: number; input_tokens_details?: { text_tokens?: number; image_tokens?: number } };

function estimateCostUsd(usage: ImageUsage | undefined) {
  if (!usage) return 0;
  const textIn = usage.input_tokens_details?.text_tokens ?? 0;
  const imageIn = usage.input_tokens_details?.image_tokens ?? Math.max(0, (usage.input_tokens ?? 0) - textIn);
  return (textIn * IMAGE_PRICE_PER_MILLION.textInput + imageIn * IMAGE_PRICE_PER_MILLION.imageInput + (usage.output_tokens ?? 0) * IMAGE_PRICE_PER_MILLION.output) / 1_000_000;
}

/** 這把金鑰目前能用的圖片模型（名稱含 image 的），給頁面讓使用者選。 */
export async function GET() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return Response.json({ error: "伺服器沒有設定 OPENAI_API_KEY。" }, { status: 500 });
  const response = await fetch("https://api.openai.com/v1/models", { headers: { Authorization: `Bearer ${apiKey}` } });
  const payload = await response.json().catch(() => ({})) as { data?: Array<{ id?: string }>; error?: { message?: string } };
  if (!response.ok) return Response.json({ error: friendlyError(response.status, payload.error?.message || "") }, { status: 502 });
  const models = (payload.data || []).map((item) => String(item.id || "")).filter((id) => /image/i.test(id) && !/dall-e/i.test(id)).sort();
  return Response.json({ models, current: process.env.OPENAI_IMAGE_MODEL || IMAGE_MODEL_DEFAULT });
}

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return Response.json({ error: "伺服器沒有設定 OPENAI_API_KEY。" }, { status: 500 });

  let form: FormData;
  try { form = await request.formData(); } catch { return Response.json({ error: "請求格式不正確。" }, { status: 400 }); }
  const description = String(form.get("description") || "").trim().slice(0, 600);
  const quality = QUALITIES.includes(String(form.get("quality"))) ? String(form.get("quality")) : "medium";
  const photos = form.getAll("images").filter((value): value is File => typeof value !== "string").slice(0, 2);
  for (const photo of photos) {
    if (!/^image\/(png|jpeg|webp)$/.test(photo.type) || photo.size > 10 * 1024 * 1024) return Response.json({ error: "參考圖只接受 10MB 內的 PNG、JPG、WebP。" }, { status: 400 });
  }
  if (!description && !photos.length) return Response.json({ error: "請輸入服裝描述（關鍵字），或上傳一張服裝參考圖。" }, { status: 400 });

  const requested = String(form.get("model") || "");
  const model = /^[a-z0-9][a-z0-9.\-]{2,60}$/.test(requested) && /image/i.test(requested) ? requested : (process.env.OPENAI_IMAGE_MODEL || IMAGE_MODEL_DEFAULT);
  const buildBody = (transparent: boolean) => {
  const body = new FormData();
  body.set("model", model);
  body.set("prompt", buildOutfitPrompt(description, photos.length > 0));
  body.set("size", IMAGE_SIZE);
  body.set("quality", quality);
  if (transparent) body.set("background", "transparent");
  body.set("output_format", "png");
  body.set("n", "1");
  body.append("image[]", base64ToBlob(OUTFIT_TEMPLATE_B64, "image/png"), "outfit-template.png");
  photos.forEach((photo, index) => body.append("image[]", photo, photo.name || `photo-${index + 1}`));
  return body;
  };

  const encoder = new TextEncoder();
  const startedAt = Date.now();
  const stream = new ReadableStream({
    async start(controller) {
      const heartbeat = setInterval(() => { try { controller.enqueue(encoder.encode(" ")); } catch { /* 已關閉 */ } }, HEARTBEAT_MS);
      const send = (payload: unknown) => controller.enqueue(encoder.encode(JSON.stringify(payload)));
      try {
        const call = (transparent: boolean) => fetch("https://api.openai.com/v1/images/edits", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}` },
          body: buildBody(transparent),
          signal: AbortSignal.timeout(OPENAI_TIMEOUT_MS),
        });
        type Payload = { data?: Array<{ b64_json?: string }>; usage?: ImageUsage; error?: { message?: string } };
        let transparent = true;
        let response = await call(true);
        let payload = await response.json().catch(() => ({})) as Payload;
        // 有些較新的圖片模型不支援透明背景參數：退回不帶這個參數，由前端把白底去掉
        if (!response.ok && /background|transparen/i.test(payload.error?.message || "")) {
          transparent = false;
          response = await call(false);
          payload = await response.json().catch(() => ({})) as Payload;
        }
        if (!response.ok) { send({ error: friendlyError(response.status, payload.error?.message || "") }); return; }
        const b64 = payload.data?.[0]?.b64_json;
        if (!b64) { send({ error: "OpenAI 沒有回傳圖片，請再試一次。" }); return; }
        send({
          image: `data:image/png;base64,${b64}`,
          model, quality, transparent,
          seconds: Math.round((Date.now() - startedAt) / 100) / 10,
          usage: { input: payload.usage?.input_tokens ?? 0, output: payload.usage?.output_tokens ?? 0, total: payload.usage?.total_tokens ?? 0, costUsd: estimateCostUsd(payload.usage) },
        });
      } catch (cause) {
        const timedOut = cause instanceof DOMException && cause.name === "TimeoutError";
        send({ error: timedOut ? "生成逾時（超過 4 分鐘），請改用較低的品質再試。" : (cause instanceof Error ? cause.message : "生成失敗，請稍後再試。") });
      } finally {
        clearInterval(heartbeat);
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}
