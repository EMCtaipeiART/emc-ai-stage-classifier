import { IMAGE_MODEL_DEFAULT, IMAGE_PRICE_PER_MILLION, imageSizeFor } from "@/lib/outfit-spec";

// 角色工坊的 OpenAI 呼叫：照片 → 角色描述（文字）→ 三視圖 → 其餘角度。
// 風格參考用 3D 辦公室裡現有的人物圖集（12 個面向、2880×240），直接從正式網站讀，不另外內嵌。
const REFERENCE_URL = "https://emc-art.com/pixel-plaza/sprites-hd/Leona.png";
let referenceCache: Uint8Array | null = null;
export async function turntableReference(): Promise<Uint8Array> {
  if (referenceCache) return referenceCache;
  const response = await fetch(REFERENCE_URL);
  if (!response.ok) throw new Error("讀不到風格參考圖，請稍後再試。");
  referenceCache = new Uint8Array(await response.arrayBuffer());
  return referenceCache;
}

export function sniffImageMime(b: Uint8Array): string {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length > 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  return "";
}

export function friendlyError(status: number, message: string) {
  if (status === 401) return "OpenAI 金鑰無效或已被撤銷，請重新設定 OPENAI_API_KEY。";
  if (status === 403 || /verif/i.test(message)) return "這把 OpenAI 金鑰的組織尚未通過圖片模型的驗證。";
  if (status === 429) return "OpenAI 額度不足或請求太頻繁，請稍後再試。";
  if (/safety|moderation|content[_ ]policy/i.test(message)) return "OpenAI 的安全審查拒絕了這次內容，請換一張照片或調整描述再試。";
  return message || `OpenAI 回應異常（${status}）`;
}

const DESCRIBE_INSTRUCTIONS = `You look at a photo of a person and write a compact description of how to draw them as a cute chibi game character: hairstyle and hair color, face features worth keeping (glasses, beard, freckles, skin tone), the outfit from top to bottom (garments, colors, graphics, shoes) and accessories (hat, bag, jewelry). If the photo is half-length, invent simple matching trousers/skirt and shoes.
Do NOT describe the background, lighting, pose or the photo itself. Maximum 110 words, one line, English, comma-separated.`;

export async function describePerson(apiKey: string, photo: Uint8Array, mime: string): Promise<string> {
  let binary = "";
  for (let i = 0; i < photo.length; i += 0x8000) binary += String.fromCharCode(...photo.subarray(i, i + 0x8000));
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "gpt-5-mini", instructions: DESCRIBE_INSTRUCTIONS, reasoning: { effort: "low" }, input: [{ role: "user", content: [{ type: "input_text", text: "Describe this person as a game character." }, { type: "input_image", image_url: `data:${mime};base64,${btoa(binary)}` }] }] }),
    signal: AbortSignal.timeout(60_000),
  });
  const payload = await response.json().catch(() => ({})) as { output_text?: string; output?: Array<{ content?: Array<{ text?: string }> }>; error?: { message?: string } };
  if (!response.ok) throw new Error(`讀取照片失敗：${payload.error?.message || response.status}`);
  const text = (payload.output_text || (payload.output || []).flatMap((item) => item.content || []).map((part) => part.text || "").join(" ")).replace(/\s+/g, " ").trim();
  if (!text) throw new Error("沒有從照片讀到人物特徵，請換一張更清楚的照片，或在說明欄描述。");
  return text.slice(0, 800);
}

const STYLE = `ART STYLE: exactly the style of the attached reference strip (a turntable of an existing game character): cute 2-heads-tall chibi office worker, big round head, clean cel-shaded game illustration, EXTREMELY THICK smooth dark warm-black (#302828) outlines of even thickness, flat 2-3 tone shading, large round dark eyes with a white highlight, soft rosy cheeks, simple smile, plain rounded mitten hands, chunky shoes. Transparent background, no ground shadow, no text, no frame, no glow.`;

export function buildViews3Prompt(described: string, notes: string) {
  return [
    `The FIRST attached image is a STYLE AND PROPORTION REFERENCE: a strip of 12 turntable views of an existing game character. Draw ONE NEW character in exactly that art style, proportions (head size, body width, leg length) and level of detail.`,
    `NEW CHARACTER: ${described}.${notes.trim() ? ` Extra notes from the user: ${notes.trim()}` : ""}`,
    `LAYOUT: ONE ROW with THREE full-body views side by side in this order: FRONT (looking straight at the viewer), SIDE facing RIGHT (a pure profile, nose pointing to the right), BACK (seen from behind, no face). The three figures are the same size, large, fill the canvas width evenly, the soles of the shoes are on the same baseline and the tops of the heads are at the same height. Leave at least 8% empty margin above the heads and below the shoes, and clear empty space between figures; nothing touches or is cropped by the edges.`,
    `CONSISTENCY: all three views show the SAME character: same hair, face, outfit, colors, graphics and accessories (hat, glasses, bag) in the same positions. The back view shows the back of the hair/hat/clothes, never a face. Arms relaxed at the sides, standing straight, feet together or slightly apart.`,
    STYLE,
  ].join("\n\n");
}

