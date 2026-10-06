import { buildOutfitPrompt, buildRefitPrompt, IMAGE_MODEL_DEFAULT, IMAGE_PRICE_PER_MILLION, imageSizeFor } from "@/lib/outfit-spec";
import { currentUser } from "@/lib/access";
import { designApi, editorTokenOf, whoami } from "@/lib/coins-client";
import { createDraft, getItem, setGeneration } from "@/lib/outfit-items";
import { saveOutfitRecord } from "@/lib/outfit-history";
import { OUTFIT_TEMPLATE_B64 } from "@/lib/outfit-template";
import { OUTFIT_REFERENCE_B64 } from "@/lib/outfit-reference";

export const runtime = "edge";

// 生成一張約 30–120 秒，Cloudflare 對「一直沒有回應」的連線約 100 秒就會中斷（524）。
// 所以先回應、之後每 8 秒送一個空白當心跳，最後才送 JSON（前端用 JSON.parse，前面的空白不影響）。
const HEARTBEAT_MS = 8000;
const OPENAI_TIMEOUT_MS = 420_000;   // 最高品質一次三張，可能要好幾分鐘
// 品質與模型固定（2026-10-06 使用者指定：預設最高、不再提供選擇）；用戶端送來的 quality／model 一律忽略
const QUALITY = "high";
const VARIANTS = 3;                  // 一次生成三組供選

