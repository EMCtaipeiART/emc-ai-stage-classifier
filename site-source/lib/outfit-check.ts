// 生成完成後在瀏覽器裡自動量一次：三個角度有沒有分開、高度與腳底線一不一致、脖子寬度、褲襠位置。
// 規格數值與 EMC-ART-Pixel-Office/docs/OUTFIT_SPEC.md 同一份（OUTFIT_SPEC）。純函式，只吃像素陣列，方便測試。
import { OUTFIT_SPEC as SPEC } from "./outfit-spec";

export type Pixels = { data: Uint8ClampedArray | Uint8Array; width: number; height: number };
export type ViewBox = { x0: number; y0: number; x1: number; y1: number };
export type Check = { id: string; label: string; ok: boolean; detail: string };

/** 有透明背景就看透明度；整張都不透明（生成工具沒做出透明）就把接近純白當背景。 */
export function makeOpaqueTest(p: Pixels): (x: number, y: number) => boolean {
  let transparent = 0;
  const total = p.width * p.height;
  for (let i = 3; i < p.data.length; i += 4) if (p.data[i] < 128) transparent += 1;
  const hasAlpha = transparent / total > 0.01;
  return (x, y) => {
    const i = (y * p.width + x) * 4;
    if (p.data[i + 3] < 128) return false;
    return hasAlpha || !(p.data[i] > 238 && p.data[i + 1] > 238 && p.data[i + 2] > 238);
  };
}

function runsOf(flags: boolean[], minGap = 0) {
  const runs: Array<[number, number]> = [];
  let start = -1, lastOn = -1;
  flags.forEach((on, i) => {
    if (on) { if (start < 0) start = i; lastOn = i; }
    else if (start >= 0 && i - lastOn > minGap) { runs.push([start, lastOn + 1]); start = -1; }
  });
  if (start >= 0) runs.push([start, lastOn + 1]);
  return runs;
}

/** 依欄位的空白切出各個角度（正面、側面、背面由左到右）。 */
export function splitViews(p: Pixels, opaque = makeOpaqueTest(p)): ViewBox[] {
  const columns: boolean[] = [];
  for (let x = 0; x < p.width; x += 1) { let on = false; for (let y = 0; y < p.height && !on; y += 1) on = opaque(x, y); columns.push(on); }
  const gap = Math.max(4, Math.round(p.width * 0.015));
  let runs = runsOf(columns, gap).filter(([a, b]) => b - a > p.width * 0.06);
  // 超過 3 段（例如飄在旁邊的小配件）就取最寬的 3 段
  if (runs.length > 3) runs = [...runs].sort((a, b) => (b[1] - b[0]) - (a[1] - a[0])).slice(0, 3).sort((a, b) => a[0] - b[0]);
  return runs.map(([x0, x1]) => {
    let y0 = p.height, y1 = 0;
    for (let y = 0; y < p.height; y += 1) for (let x = x0; x < x1; x += 1) if (opaque(x, y)) { y0 = Math.min(y0, y); y1 = Math.max(y1, y + 1); break; }
    return { x0, y0, x1, y1 };
  });
}

function rowSpan(p: Pixels, opaque: (x: number, y: number) => boolean, v: ViewBox, y: number) {
  let min = -1, max = -1;
  for (let x = v.x0; x < v.x1; x += 1) if (opaque(x, y)) { if (min < 0) min = x; max = x + 1; }
  return min < 0 ? null : { min, max };
}

function rowRuns(p: Pixels, opaque: (x: number, y: number) => boolean, v: ViewBox, y: number) {
  const flags: boolean[] = [];
  for (let x = v.x0; x < v.x1; x += 1) flags.push(opaque(x, y));
  return runsOf(flags, 1).filter(([a, b]) => b - a >= 2);
}

const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
const within = (value: number, range: readonly [number, number]) => value >= range[0] && value <= range[1];

