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

const CONSISTENCY = `All three views must show the SAME outfit consistently (same colors, graphics, lengths, pocket positions). The back view must show a plausible back of the garment (the back of the neck is skin colored; do not draw the front neckline on the back). Keep clothing graphics simple and bold, never tiny details. The three views stay the same height with the soles of the shoes on the same baseline. Fully transparent background (if transparency is impossible, use a flat pure white background and never use pure white inside the clothes or shoes). No text, watermark, grid lines, labels or color swatches.`;

/** 組出送給 OpenAI 的提示詞。hasPhoto：使用者另外附了服裝參考圖（第二張起）。 */
export function buildOutfitPrompt(description: string, hasPhoto: boolean) {
  const outfit = description.trim() || "(no text description - copy the outfit from the attached photo)";
  const source = hasPhoto
    ? `NEW OUTFIT: the clothing shown in the additional attached image(s) after the template. Reproduce that clothing (colors, garment types, graphics) on the template figures. Extra notes from the user: ${outfit}`
    : `NEW OUTFIT: ${outfit}`;
  return [TEMPLATE_RULES, source, CONSISTENCY].join("\n\n");
}

// 圖片模型單價（美元／每 100 萬 tokens，以 gpt-image-1 的官方定價估算，只用來顯示「約」多少錢；實測 chatgpt-image-latest 標準品質一張約 US$0.10）
export const IMAGE_PRICE_PER_MILLION = { textInput: 5, imageInput: 10, output: 40 };
// 預設用 chatgpt-image-latest（跟 ChatGPT 網頁版同一條線，細節明顯比 gpt-image-1 精緻）；頁面會列出這把金鑰能用的所有圖片模型可以改選。
export const IMAGE_MODEL_DEFAULT = "chatgpt-image-latest";
export const IMAGE_SIZE = "1536x1024";
