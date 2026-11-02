// 角色工坊的影像處理（瀏覽器端，用 canvas）：去背、切三視圖、量測、對位、規格化，以及最後烘焙 12 視角圖集。
// 圖集規格與 3D 辦公室（pixel-plaza/bake.html）相同：12 格橫排，每格正方形，人物高 HV、腳底離格底 6、水平以質心置中。

export type Canvas = HTMLCanvasElement;
export const mk = (w: number, h: number): Canvas => { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; };
export const ANGLES = 12;
export const SHEET_CELL = 640;            // 規格化三視圖每格邊長（送給 AI 的對位後版本）
export const SHEET_HEIGHT = 520;          // 人物高度（頭頂到腳底）
export const SHEET_FOOT = 40;             // 腳底離格底

export async function loadImg(src: string | Blob): Promise<HTMLImageElement> {
  const url = typeof src === "string" ? src : URL.createObjectURL(src);
  return await new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error("圖片讀取失敗")); img.src = url; });
}

/** 轉成帶透明的 canvas；若整張不透明（模型不支援透明背景），從四邊把和背景色接近的像素洗掉。 */
export function cutout(img: CanvasImageSource & { width: number; height: number }): Canvas {
  const c = mk(img.width, img.height), g = c.getContext("2d", { willReadFrequently: true })!;
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height), W = c.width, H = c.height, px = d.data;
  let transparent = 0;
  for (let i = 3; i < px.length; i += 4 * 97) if (px[i] < 250) transparent += 1;
  if (transparent < 20) {
    const bg = [px[0], px[1], px[2]], near = (p: number) => Math.abs(px[p * 4] - bg[0]) + Math.abs(px[p * 4 + 1] - bg[1]) + Math.abs(px[p * 4 + 2] - bg[2]) < 54;
    const seen = new Uint8Array(W * H), stack: number[] = [];
    for (let x = 0; x < W; x += 1) { stack.push(x, (H - 1) * W + x); }
    for (let y = 0; y < H; y += 1) { stack.push(y * W, y * W + W - 1); }
    while (stack.length) {
      const p = stack.pop()!; if (seen[p] || !near(p)) continue; seen[p] = 1; px[p * 4 + 3] = 0;
      const x = p % W, y = (p / W) | 0;
      if (x > 0) stack.push(p - 1); if (x < W - 1) stack.push(p + 1); if (y > 0) stack.push(p - W); if (y < H - 1) stack.push(p + W);
    }
    g.putImageData(d, 0, 0);
  }
  return c;
}

/** 只留面積夠大的連通區（去掉生成圖的雜點），門檻 3%。 */
export function clean(src: Canvas, flipX = false): Canvas {
  const c = mk(src.width, src.height), g = c.getContext("2d", { willReadFrequently: true })!;
  if (flipX) { g.translate(c.width, 0); g.scale(-1, 1); }
  g.drawImage(src, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height), W = c.width, H = c.height, lab = new Int32Array(W * H), sizes = [0];
  for (let s = 0; s < W * H; s += 1) {
    if (lab[s] || d.data[s * 4 + 3] < 100) continue;
    const id = sizes.length; let n = 0; const st = [s]; lab[s] = id;
    while (st.length) {
      const p = st.pop()!; n += 1; const x = p % W, y = (p / W) | 0;
      for (const q of [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, y > 0 ? p - W : -1, y < H - 1 ? p + W : -1]) if (q >= 0 && !lab[q] && d.data[q * 4 + 3] >= 100) { lab[q] = id; st.push(q); }
    }
    sizes.push(n);
  }
  const max = Math.max(...sizes);
  for (let p = 0; p < W * H; p += 1) if (!lab[p] || sizes[lab[p]] < max * 0.03) d.data[p * 4 + 3] = 0;
  g.putImageData(d, 0, 0);
  return c;
}

