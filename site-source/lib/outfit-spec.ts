// 服裝生成器的提示詞與規格數值。數值來自 EMC-ART-Pixel-Office/docs/OUTFIT_SPEC.md（從現有六套服裝量出來的），
// 兩邊要一致：改規格時兩個地方一起改。

export const OUTFIT_SPEC = {
  /** 身體高度 H = 100%；其餘都是占 H 的比例 */
  frontWidth: [0.72, 1.1],      // 正面／背面寬度（含手臂）
  sideWidth: [0.5, 0.7],        // 側面寬度
  neckWidth: [0.1, 0.34],       // 頸頂切口附近的寬度（規格的脖子約 14–20%，連帽衫、領口會偏大，所以放寬）
  baselineTolerance: 0.04,      // 三張圖腳底線的誤差
  heightTolerance: 0.06,        // 三張圖高度的誤差
} as const;

const TEMPLATE_RULES = `The FIRST attached image is a TEMPLATE: three views (FRONT, SIDE facing RIGHT, BACK) of a HEADLESS clothing mannequin wearing a black hoodie, black sweatpants and black sneakers. Redraw this exact template wearing a NEW OUTFIT.

Keep EXACTLY as in the template: the canvas size, the three-view layout and spacing, the poses, the figure sizes and body proportions (short upper body, long legs, wide relaxed A-pose), the plain rounded mitten hands with no fingers, the chunky shoe size, the skin color (#F8B888) and the art style (bold dark warm-black outline, flat cel-shading with one soft shadow tone, light from the upper left, no gradients or textures).

HEADLESS - THIS IS THE MOST IMPORTANT RULE: the figures have NO head, NO face, NO hair, NO ears. Each figure is cut off at the neck: the top of every view is the short skin-colored neck stump with a FLAT, HORIZONTAL cut across its top, exactly like in the template. Never add a head, hat, glasses or headphones. Nothing may extend above the neck stump.

Change ONLY the clothing: the top, the bottom, the shoes and the graphics on them. If the new garments are shorter, longer or wider than the template's, reshape the garments (for example shorts show more leg, a long coat covers more), but never change the body, the neck or the hands.`;

const BODY_LOCK = `BODY SHAPE LOCK: every figure keeps the template's body, never the body of any person in a photo. The template body is WIDE and CHUNKY, not slim: the front and back views are almost as wide as they are tall (arms held clearly away from the torso, width about 90-104% of the height), the side view is about 54-66% of the height wide; the legs are thick and the trousers loose and wide; the shoes are big and chunky; the upper body (neck to crotch) is only about 45% of the height. Do NOT make the figure taller, slimmer or more realistic than the template, and do not copy the slim fit of garments from photos: re-fit every garment onto the template body so it looks loose and boxy.`;

const CRISP_STYLE = `RENDERING QUALITY: crisp, clean, high-resolution cel-shaded game-art illustration. Bold smooth dark outlines of even thickness, flat clean color fills with one soft shading tone and a few sharp highlights. NO painterly brush strokes, NO watercolor or oil texture, NO noise, grain or speckle, NO rough, broken or blurry edges, NO realistic fabric texture. Patterns (tweed, plaid, leopard, florals, knit) are drawn as simple clean repeating shapes with clear edges. Zoomed in, every line must look sharp and deliberate.`;

const SHEET_RULES = `The FIRST attached image is a STYLE AND PROPORTION REFERENCE: a sheet of six existing outfits, each shown as three views (front, side facing right, back) on a HEADLESS clothing mannequin body. Draw ONE NEW outfit in exactly the same art style, with exactly the same body construction and proportions, as those six.

Layout: ONE ROW with THREE views side by side in this order: FRONT, SIDE facing RIGHT, BACK. The three figures are large and fill the width of the canvas evenly, the same size, with the soles of the shoes on the same baseline and clear empty space between the views.

HEADLESS - THIS IS THE MOST IMPORTANT RULE: draw NO head, NO face, NO hair, NO ears, exactly like the reference sheet. Each figure is cut off at the neck: the top of every view is the short skin-colored neck stump (#F8B888) with a FLAT, HORIZONTAL cut across its top. Never add a head, hat, glasses or headphones. Nothing may extend above the neck stump.`;

const CONSISTENCY = `All three views must show the SAME outfit consistently (same colors, graphics, lengths, pocket positions). The back view must show a plausible back of the garment (the back of the neck is skin colored; do not draw the front neckline on the back). Keep clothing graphics simple and bold, never tiny details. The three views stay the same height with the soles of the shoes on the same baseline. Fully transparent background (if transparency is impossible, use a flat pure white background and never use pure white inside the clothes or shoes). No text, watermark, grid lines, labels or color swatches.`;

/** 組出送給 OpenAI 的提示詞。hasPhoto：使用者另外附了服裝參考圖（第二張起）。 */
export type OutfitBase = "template" | "sheet";
export function buildOutfitPrompt(description: string, hasPhoto: boolean, mode: OutfitBase = "sheet") {
  const outfit = description.trim() || "(no text description - copy the outfit from the attached photo)";
  const source = hasPhoto
    ? `NEW OUTFIT: the clothing shown in the additional attached image(s) after the first image. Reproduce that clothing (colors, garment types, graphics) on the template figures. Extra notes from the user: ${outfit}`
    : `NEW OUTFIT: ${outfit}`;
  return [mode === "sheet" ? SHEET_RULES : TEMPLATE_RULES, source, BODY_LOCK, CRISP_STYLE, CONSISTENCY].join("\n\n");
}

/** 比例不對時：把上一張結果當成「衣服」，重新套到標準身體上。 */
export function buildRefitPrompt(note: string) {
  const extra = note.trim() ? ` Extra notes from the user: ${note.trim()}` : "";
  return [TEMPLATE_RULES, `NEW OUTFIT: the additional attached image is a DRAFT of this outfit whose body proportions are WRONG (too slim, too tall or too narrow). Keep the garments of the draft exactly (colors, patterns, accessories, shoes) but redraw them on the template's body with the correct proportions.${extra}`, BODY_LOCK, CRISP_STYLE, CONSISTENCY].join("\n\n");
}

// 圖片模型單價（美元／每 100 萬 tokens，以 gpt-image-1 的官方定價估算，只用來顯示「約」多少錢；實測 chatgpt-image-latest 標準品質一張約 US$0.10）
export const IMAGE_PRICE_PER_MILLION = { textInput: 5, imageInput: 10, output: 40 };
// 預設用 chatgpt-image-latest（跟 ChatGPT 網頁版同一條線，細節明顯比 gpt-image-1 精緻）；頁面會列出這把金鑰能用的所有圖片模型可以改選。
export const IMAGE_MODEL_DEFAULT = "chatgpt-image-latest";
export const IMAGE_SIZE = "1536x1024";