const ANGLE_TEXT: Record<number, string> = {
  30: "turned 30 degrees from the front toward the viewer's RIGHT: a front three-quarter view, mostly facing the viewer, face visible, slightly rotated so the character's body faces a little to the right of the picture",
  60: "turned 60 degrees from the front toward the viewer's RIGHT: nearly a right-facing profile but the face still shows a bit of the front, chest turned slightly toward the viewer",
  120: "turned 120 degrees from the front (past the right-facing profile): a back three-quarter view from the RIGHT side, mostly seen from behind, only a little of the right cheek visible, the body faces right-and-away",
  150: "turned 150 degrees from the front: almost the back view, rotated slightly so a bit of the RIGHT side of the character is visible, no face",
  210: "turned 210 degrees from the front: almost the back view, rotated slightly the other way so a bit of the LEFT side of the character is visible, no face",
  240: "turned 240 degrees from the front: a back three-quarter view from the LEFT side, mostly seen from behind, only a little of the left cheek visible, the body faces left-and-away",
  300: "turned 300 degrees from the front, i.e. 60 degrees toward the viewer's LEFT: nearly a left-facing profile but the face still shows a bit of the front, chest turned slightly toward the viewer",
  330: "turned 330 degrees from the front, i.e. 30 degrees toward the viewer's LEFT: a front three-quarter view, mostly facing the viewer, face visible, body facing a little to the left of the picture",
};

export function buildAnglePrompt(deg: number, described: string) {
  return [
    `The FIRST attached image is a CHARACTER SHEET with three views of ONE character: FRONT, SIDE facing right, BACK. The SECOND attached image is a STYLE REFERENCE strip of an existing character showing how a 12-view turntable looks (views every 30 degrees).`,
    `Draw the SAME character from the sheet as ONE single full-body view, ${ANGLE_TEXT[deg]}.`,
    `KEEP EXACTLY: the character's identity, hair, face, outfit, colors, graphics, accessories (hat, glasses, bag), body proportions, outline thickness and the art style of the sheet. The figure is centered, standing straight, soles of the shoes near the bottom with about 8% margin, the head top at about 8% from the top, the same overall size as the figures on the sheet. Single figure only, transparent background, no ground shadow, no text.`,
    described ? `Character notes: ${described}` : "",
    STYLE,
  ].filter(Boolean).join("\n\n");
}

export type ImageUsage = { input_tokens?: number; output_tokens?: number; input_tokens_details?: { text_tokens?: number; image_tokens?: number } };
export function costOf(usage: ImageUsage | undefined) {
  if (!usage) return 0;
  const textIn = usage.input_tokens_details?.text_tokens ?? 0;
  const imageIn = usage.input_tokens_details?.image_tokens ?? Math.max(0, (usage.input_tokens ?? 0) - textIn);
  return (textIn * IMAGE_PRICE_PER_MILLION.textInput + imageIn * IMAGE_PRICE_PER_MILLION.imageInput + (usage.output_tokens ?? 0) * IMAGE_PRICE_PER_MILLION.output) / 1_000_000;
}

/** 呼叫 images/edits 生成一張圖；回傳 PNG 位元組與估計費用。 */
export async function editImage(apiKey: string, opts: { prompt: string; images: Array<{ bytes: Uint8Array; type: string; name: string }>; size?: "3views" | "square" }): Promise<{ png: Uint8Array; costUsd: number; model: string; transparent: boolean; usage: { input: number; output: number; total: number } }> {
  const model = process.env.OPENAI_IMAGE_MODEL || IMAGE_MODEL_DEFAULT;
  const build = (transparent: boolean) => {
    const body = new FormData();
    body.set("model", model);
    body.set("prompt", opts.prompt);
    body.set("size", opts.size === "square" ? "1024x1024" : imageSizeFor(model));
    body.set("quality", "high");
    if (transparent) body.set("background", "transparent");
    body.set("output_format", "png");
    body.set("n", "1");
    for (const image of opts.images) body.append("image[]", new Blob([image.bytes as BlobPart], { type: image.type }), image.name);
    return body;
  };
  type Payload = { data?: Array<{ b64_json?: string }>; usage?: ImageUsage; error?: { message?: string } };
  const call = (transparent: boolean) => fetch("https://api.openai.com/v1/images/edits", { method: "POST", headers: { Authorization: `Bearer ${apiKey}` }, body: build(transparent), signal: AbortSignal.timeout(420_000) });
  let transparent = true;
  let response = await call(true);
  let payload = await response.json().catch(() => ({})) as Payload;
  if (!response.ok && /background|transparen/i.test(payload.error?.message || "")) { transparent = false; response = await call(false); payload = await response.json().catch(() => ({})) as Payload; }
  if (!response.ok) throw new Error(friendlyError(response.status, payload.error?.message || ""));
  const b64 = payload.data?.[0]?.b64_json;
  if (!b64) throw new Error("OpenAI 沒有回傳圖片，請再試一次。");
  const binary = atob(b64), png = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) png[i] = binary.charCodeAt(i);
  return { png, costUsd: costOf(payload.usage), model, transparent, usage: { input: payload.usage?.input_tokens ?? 0, output: payload.usage?.output_tokens ?? 0, total: (payload.usage?.input_tokens ?? 0) + (payload.usage?.output_tokens ?? 0) } };
}
