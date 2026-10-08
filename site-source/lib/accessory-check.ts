// 帽子／眼鏡生成完成後在瀏覽器裡自動量一次：角度分開、高度一致、寬高比、沒貼邊。純函式。
import { makeOpaqueTest, splitViews, type Check, type Pixels, type ViewBox } from "./outfit-check";
import { ACCESSORY_SPEC as SPEC, ACCESSORY_VIEWS, type AccessoryKind } from "./accessory-spec";

const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
const within = (value: number, range: readonly [number, number]) => value >= range[0] && value <= range[1];

/**
 * 把圖裡「連在一起的一塊一塊」找出來，取面積最大的 count 塊當作各個角度（由左到右）。
 * 模型畫的三個角度常常不是平均排開，帽簷會伸到隔壁角度的位置、欄位空白切不開；用連通區域就不怕。
 * 先縮小圖來標記（快），再膨脹幾格把輪廓內的細縫、鉚釘之類的小斷開接起來，最後回到原圖貼著輪廓量框。
 */
export function componentViews(p: Pixels, count: number): ViewBox[] {
  const opaque = makeOpaqueTest(p), f = Math.max(1, Math.floor(Math.max(p.width, p.height) / 500));
  const w = Math.ceil(p.width / f), h = Math.ceil(p.height / f), mask = new Uint8Array(w * h);
  for (let y = 0; y < p.height; y += f) for (let x = 0; x < p.width; x += f) {
    let on = false;
    for (let dy = 0; dy < f && !on; dy += 1) for (let dx = 0; dx < f && !on; dx += 1) if (x + dx < p.width && y + dy < p.height && opaque(x + dx, y + dy)) on = true;
    if (on) mask[(y / f) * w + x / f] = 1;
  }
  const grown = new Uint8Array(w * h), R = 3;
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) if (mask[y * w + x]) for (let dy = -R; dy <= R; dy += 1) for (let dx = -R; dx <= R; dx += 1) { const nx = x + dx, ny = y + dy; if (nx >= 0 && ny >= 0 && nx < w && ny < h) grown[ny * w + nx] = 1; }
  const label = new Int32Array(w * h), comps: Array<{ area: number; x0: number; y0: number; x1: number; y1: number }> = [];
  for (let start = 0; start < w * h; start += 1) {
    if (!grown[start] || label[start]) continue;
    const id = comps.length + 1, stack = [start], c = { area: 0, x0: w, y0: h, x1: 0, y1: 0 };
    label[start] = id;
    while (stack.length) {
      const k = stack.pop()!, x = k % w, y = (k - x) / w;
      if (mask[k]) c.area += 1;
      c.x0 = Math.min(c.x0, x); c.x1 = Math.max(c.x1, x + 1); c.y0 = Math.min(c.y0, y); c.y1 = Math.max(c.y1, y + 1);
      if (x > 0 && grown[k - 1] && !label[k - 1]) { label[k - 1] = id; stack.push(k - 1); }
      if (x < w - 1 && grown[k + 1] && !label[k + 1]) { label[k + 1] = id; stack.push(k + 1); }
      if (y > 0 && grown[k - w] && !label[k - w]) { label[k - w] = id; stack.push(k - w); }
      if (y < h - 1 && grown[k + w] && !label[k + w]) { label[k + w] = id; stack.push(k + w); }
    }
    comps.push(c);
  }
  const top = comps.sort((a, b) => b.area - a.area).slice(0, count).sort((a, b) => a.x0 - b.x0);
  return top.map((c) => {
    // 回到原圖：在這個框內貼著輪廓重新量（框是縮小圖的，往外多看一格）
    const X0 = Math.max(0, c.x0 * f - f), X1 = Math.min(p.width, c.x1 * f + f), Y0 = Math.max(0, c.y0 * f - f), Y1 = Math.min(p.height, c.y1 * f + f);
    let x0 = p.width, y0 = p.height, x1 = 0, y1 = 0;
    for (let y = Y0; y < Y1; y += 1) for (let x = X0; x < X1; x += 1) if (opaque(x, y)) { x0 = Math.min(x0, x); x1 = Math.max(x1, x + 1); y0 = Math.min(y0, y); y1 = Math.max(y1, y + 1); }
    return { x0, y0, x1, y1 };
  }).filter((v) => v.x1 > v.x0 && v.y1 > v.y0);
}

/**
 * 角度之間真的碰在一起、連通區域分不開時：先量整張圖的外框，平均預估各角度的邊界，再在每個邊界附近（±20%）
 * 找「同一欄不透明點最少」的那一欄下刀——比硬切平均寬度更不容易切到帽簷、鏡腳。
 */
export function valleyViews(p: Pixels, count: number): ViewBox[] {
  const opaque = makeOpaqueTest(p), cols: number[] = [];
  let left = p.width, right = 0;
  for (let x = 0; x < p.width; x += 1) { let n = 0; for (let y = 0; y < p.height; y += 1) if (opaque(x, y)) n += 1; cols.push(n); if (n) { left = Math.min(left, x); right = Math.max(right, x + 1); } }
  if (right <= left) return [];
  const part = (right - left) / count, cuts = [left];
  for (let k = 1; k < count; k += 1) {
    const mid = left + part * k, from = Math.max(cuts[cuts.length - 1] + 2, Math.floor(mid - part * 0.2)), to = Math.min(right - 2, Math.ceil(mid + part * 0.2));
    let best = Math.round(mid), bestN = Infinity;
    for (let x = from; x <= to; x += 1) { const n = (cols[x - 1] ?? 0) + cols[x] + (cols[x + 1] ?? 0); if (n < bestN) { bestN = n; best = x; } }
    cuts.push(best);
  }
  cuts.push(right);
  const views: ViewBox[] = [];
  for (let k = 0; k < count; k += 1) {
    let x0 = p.width, y0 = p.height, x1 = 0, y1 = 0;
    for (let y = 0; y < p.height; y += 1) for (let x = cuts[k]; x < cuts[k + 1]; x += 1) if (opaque(x, y)) { x0 = Math.min(x0, x); x1 = Math.max(x1, x + 1); y0 = Math.min(y0, y); y1 = Math.max(y1, y + 1); }
    if (x1 > x0 && y1 > y0) views.push({ x0, y0, x1, y1 });
  }
  return views;
}

export function analyzeAccessory(kind: AccessoryKind, p: Pixels): { views: ViewBox[]; checks: Check[]; ok: boolean } {
  const opaque = makeOpaqueTest(p), expected = ACCESSORY_VIEWS[kind];
  // 先用「連在一起的一塊」找各個角度（不怕帽簷伸到隔壁）；找不到預期的數量才退回欄位空白切法
  let views = componentViews(p, expected);
  if (views.length !== expected) views = valleyViews(p, expected);
  if (views.length !== expected) { views = splitViews(p, opaque); if (views.length > expected) views = [...views].sort((a, b) => (b.x1 - b.x0) - (a.x1 - a.x0)).slice(0, expected).sort((a, b) => a.x0 - b.x0); }
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