export type Measure = { x0: number; x1: number; y0: number; y1: number; w: number; h: number; cx: number; headCx: number; bodyCx: number; headW: number };
/** 量一個人物：外框、質心、頭（上 30%）與身體（下 50%）各自的水平中心、頭部寬度。 */
export function measure(c: Canvas): Measure | null {
  const g = c.getContext("2d", { willReadFrequently: true })!, d = g.getImageData(0, 0, c.width, c.height).data;
  let x0 = c.width, x1 = 0, y0 = c.height, y1 = 0, sx = 0, n = 0;
  for (let y = 0; y < c.height; y += 1) for (let x = 0; x < c.width; x += 1) if (d[(y * c.width + x) * 4 + 3] > 100) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; sx += x; n += 1; }
  if (!n) return null;
  const h = y1 - y0 + 1;
  const band = (from: number, to: number) => {
    let sum = 0, cnt = 0, lo = c.width, hi = 0;
    for (let y = Math.floor(y0 + h * from); y < Math.floor(y0 + h * to); y += 1) for (let x = x0; x <= x1; x += 1) if (d[(y * c.width + x) * 4 + 3] > 100) { sum += x; cnt += 1; if (x < lo) lo = x; if (x > hi) hi = x; }
    return { cx: cnt ? sum / cnt : (x0 + x1) / 2, w: cnt ? hi - lo + 1 : 0 };
  };
  const head = band(0, 0.3), body = band(0.5, 1);
  return { x0, x1, y0, y1, w: x1 - x0 + 1, h, cx: sx / n, headCx: head.cx, bodyCx: body.cx, headW: head.w };
}

/** 把「三個人排一排」的圖切成三張。用欄位上有沒有像素找縫；找不到三塊就平分。 */
export function splitViews(c: Canvas, n = 3): Canvas[] {
  const g = c.getContext("2d", { willReadFrequently: true })!, d = g.getImageData(0, 0, c.width, c.height).data;
  const col = new Uint32Array(c.width);
  for (let y = 0; y < c.height; y += 1) for (let x = 0; x < c.width; x += 1) if (d[(y * c.width + x) * 4 + 3] > 100) col[x] += 1;
  const runs: Array<[number, number]> = [];
  let start = -1;
  for (let x = 0; x <= c.width; x += 1) {
    const on = x < c.width && col[x] > 2;
    if (on && start < 0) start = x; else if (!on && start >= 0) { runs.push([start, x - 1]); start = -1; }
  }
  // 縫小於 1.5% 寬度的視為同一塊（手臂與身體之間的空隙），再取最寬的三塊
  const merged: Array<[number, number]> = [];
  for (const r of runs) { const last = merged[merged.length - 1]; if (last && r[0] - last[1] < c.width * 0.015) last[1] = r[1]; else merged.push([r[0], r[1]]); }
  const top3 = merged.length >= n ? [...merged].sort((a, b) => (b[1] - b[0]) - (a[1] - a[0])).slice(0, n).sort((a, b) => a[0] - b[0]) : null;
  const cuts = top3 ? top3.map((r, i) => [i === 0 ? 0 : Math.floor((top3[i - 1][1] + r[0]) / 2), i === n - 1 ? c.width : Math.floor((r[1] + top3[i + 1][0]) / 2)]) : Array.from({ length: n }, (_, i) => [c.width * i / n, c.width * (i + 1) / n]);
  return cuts.map(([a, b]) => { const out = mk(Math.max(1, Math.round(b - a)), c.height); out.getContext("2d")!.drawImage(c, Math.round(a), 0, out.width, c.height, 0, 0, out.width, c.height); return out; });
}

export type Adjust = { scale: number; dx: number; dy: number };
export const noAdjust = (): Adjust => ({ scale: 1, dx: 0, dy: 0 });

/** 規格化：高度統一、質心水平置中、腳底貼齊，畫進 cell×cell。adj 是使用者在對位畫面的微調（倍率、位移，單位是格子邊長的比例）。 */
export function placeCell(src: Canvas, m: Measure, cell: number, hv: number, foot: number, adj: Adjust = noAdjust()): Canvas {
  const s = (hv / m.h) * adj.scale, out = mk(cell, cell), g = out.getContext("2d")!;
  g.imageSmoothingQuality = "high";
  g.drawImage(src, 0, 0, src.width, src.height, cell / 2 - m.cx * s + adj.dx * cell, cell - foot - hv - m.y0 * s + adj.dy * cell, src.width * s, src.height * s);
  return out;
}