function base64ToBlobBytes(base64: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

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

const DESCRIBE_MODEL = "gpt-5-mini";
const DESCRIBE_INSTRUCTIONS = `You look at photos of a person wearing an outfit and write a compact description of ONLY the clothing, for a game-art illustrator who will redraw the outfit as a flat cartoon.
Rules: list every garment from top to bottom (outer layer, inner top, bottoms, shoes) and every accessory (bags, belts, jewelry, pins, trims). For each give the garment type, the main colors (plain color words), the pattern or material in one or two simple words (for example "pink tweed with pearl trim", "navy wide-leg trousers", "leopard print"), and notable details (buttons, pockets, collar, zipper, chain strap). Describe the loose, boxy, oversized cartoon version of each garment, not a tailored real-life fit.
Do NOT describe the person, face, hair, body shape, pose, background, lighting or the photo itself. Maximum 90 words, one line, English, comma-separated.`;

type DescribePayload = { output_text?: string; output?: Array<{ content?: Array<{ type?: string; text?: string }> }>; error?: { message?: string } };

/** 先請視覺模型把照片裡的「衣服」用文字描述出來，之後生成只用文字，不再把照片本身丟給圖片模型——
 *  照片會把真人的身形、水彩般的布料質感一起帶進來（2026-10-05 實測：比例跑掉、畫面像水彩）。 */
async function describeOutfit(apiKey: string, photos: File[]): Promise<string> {
  const content: Array<Record<string, string>> = [{ type: "input_text", text: "Describe the outfit." }];
  for (const photo of photos) {
    const bytes = new Uint8Array(await photo.arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    content.push({ type: "input_image", image_url: `data:${photo.type};base64,${btoa(binary)}` });
  }
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: DESCRIBE_MODEL, instructions: DESCRIBE_INSTRUCTIONS, reasoning: { effort: "low" }, input: [{ role: "user", content }] }),
    signal: AbortSignal.timeout(60_000),
  });
  const payload = await response.json().catch(() => ({})) as DescribePayload;
  if (!response.ok) throw new Error(`讀取照片裡的衣服失敗：${payload.error?.message || response.status}`);
  const text = (payload.output_text || (payload.output || []).flatMap((item) => item.content || []).map((part) => part.text || "").join(" ")).replace(/\s+/g, " ").trim();
  if (!text) throw new Error("沒有從照片讀到衣服，請換一張更清楚的照片，或直接輸入文字描述。");
  return text.slice(0, 700);
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
  const quality = QUALITY;
  const refit = String(form.get("mode")) === "refit";
  // 預設用「六套現有服裝的參考圖」當風格與比例參考（細節與線條最精緻、人物最大）；只有修正比例時才用無頭身體底圖。
  const base: "template" | "sheet" = refit || String(form.get("base")) === "template" ? "template" : "sheet";
  const photos = form.getAll("images").filter((value): value is File => typeof value !== "string").slice(0, 2);
  for (const photo of photos) {
    if (!/^image\/(png|jpeg|webp)$/.test(photo.type) || photo.size > 10 * 1024 * 1024) return Response.json({ error: "參考圖只接受 10MB 內的 PNG、JPG、WebP。" }, { status: 400 });
  }
  if (refit && !photos.length) return Response.json({ error: "需要附上要修正的圖片。" }, { status: 400 });
  if (!description && !photos.length) return Response.json({ error: "請輸入服裝描述（關鍵字），或上傳一張服裝參考圖。" }, { status: 400 });

  const model = process.env.OPENAI_IMAGE_MODEL || IMAGE_MODEL_DEFAULT;
  let promptDescription = description, editPhotos = photos;
  const buildBody = (transparent: boolean) => {
  const body = new FormData();
  body.set("model", model);
  body.set("prompt", refit ? buildRefitPrompt(promptDescription) : buildOutfitPrompt(promptDescription, editPhotos.length > 0, base));
  body.set("size", imageSizeFor(model));
  body.set("quality", quality);
  if (transparent) body.set("background", "transparent");
  body.set("output_format", "png");
  body.set("n", String(VARIANTS));
  if (base === "sheet") body.append("image[]", base64ToBlob(OUTFIT_REFERENCE_B64, "image/webp"), "outfit-reference.webp");
  else body.append("image[]", base64ToBlob(OUTFIT_TEMPLATE_B64, "image/png"), "outfit-template.png");
  editPhotos.forEach((photo, index) => body.append("image[]", photo, photo.name || `photo-${index + 1}`));
  return body;
  };

  // 平台幣：要用設計系統帳號（有 token）才能生成；先扣 200 點，沒有成功就退回。管理員（沒有設計師身分）不扣點。
  const editorToken = editorTokenOf(request);
  if (!editorToken) return Response.json({ error: "請從設計需求系統登入，再從左側選單的「服裝」進入這個頁面；生成需要設計師帳號的平台幣。", reason: "LOGIN_REQUIRED" }, { status: 401 });
  const generationId = crypto.randomUUID();
  // 同一件服裝重新生成（還沒完成的製作單）：只扣 100 點，結果換成這次的圖；沒帶 itemId 就是新的一件（200 點）
  const itemId = String(form.get("itemId") || "");
  let attempt = 1;
  if (itemId) {
    const who = await whoami(request);
    const item = who ? await getItem(itemId) : null;
    if (!who || !item || item.owner_account !== who.account || item.status !== "draft" || item.attempts < 1) return Response.json({ error: "這件服裝已經完成或找不到，無法重新生成；請開始新的一件。" }, { status: 409 });
    attempt = item.attempts + 1;
  }
  const regenerate = Boolean(itemId);
  const reserve = await designApi("coinReserve", { editorToken, ref: generationId, regenerate }, true);
  if (!reserve.ok) return Response.json({ error: reserve.error === "TOKEN_EXPIRED" ? "登入已過期，請回設計需求系統重新登入後再進入。" : (reserve.error || "平台幣扣款失敗"), reason: reserve.error === "TOKEN_EXPIRED" ? "TOKEN_EXPIRED" : "COIN" }, { status: reserve.error === "TOKEN_EXPIRED" ? 401 : 402 });
  const coin = { exempt: Boolean(reserve.exempt), charged: Number(reserve.charged) || 0, balance: Number(reserve.balance) || 0, holder: String(reserve.name || "") };
  const userId = coin.holder || String(reserve.account || (await currentUser(request)));
  const encoder = new TextEncoder();
  const startedAt = Date.now();
  const stream = new ReadableStream({
    async start(controller) {
      const heartbeat = setInterval(() => { try { controller.enqueue(encoder.encode(" ")); } catch { /* 已關閉 */ } }, HEARTBEAT_MS);
      const send = (payload: unknown) => controller.enqueue(encoder.encode(JSON.stringify(payload)));
      const base = { id: generationId, userId, model, quality, description, described: "", photoCount: photos.length, transparent: true, coinCost: coin.charged, coinExempt: coin.exempt, itemId, attempt };
      const seconds = () => Math.round((Date.now() - startedAt) / 100) / 10;
      // 每次生成（成功或失敗）都記一筆；記錄失敗不影響生成結果
      const fail = async (message: string) => {
        // 沒有成功：先把這次扣的平台幣退回（只有這個站能退），再記錄
        let refunded = false;
        if (!coin.exempt) {
          const refund = await designApi("coinRefund", { ref: generationId, reason: message.slice(0, 60) }, true).catch(() => null);
          refunded = Boolean(refund?.ok && (refund.refunded || refund.reason === "already-refunded"));
        }
        await saveOutfitRecord({ ...base, coinCost: refunded ? 0 : coin.charged, status: "failed", seconds: seconds(), usage: { input: 0, output: 0, total: 0, costUsd: 0 }, error: message, pngs: [] }).catch(() => undefined);
        send({ error: message + (refunded ? "（已退回這次扣的平台幣）" : ""), recordId: base.id, coin: { ...coin, refunded } });
      };
      try {
        let described = "";
        if (!refit && photos.length) {
          described = await describeOutfit(apiKey, photos);
          promptDescription = [described, description].filter(Boolean).join(" Additional notes: ");
          editPhotos = [];
        }
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
        if (!response.ok) { await fail(friendlyError(response.status, payload.error?.message || "")); return; }
        const all = (payload.data || []).map((item) => item.b64_json || "").filter(Boolean);
        if (!all.length) { await fail("OpenAI 沒有回傳圖片，請再試一次。"); return; }
        const usage = { input: payload.usage?.input_tokens ?? 0, output: payload.usage?.output_tokens ?? 0, total: payload.usage?.total_tokens ?? 0, costUsd: estimateCostUsd(payload.usage) };
        const pngs = all.map(base64ToBlobBytes);
        let recordWarning = "";
        let finalItemId = itemId;
        try {
          await saveOutfitRecord({ ...base, described, transparent, status: "ok", seconds: seconds(), usage, error: "", pngs });
          // 這次的結果掛到製作單上：新的一件就建立草稿，重新生成就換成這次的圖（之前的圖仍留在生成紀錄裡）
          const text = [description, described].filter(Boolean).join("；");
          if (itemId) await setGeneration(itemId, generationId, text);
          else { finalItemId = crypto.randomUUID(); await createDraft({ id: finalItemId, account: String(reserve.account || userId), name: coin.holder, description: text, generationId }); }
        } catch (cause) { recordWarning = cause instanceof Error ? cause.message : "紀錄寫入失敗"; }
        send({
          recordId: base.id, recordWarning, coin, itemId: finalItemId, attempt, regenerationCost: 50,
          images: all.map((b64) => `data:image/png;base64,${b64}`),
          model, quality, transparent, described,
          seconds: Math.round((Date.now() - startedAt) / 100) / 10,
          usage: { input: payload.usage?.input_tokens ?? 0, output: payload.usage?.output_tokens ?? 0, total: payload.usage?.total_tokens ?? 0, costUsd: estimateCostUsd(payload.usage) },
        });
      } catch (cause) {
        const timedOut = cause instanceof DOMException && cause.name === "TimeoutError";
        await fail(timedOut ? "生成逾時（超過 7 分鐘），請稍後再試；這次扣的平台幣會退回。" : (cause instanceof Error ? cause.message : "生成失敗，請稍後再試。"));
      } finally {
        clearInterval(heartbeat);
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}