export function analyzeOutfit(p: Pixels): { views: ViewBox[]; checks: Check[]; ok: boolean } {
  const opaque = makeOpaqueTest(p);
  const views = splitViews(p, opaque);
  const checks: Check[] = [];
  const add = (id: string, label: string, ok: boolean, detail: string) => checks.push({ id, label, ok, detail });

  add("views", "三個角度分開", views.length === 3, views.length === 3 ? "找到 3 個角度" : `只找到 ${views.length} 個角度（應該是正面、側面、背面三個，彼此要有空白）`);
  if (views.length !== 3) return { views, checks, ok: false };

  const heights = views.map((v) => v.y1 - v.y0), widths = views.map((v) => v.x1 - v.x0);
  const meanH = heights.reduce((a, b) => a + b, 0) / 3;
  const heightSpread = (Math.max(...heights) - Math.min(...heights)) / meanH;
  add("height", "三個角度高度一致", heightSpread <= SPEC.heightTolerance, `高度差 ${pct(heightSpread)}（允許 ${pct(SPEC.heightTolerance)}）`);
  const bottoms = views.map((v) => v.y1), baselineSpread = (Math.max(...bottoms) - Math.min(...bottoms)) / meanH;
  add("baseline", "腳底在同一條線", baselineSpread <= SPEC.baselineTolerance, `腳底差 ${pct(baselineSpread)}（允許 ${pct(SPEC.baselineTolerance)}）`);

  const frontRatio = widths[0] / heights[0], sideRatio = widths[1] / heights[1], backRatio = widths[2] / heights[2];
  add("front-width", "正面寬度", within(frontRatio, SPEC.frontWidth), `寬 / 高 = ${pct(frontRatio)}（規格 ${pct(SPEC.frontWidth[0])}–${pct(SPEC.frontWidth[1])}）`);
  add("side-width", "側面寬度", within(sideRatio, SPEC.sideWidth), `寬 / 高 = ${pct(sideRatio)}（規格 ${pct(SPEC.sideWidth[0])}–${pct(SPEC.sideWidth[1])}）`);
  add("back-width", "背面與正面一致", Math.abs(widths[2] - widths[0]) / widths[0] <= 0.15, `背面 / 正面寬度 = ${pct(backRatio / frontRatio)}（應接近 100%）`);

  // 脖子：頸頂切口下面一點點的寬度。只看正面與背面（側面的頸頂是斜的，量不準）；連帽衫的帽子、領口會讓這個值偏大，所以範圍放寬。
  views.forEach((v, index) => {
    if (index === 1) return;
    const name = ["正面", "", "背面"][index], H = v.y1 - v.y0;
    const top = rowSpan(p, opaque, v, v.y0 + Math.max(2, Math.round(H * 0.015)));
    if (!top) return;
    const neck = (top.max - top.min) / H;
    add(`neck-${index}`, `${name}脖子寬度`, within(neck, SPEC.neckWidth), neck > SPEC.neckWidth[1] ? `頂端寬 ${pct(neck)}，偏寬，可能畫出了頭、頭髮或帽子，或脖子太粗` : `頂端寬 ${pct(neck)}（規格 ${pct(SPEC.neckWidth[0])}–${pct(SPEC.neckWidth[1])}）`);
    const center = (top.min + top.max) / 2, offset = Math.abs(center - (v.x0 + v.x1) / 2) / (v.x1 - v.x0);
    add(`neck-center-${index}`, `${name}脖子置中`, offset <= 0.06, `脖子偏離中心 ${pct(offset)}（允許 6.0%）`);
  });

  // 褲襠：正面中線（兩腿之間）從腳邊往上找，第一個被衣服擋住的位置。雙腿併攏、寬褲或裙裝找不到縫就略過。
  const front = views[0], H0 = front.y1 - front.y0, cx = Math.round((front.x0 + front.x1) / 2), band = Math.max(1, Math.round((front.x1 - front.x0) * 0.015));
  const centerOpaque = (y: number) => { for (let x = cx - band; x <= cx + band; x += 1) if (opaque(x, y)) return true; return false; };
  const startY = front.y0 + Math.round(H0 * 0.8);
  if (centerOpaque(startY)) add("crotch", "褲襠位置", true, "雙腿併攏或褲管很寬，略過這項");
  else {
    let y = startY;
    while (y > front.y0 && !centerOpaque(y)) y -= 1;
    const crotch = (y - front.y0) / H0;
    add("crotch", "褲襠位置（僅供參考）", true, `兩腿之間的縫約從身高的 ${pct(crotch)} 開始（規格的褲襠約 44–48%；寬褲、長外套的縫會比較低，請看圖確認）`);
  }

  return { views, checks, ok: checks.every((c) => c.ok) };
}

/** 每個角度的頸頂位置（頭要接在這裡）：頸頂是這個角度最高的點，取最上面幾列的中心。 */
export function detectNecks(p: Pixels, views: ViewBox[]): Array<{ x: number; y: number }> {
  const opaque = makeOpaqueTest(p);
  return views.map((v) => {
    const H = v.y1 - v.y0;
    const span = rowSpan(p, opaque, v, v.y0 + Math.max(2, Math.round(H * 0.015)));
    return { x: span ? (span.min + span.max) / 2 : (v.x0 + v.x1) / 2, y: v.y0 };
  });
}