export type Diagnosis = { warnings: string[]; ok: boolean };
/** 自動判對：三個視圖的高度、置中、頭與身體是否在同一條中線上。標準是占人物高度的比例。 */
export function diagnose(ms: Array<Measure | null>): Diagnosis {
  const warnings: string[] = [];
  if (ms.some((m) => !m)) return { warnings: ["有視圖是空白的，請重新生成。"], ok: false };
  const list = ms as Measure[], names = ["正面", "側面", "背面"];
  const hs = list.map((m) => m.h), spread = (Math.max(...hs) - Math.min(...hs)) / Math.max(...hs);
  if (spread > 0.06) warnings.push(`三張圖高度差 ${(spread * 100).toFixed(0)}%（已自動縮放到同高，但差太多可能是畫風或比例不一致）`);
  list.forEach((m, i) => {
    const off = Math.abs(m.headCx - m.bodyCx) / m.h;
    if (i !== 1 && off > 0.04) warnings.push(`${names[i]}：頭和身體中線差 ${(off * 100).toFixed(0)}%，頭可能歪了`);
    if (i === 1 && off > 0.14) warnings.push("側面：頭和身體前後差距偏大");
  });
  const hw = list.map((m) => m.headW / m.h);
  if (Math.max(hw[0], hw[2]) / Math.max(0.01, Math.min(hw[0], hw[2])) > 1.35) warnings.push("正面與背面的頭寬差很多（髮型或帽子畫得不一致）");
  const front = list[0], side = list[1];
  if (side.headW / Math.max(1, front.headW) < 0.55 || side.headW / Math.max(1, front.headW) > 1.5) warnings.push("側面頭部大小和正面差太多");
  return { warnings, ok: warnings.length === 0 };
}

/** 把 12 張框好的人物（任意大小）烘焙成圖集：每格 cell 邊長，人物高 hv（cell=240 時 224）、腳底離底 6。 */
export function bakeAtlas(frames: Canvas[], cell: number): Canvas {
  const hv = Math.round(cell * 224 / 240), out = mk(cell * ANGLES, cell), g = out.getContext("2d")!;
  g.imageSmoothingQuality = "high";
  frames.forEach((frame, k) => {
    const m = measure(frame);
    if (!m) return;
    const tile = placeCell(frame, m, cell, hv, Math.round(cell * 6 / 240));
    g.drawImage(tile, k * cell, 0);
  });
  return out;
}

export const toBlob = (c: Canvas) => new Promise<Blob>((resolve, reject) => c.toBlob((b) => b ? resolve(b) : reject(new Error("輸出失敗")), "image/png"));

/** 頭像快照：正面格上方的頭與肩膀，裁成正方形。 */
export function avatarOf(frontCell: Canvas, size = 160): string {
  const m = measure(frontCell)!, side = Math.round(m.h * 0.9), out = mk(size, size), g = out.getContext("2d")!;
  g.imageSmoothingQuality = "high";
  g.drawImage(frontCell, Math.round(m.cx - side / 2), m.y0 - Math.round(side * 0.08), side, side, 0, 0, size, size);
  return out.toDataURL("image/png");
}

/** 12 個角度對應的 canvas：0 正面、90 側面（朝右）、180 背面、270 側面鏡像，其餘用 AI 生成的。 */
export function assembleFrames(sheetCells: Canvas[], ai: Record<number, Canvas | undefined>): Array<Canvas | null> {
  const mirror = (c: Canvas) => { const o = mk(c.width, c.height), g = o.getContext("2d")!; g.translate(o.width, 0); g.scale(-1, 1); g.drawImage(c, 0, 0); return o; };
  return Array.from({ length: ANGLES }, (_, k) => {
    const deg = k * 30;
    if (deg === 0) return sheetCells[0];
    if (deg === 90) return sheetCells[1];
    if (deg === 180) return sheetCells[2];
    if (deg === 270) return mirror(sheetCells[1]);
    return ai[deg] || null;
  });
}

/** 8 角度合圖（4 欄 × 2 排）切成 8 張，順序：30、60、120、150、210、240、300、330。 */
export function splitGrid(c: Canvas): Canvas[] {
  const half = Math.floor(c.height / 2), out: Canvas[] = [];
  for (const [y, h] of [[0, half], [half, c.height - half]]) {
    const row = mk(c.width, h); row.getContext("2d")!.drawImage(c, 0, y, c.width, h, 0, 0, c.width, h);
    out.push(...splitViews(row, 4));
  }
  return out;
}
