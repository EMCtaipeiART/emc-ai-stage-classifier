// 帽子／眼鏡生成完成後在瀏覽器裡自動量一次：角度分開、高度一致、寬高比、沒貼邊。純函式。
import { makeOpaqueTest, splitViews, type Check, type Pixels, type ViewBox } from "./outfit-check";
import { ACCESSORY_SPEC as SPEC, ACCESSORY_VIEWS, type AccessoryKind } from "./accessory-spec";

const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
const within = (value: number, range: readonly [number, number]) => value >= range[0] && value <= range[1];

export function analyzeAccessory(kind: AccessoryKind, p: Pixels): { views: ViewBox[]; checks: Check[]; ok: boolean } {
  const opaque = makeOpaqueTest(p), expected = ACCESSORY_VIEWS[kind];
  let views = splitViews(p, opaque);
  // splitViews 最多取 3 段；眼鏡只要 2 段：多出來的當作雜訊取最寬的 2 段
  if (views.length > expected) views = [...views].sort((a, b) => (b.x1 - b.x0) - (a.x1 - a.x0)).slice(0, expected).sort((a, b) => a.x0 - b.x0);
  const checks: Check[] = [];
  const add = (id: string, label: string, ok: boolean, detail: string) => checks.push({ id, label, ok, detail });
  add("views", `${expected} 個角度分開`, views.length === expected, views.length === expected ? `找到 ${expected} 個角度` : `只找到 ${views.length} 個角度（應該是${kind === "cap" ? "正面、側面、背面三個" : "正面、側面兩個"}，彼此要有空白）`);
  if (views.length !== expected) return { views, checks, ok: false };
  const heights = views.map((v) => v.y1 - v.y0), widths = views.map((v) => v.x1 - v.x0);
  const meanH = heights.reduce((a, b) => a + b, 0) / expected;
  const spread = (Math.max(...heights) - Math.min(...heights)) / meanH;
  add("height", "各角度高度一致", spread <= SPEC.heightTolerance, `高度差 ${pct(spread)}（允許 ${pct(SPEC.heightTolerance)}）`);
  const ranges = kind === "cap" ? [SPEC.capFrontRatio, SPEC.capSideRatio, SPEC.capBackRatio] : [SPEC.glassesFrontRatio, SPEC.glassesSideRatio];
  const names = ["正面", "側面", "背面"];
  views.forEach((_, index) => { const ratio = widths[index] / heights[index]; add(`ratio-${index}`, `${names[index]}寬高比`, within(ratio, ranges[index]), `寬 / 高 = ${pct(ratio)}（規格 ${pct(ranges[index][0])}–${pct(ranges[index][1])}）`); });
  const mx = p.width * SPEC.edgeMargin, my = p.height * SPEC.edgeMargin;
  const touching = views.some((v) => v.x0 < mx || v.x1 > p.width - mx || v.y0 < my || v.y1 > p.height - my);
  add("margin", "沒有貼到畫面邊緣", !touching, touching ? "有角度貼到或超出畫面邊緣，可能被裁掉，建議重新生成" : "四邊都有留白");
  return { views, checks, ok: checks.every((c) => c.ok) };
}
