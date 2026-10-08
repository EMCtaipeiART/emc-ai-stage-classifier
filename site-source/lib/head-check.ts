// 頭像生成完成後在瀏覽器裡自動量一次：三個角度有沒有分開、高度與底線一不一致、寬高比、有沒有貼到邊。
// 規格數值同 head-spec.ts（HEAD_SPEC）。純函式，只吃像素陣列。
import { makeOpaqueTest, splitViews, type Check, type Pixels, type ViewBox } from "./outfit-check";
import { HEAD_SPEC as SPEC } from "./head-spec";

const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
const within = (value: number, range: readonly [number, number]) => value >= range[0] && value <= range[1];

export function analyzeHead(p: Pixels): { views: ViewBox[]; checks: Check[]; ok: boolean } {
  const opaque = makeOpaqueTest(p);
  const views = splitViews(p, opaque);
  const checks: Check[] = [];
  const add = (id: string, label: string, ok: boolean, detail: string) => checks.push({ id, label, ok, detail });
  add("views", "三個角度分開", views.length === 3, views.length === 3 ? "找到 3 個角度" : `只找到 ${views.length} 個角度（應該是正面、側面、背面三個，彼此要有空白）`);
  if (views.length !== 3) return { views, checks, ok: false };

  const heights = views.map((v) => v.y1 - v.y0), widths = views.map((v) => v.x1 - v.x0);
  const meanH = heights.reduce((a, b) => a + b, 0) / 3;
  const spread = (Math.max(...heights) - Math.min(...heights)) / meanH;
  add("height", "三個角度高度一致", spread <= SPEC.heightTolerance, `高度差 ${pct(spread)}（允許 ${pct(SPEC.heightTolerance)}）`);
  const frontRatio = widths[0] / heights[0], sideRatio = widths[1] / heights[1];
  add("front-ratio", "正面寬高比", within(frontRatio, SPEC.frontRatio), `寬 / 高 = ${pct(frontRatio)}（規格 ${pct(SPEC.frontRatio[0])}–${pct(SPEC.frontRatio[1])}）`);
  add("side-ratio", "側面寬高比", within(sideRatio, SPEC.sideRatio), `寬 / 高 = ${pct(sideRatio)}（規格 ${pct(SPEC.sideRatio[0])}–${pct(SPEC.sideRatio[1])}）`);
  add("back-width", "背面與正面一致", Math.abs(widths[2] - widths[0]) / widths[0] <= SPEC.backVsFront, `背面 / 正面寬度 = ${pct(widths[2] / widths[0])}（應接近 100%）`);
  const marginX = p.width * SPEC.edgeMargin, marginY = p.height * SPEC.edgeMargin;
  const touching = views.some((v) => v.x0 < marginX || v.x1 > p.width - marginX || v.y0 < marginY || v.y1 > p.height - marginY);
  add("margin", "沒有貼到畫面邊緣", !touching, touching ? "有角度貼到或超出畫面邊緣，可能被裁掉，建議重新生成" : "四邊都有留白");
  return { views, checks, ok: checks.every((c) => c.ok) };
}
