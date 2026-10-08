// 帽子與眼鏡生成器的提示詞與規格數值。數值是從遊戲現有的兩頂帽子與兩副眼鏡量出來的（wardrobe-acc.webp）：
// 帽子：正面 208×149、側面 250×147、背面 198×148；眼鏡：正面 194×63、側面 178×65。
// 改規格時連同 EMC-ART-Pixel-Office/docs/ACCESSORY_SPEC.md 一起改。
export type AccessoryKind = "cap" | "glasses";
export const ACCESSORY_VIEWS: Record<AccessoryKind, number> = { cap: 3, glasses: 2 };

export const ACCESSORY_SPEC = {
  heightTolerance: 0.18,
  capFrontRatio: [1.1, 1.9],     // 正面 寬／高（現有 1.40）
  capSideRatio: [1.2, 2.3],      // 側面（現有 1.70，帽簷朝右）
  capBackRatio: [1.1, 1.9],      // 背面（現有 1.34）
  glassesFrontRatio: [2.2, 4.2], // 正面（現有 3.08–2.94）
  glassesSideRatio: [1.8, 3.8],  // 側面（現有 2.74–2.63，鏡腳往左、鏡框在右）
  edgeMargin: 0.02,
} as const;

const OUTLINE = `RENDERING QUALITY: crisp, clean, high-resolution cel-shaded game-art illustration with a bold, smooth, dark warm-black (#302828) outline of even thickness, flat cel-shading with one soft shadow tone, light from the upper left. No gradients, no noise, no glow, no watercolor texture, no cast shadow. Transparent background.`;

const CAP_RULES = `The FIRST attached image is a STYLE AND PROPORTION REFERENCE: a sheet of two existing game baseball caps (one black, one blue), each shown as three views (front, side facing right with the brim pointing RIGHT, back) on a light gray background. Draw ONE NEW hat in exactly the same art style, with the same construction and proportions, as those caps (it may be a different kind of hat, for example a beanie, bucket hat or beret, but it must be drawn in this same chunky cartoon style and sized to sit on the same chibi head).

Layout: ONE ROW with THREE views side by side in this order: FRONT, SIDE facing RIGHT (brim or front pointing to the right), BACK. The three views are large, about the same height, sit on the same bottom line, with clear empty space between them. Transparent background.

THE HAT ALONE: draw only the hat, as if it were floating - NO head, NO hair, NO face, NO person, NO mannequin. The inside of the hat is not shown. The FRONT view is perfectly frontal and symmetrical; the BACK view shows the back of the hat (with its strap or closure if it has one).`;

const GLASSES_RULES = `The FIRST attached image is a STYLE AND PROPORTION REFERENCE: a sheet of two existing game glasses (clear black-framed glasses and sunglasses), each shown as two views (front and side facing right) on a light gray background. Draw ONE NEW pair of glasses in exactly the same art style, with the same construction and proportions, as those (it may be a different shape, for example round, cat-eye or rimless, but drawn in this same chunky cartoon style).

Layout: ONE ROW with TWO views side by side in this order: FRONT, SIDE facing RIGHT (the lens frame on the right, the temple arm extending to the left). Both views are large, about the same height, sit on the same bottom line, with clear empty space between them. Transparent background.

THE GLASSES ALONE: draw only the glasses, as if floating - NO face, NO eyes, NO head, NO person, NO hands. Lenses are either clear (transparent with a few white highlight marks) or tinted - follow the description. The FRONT view is perfectly frontal and symmetrical, the SIDE view is an exact profile.`;

const FRAMING = `FRAMING: leave at least 8% of the canvas height as empty margin above and below the items, and at least 3% of the width at the left and right edges. Every item must be COMPLETE with nothing touching or cropped by the canvas edge. All views must show the SAME item consistently (same colors, shape, graphics, thickness).`;

export function buildAccessoryPrompt(kind: AccessoryKind, description: string, hasPhoto: boolean) {
  const label = kind === "cap" ? "HAT" : "GLASSES";
  const text = description.trim() || `(no text description - copy the ${label.toLowerCase()} from the attached photo)`;
  const source = hasPhoto
    ? `NEW ${label}: the ${label.toLowerCase()} shown in the additional attached image(s). Reproduce its colors, shape and graphics. Extra notes from the user: ${text}`
    : `NEW ${label}: ${text}`;
  return [kind === "cap" ? CAP_RULES : GLASSES_RULES, source, FRAMING, OUTLINE].join("\n\n");
}

export const describeAccessoryInstructions = (kind: AccessoryKind) => `You look at photos of ${kind === "cap" ? "a hat or cap" : "a pair of glasses or sunglasses"} and write a compact description of ONLY that item, for a game-art illustrator who will redraw it as a flat cartoon.
Rules: give the type and shape, the main colors (plain color words), the material or pattern in one or two simple words, and notable details (logo, strap, rim thickness, lens tint). Do NOT describe any person, face, hair, background or the photo itself.
Maximum 50 words, one line, English, comma-separated.`;
