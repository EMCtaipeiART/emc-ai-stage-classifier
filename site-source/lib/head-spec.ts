// 頭像生成器的提示詞與規格數值。數值是從遊戲現有五位人物的頭像量出來的（public/wardrobe-heads.webp，每人正面／朝右側面／背面）：
// 長髮：寬×高約 117–141 × 124–135；短髮：約 105–114 × 80–85。兩邊要一致：改規格時連同 EMC-ART-Pixel-Office/docs/HEAD_SPEC.md 一起改。

export const HEAD_SPEC = {
  heightTolerance: 0.1,          // 三個角度的高度誤差（長髮側面、背面的髮尾長度會不一樣，所以比服裝寬鬆）
  frontRatio: [0.95, 1.45],      // 正面 寬／高（長髮約 1.0–1.1，短髮約 1.3）
  sideRatio: [0.8, 1.4],         // 側面 寬／高
  backVsFront: 0.2,              // 背面寬度與正面的差距上限
  edgeMargin: 0.02,              // 離畫布邊緣至少留的比例
} as const;

const SHEET_RULES = `The FIRST attached image is a STYLE AND PROPORTION REFERENCE: a sheet of five existing chibi game-character HEADS, each shown as three views (front, side facing right, back) on a light gray background. Draw ONE NEW head in exactly the same art style, with the same construction and proportions, as those five.

Layout: ONE ROW with THREE views side by side in this order: FRONT, SIDE facing RIGHT, BACK. The three heads are large, fill the width of the canvas evenly, are the same size, sit on the same bottom line (the chin line / bottom of the head), with clear empty space between the views. Transparent background.

HEAD ONLY - THIS IS THE MOST IMPORTANT RULE: draw only the head and its hair. NO neck, NO body, NO shoulders, NO clothing, NO hat, NO glasses, NO headphones (the game adds accessories itself). The bottom of the face is the chin; long hair may hang down below the chin exactly like in the reference, but nothing else may.`;

const FACE_RULES = `FACE AND STYLE (copy the reference): a cute chibi face - large round black eyes with one small white highlight each, soft pink blush on both cheeks, thin simple eyebrows, a tiny nose dot and a small simple smile; skin color a warm peach (#F8B888). Hair is drawn in 2-3 flat tones with a few lighter strand lines, never fine individual hairs. Short hair shows the ears; long hair may cover them. The SIDE view is an exact profile facing RIGHT (one eye, nose and ear visible). The BACK view shows only hair (and the ears if the hair is short) - NO face. The FRONT view is perfectly frontal and symmetrical.`;

const CRISP_STYLE = `RENDERING QUALITY: crisp, clean, high-resolution cel-shaded game-art illustration with a EXTREMELY THICK, heavy, bold, smooth, dark warm-black (#302828) outline of even thickness (about 6% of the head height - a very chunky sticker-like outline, twice as thick as a normal bold cartoon outline) around the whole head and hair, flat cel-shading with one soft shadow tone, light from the upper left. No gradients, no noise, no glow, no watercolor texture, no painterly blur, no cast shadow on the ground.`;

const FRAMING = `FRAMING: leave at least 8% of the canvas height as empty margin above the tops of the heads and below the bottoms, and at least 3% of the width at the left and right edges. Every head must be COMPLETE with nothing touching or cropped by the canvas edge. All three views must show the SAME head consistently (same hair color, length, parting, face and any hair accessories) at the same size.`;

/** 組出送給 OpenAI 的提示詞。hasPhoto：使用者另外附了參考照（第二張起，已改成先轉成文字，所以通常是 false）。 */
export function buildHeadPrompt(description: string, hasPhoto: boolean) {
  const head = description.trim() || "(no text description - copy the hair and face traits from the attached photo)";
  const source = hasPhoto
    ? `NEW HEAD: the person in the additional attached image(s). Redraw their hair (color, length, style), skin tone, glasses-free face shape and notable face traits as this cartoon head. Extra notes from the user: ${head}`
    : `NEW HEAD: ${head}`;
  return [SHEET_RULES, source, FACE_RULES, FRAMING, CRISP_STYLE].join("\n\n");
}

export const DESCRIBE_HEAD_INSTRUCTIONS = `You look at photos of a person and write a compact description of ONLY the hair and the general head features, for a game-art illustrator who will redraw a flat chibi cartoon head.
Rules: describe hair color (plain color words, any highlights or ombre), length, parting and style (straight, wavy, curly, bangs, ponytail, bun), facial hair if any, skin tone (light, medium, tan, dark), face shape in a few words, and hair accessories. Do NOT describe glasses, hats, clothing, the background or the photo, and never name or identify the person.
Maximum 60 words, one line, English, comma-separated.`;
