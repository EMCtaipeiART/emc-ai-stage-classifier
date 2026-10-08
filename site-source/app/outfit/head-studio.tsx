"use client";

// 頭像生成器（2026-10-08）：跟服裝同一套流程——一次生成三組供選 → 挑一組 → 取名字完成；不滿意可再生成三組（同一件、扣再生成的點數）。
// 參考圖是遊戲現有五位人物的頭像（lib/head-reference.ts），規格見 lib/head-spec.ts 與 EMC-ART-Pixel-Office/docs/HEAD_SPEC.md。
// 完成的頭像存在「我的頭像」；目前還不會進元宇宙造型欄（遊戲要先支援自訂頭像）。
import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, Download, LoaderCircle, SlidersHorizontal, Sparkles, Trash2, TriangleAlert, Upload, UserRound, X } from "lucide-react";
import { analyzeHead } from "@/lib/head-check";
import { analyzeAccessory, componentViews, valleyViews } from "@/lib/accessory-check";
import { ACCESSORY_VIEWS } from "@/lib/accessory-spec";
import { HEADS, HEAD_EYE_Y, HEAD_NAMES } from "@/lib/outfit-heads";
import type { Check as QaCheck, ViewBox } from "@/lib/outfit-check";

type Wallet = { name: string; designer: boolean; admin: boolean; balance: number; spendPerGeneration: number; spendPerRegeneration: number };
type HeadItem = { id: string; name: string; status: string; description: string; attempts: number; updatedAt: string; kind: string; coverUrl: string; bodyUrl: string; game?: { headIndex?: number; fits?: ViewFit[] } | null };
type Bg = "check" | "light" | "dark";
const fmtCoin = (value: number) => (Math.round(value * 10) / 10).toLocaleString("zh-TW", { maximumFractionDigits: 1 });
type Kind = "head" | "cap" | "glasses";
// 三種素材共用同一套流程；差別在文字、角度數量、檢查方式與預設對位位置
const KINDS: Record<Kind, { label: string; views: number; examples: string[]; refLabel: string; descLabel: string; placeholder: string; rule: string; photoHint: string; qaNote: string; empty: string }> = {
  head: { label: "頭像", views: 3, examples: ["黑色長直髮、中分、淺膚色", "棕色波浪長髮、挑染金色髮尾", "黑色短髮、瀏海蓋額頭、小麥膚色", "栗色短捲髮、露出耳朵"], refLabel: "參考照片", descLabel: "髮型與臉部描述", placeholder: "例如：黑色及肩短髮、側分瀏海、淺膚色，戴小圓耳環。", rule: "只有頭、三個角度、透明背景", photoHint: "只會讀髮型與膚色等特徵，不會把照片本身送去畫圖", qaNote: "只能有頭（沒有脖子、身體、帽子、眼鏡）；背面不能有臉；三個角度的髮色與髮型要一致。", empty: "三視圖預覽" },
  cap: { label: "帽子", views: 3, examples: ["紅色棒球帽、白色字母", "黑色毛帽、反摺邊", "米色漁夫帽、寬帽簷", "格紋貝雷帽、深綠色"], refLabel: "帽子參考圖片", descLabel: "帽子描述", placeholder: "例如：深藍色棒球帽、前面一個白色小星星，帽簷微彎。", rule: "只有帽子、正面／側面（朝右）／背面、透明背景", photoHint: "只會讀帽子的款式與顏色，不會把照片本身送去畫圖", qaNote: "只能有帽子（沒有頭、頭髮、臉）；側面帽簷朝右；三個角度要是同一頂。", empty: "三視圖預覽" },
  glasses: { label: "眼鏡", views: 2, examples: ["圓框金屬細框眼鏡", "黑色粗框方形眼鏡", "茶色鏡片的貓眼墨鏡", "透明無框眼鏡"], refLabel: "眼鏡參考圖片", descLabel: "眼鏡描述", placeholder: "例如：黑色粗框圓形眼鏡，鏡片透明，鏡腳細一點。", rule: "只有眼鏡、正面／側面（朝右）、透明背景", photoHint: "只會讀眼鏡的款式與顏色，不會把照片本身送去畫圖", qaNote: "只能有眼鏡（沒有臉、眼睛、手）；側面鏡框在右、鏡腳往左；兩個角度要是同一副。", empty: "兩視圖預覽" },
};
const VIEW_NAMES = ["正面", "側面", "背面"];

const loadImage = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = () => reject(new Error("圖片載入失敗")); image.src = src; });
function removeWhiteBackground(image: HTMLImageElement) {
  const canvas = document.createElement("canvas"); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!; ctx.drawImage(image, 0, 0);
  const frame = ctx.getImageData(0, 0, canvas.width, canvas.height), { data, width, height } = frame;
  const near = (i: number) => data[i] > 236 && data[i + 1] > 236 && data[i + 2] > 236;
  const seen = new Uint8Array(width * height), stack: number[] = [];
  const push = (x: number, y: number) => { const k = y * width + x; if (!seen[k] && near(k * 4)) { seen[k] = 1; stack.push(k); } };
  for (let x = 0; x < width; x += 1) { push(x, 0); push(x, height - 1); }
  for (let y = 0; y < height; y += 1) { push(0, y); push(width - 1, y); }
  while (stack.length) { const k = stack.pop()!, x = k % width, y = (k - x) / width; data[k * 4 + 3] = 0; if (x > 0) push(x - 1, y); if (x < width - 1) push(x + 1, y); if (y > 0) push(x, y - 1); if (y < height - 1) push(x, y + 1); }
  ctx.putImageData(frame, 0, 0);
  return canvas.toDataURL("image/png");
}
function AuthImg({ url, token, alt }: { url: string; token: string; alt: string }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    let revoked = "", cancelled = false;
    fetch(url, { headers: token ? { "x-emc-editor-token": token } : {} }).then((r) => r.ok ? r.blob() : Promise.reject(new Error("img"))).then((blob) => { if (!cancelled) { revoked = URL.createObjectURL(blob); setSrc(revoked); } }).catch(() => undefined);
    return () => { cancelled = true; if (revoked) URL.revokeObjectURL(revoked); };
  }, [url, token]);
  return src ? <img src={src} alt={alt} loading="lazy" /> : null;
}

type ViewFit = { scale: number; dx: number; dy: number };
const OUT_SCALE = 2;   // 輸出是遊戲頭像格子的 2 倍大（遊戲原本的頭像是低解析，新頭像可以更細）

function cropView(source: HTMLImageElement, v: ViewBox) {
  const canvas = document.createElement("canvas"); canvas.width = v.x1 - v.x0; canvas.height = v.y1 - v.y0;
  canvas.getContext("2d")!.drawImage(source, v.x0, v.y0, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
  return canvas;
}
type Rect = { x: number; y: number; w: number; h: number; s?: [number, number, number, number] };
/** 輸出圖在原頭像格子外多留的邊（左、上、右、下，原格子像素）：帽子會超出頭頂、帽簷會伸出臉前面，要有空間放。頭像本身不需要。 */
function padFor(kind: Kind, base: Rect): [number, number, number, number] {
  if (kind === "head") return [0, 0, 0, 0];
  if (kind === "cap") return [Math.round(base.w * 0.35), Math.round(base.h * 0.6), Math.round(base.w * 0.5), Math.round(base.h * 0.15)];
  return [Math.round(base.w * 0.25), Math.round(base.h * 0.2), Math.round(base.w * 0.35), Math.round(base.h * 0.2)];
}
/** 這個素材在某個角度的預設位置與大小（原頭像格子座標；factor 是放大倍率）。頭像：縮進格子、底邊對齊；帽子：蓋在額頭上；眼鏡：對到眼睛的高度。 */
function placeItem(kind: Kind, view: number, headIndex: number, crop: HTMLCanvasElement, fit: ViewFit, factor: number) {
  const base = HEADS[headIndex][view] as Rect, front = HEADS[headIndex][0] as Rect, sk = base.s || front.s || [0, base.w, 0, base.h * 0.62];
  const skinW = sk[1] - sk[0], skinCx = (sk[0] + sk[1]) / 2, skinH = sk[3] - sk[2];
  const aspect = crop.height / crop.width;
  let w: number, cx: number, bottom: number;
  if (kind === "head") {
    const k = Math.min(base.w / crop.width, base.h / crop.height) * fit.scale;
    w = crop.width * k; cx = base.w / 2; bottom = base.h;
  } else if (kind === "cap") {
    w = (view === 0 ? skinW * 1.25 : view === 1 ? base.w * 0.95 : base.w * 0.8) * fit.scale; cx = view === 0 ? skinCx : base.w / 2; bottom = sk[2] + skinH * (view === 2 ? 0.55 : 0.32);
  } else {
    w = (view === 0 ? skinW * 0.95 : skinW * 0.8) * fit.scale; cx = skinCx;
    const eye = HEAD_EYE_Y[headIndex][view === 0 ? 0 : 1]; bottom = eye + (w * aspect) / 2;
  }
  const h = w * aspect;
  return { x: (cx - w / 2 + fit.dx) * factor, y: (bottom - h + fit.dy) * factor, w: w * factor, h: h * factor };
}
/** 輸出給遊戲的圖：每個角度一張透明 PNG，大小 = （原頭像格子 + 外圍留邊）× 2，素材已經依對位放好，遊戲只要蓋在原頭像的位置上。 */
function buildAssets(kind: Kind, crops: HTMLCanvasElement[], headIndex: number, fits: ViewFit[]) {
  const outputs = crops.map((crop, view) => {
    const base = HEADS[headIndex][view] as Rect, pad = padFor(kind, base), canvas = document.createElement("canvas");
    canvas.width = Math.round((base.w + pad[0] + pad[2]) * OUT_SCALE); canvas.height = Math.round((base.h + pad[1] + pad[3]) * OUT_SCALE);
    const ctx = canvas.getContext("2d")!; ctx.imageSmoothingQuality = "high";
    const p = placeItem(kind, view, headIndex, crop, fits[view], OUT_SCALE);
    ctx.drawImage(crop, pad[0] * OUT_SCALE + p.x, pad[1] * OUT_SCALE + p.y, p.w, p.h);
    return canvas;
  });
  // 眼鏡只有兩個角度：補一張 1×1 的透明圖，後端固定收三張
  if (outputs.length === 2) { const spare = document.createElement("canvas"); spare.width = 1; spare.height = 1; outputs.push(spare); }
  const shown = outputs.slice(0, crops.length), gap = 12, cover = document.createElement("canvas");
  cover.width = shown.reduce((sum, c) => sum + c.width, 0) + gap * (shown.length - 1); cover.height = Math.max(...shown.map((c) => c.height));
  let x = 0; const cctx = cover.getContext("2d")!;
  shown.forEach((c) => { cctx.drawImage(c, x, cover.height - c.height); x += c.width + gap; });
  return { views: outputs.map((c) => ({ w: c.width, h: c.height })), viewImages: outputs.map((c) => c.toDataURL("image/png")), cover: cover.toDataURL("image/png"), pads: crops.map((_, view) => padFor(kind, HEADS[headIndex][view] as Rect)) };
}

export default function HeadStudio({ kind, token, wallet, reloadWallet }: { kind: Kind; token: string; wallet: Wallet | null; reloadWallet: () => void }) {
  const K = KINDS[kind], viewCount = K.views, viewIndexes = Array.from({ length: viewCount }, (_, k) => k);
  const auth = (): Record<string, string> => token ? { "x-emc-editor-token": token } : {};
  const [description, setDescription] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState("");
  const [bg, setBg] = useState<Bg>("check");
  const [candidates, setCandidates] = useState<string[]>([]);
  const [pick, setPick] = useState(0);
  const [described, setDescribed] = useState("");
  const [job, setJob] = useState<{ id: string; attempts: number } | null>(null);
  const [qa, setQa] = useState<{ checks: QaCheck[]; views: ViewBox[]; ok: boolean } | null>(null);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState("");
  const [library, setLibrary] = useState<HeadItem[]>([]);
  // 對位：新頭像要放到原本那顆頭的位置（遊戲的眼鏡、帽子、耳機、服裝接點都是照原頭像量的），所以疊在原頭像上調整
  const [phase, setPhase] = useState<"make" | "fit">("make");
  const [crops, setCrops] = useState<HTMLCanvasElement[]>([]);
  const [fits, setFits] = useState<ViewFit[]>(viewIndexes.map(() => ({ scale: 1, dx: 0, dy: 0 })));
  const [fitTarget, setFitTarget] = useState<number>(3);
  const [showBase, setShowBase] = useState(true);
  const [headIndex, setHeadIndex] = useState(0);
  const [atlas, setAtlas] = useState<HTMLImageElement | null>(null);
  // 帽子、眼鏡對位用「你目前選用的頭像」（元宇宙造型裡選的自訂頭像；沒選就是原本的頭）
  const [headImgs, setHeadImgs] = useState<HTMLImageElement[] | null>(null);
  const [headLabel, setHeadLabel] = useState("原本的頭");
  const fitCanvas = useRef<HTMLCanvasElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const previews = useMemo(() => files.map((file) => ({ file, url: URL.createObjectURL(file) })), [files]);
  const image = candidates[pick] || "";
  const regenCost = wallet?.spendPerRegeneration ?? 50;
  const needsCoins = Boolean(wallet?.designer);
  const canGenerate = Boolean(token && wallet && (!needsCoins || wallet.balance >= wallet.spendPerGeneration) && (needsCoins || wallet.admin));
  const ownIndex = HEAD_NAMES.indexOf((wallet?.name || "") as (typeof HEAD_NAMES)[number]);
  const lockedHead = ownIndex >= 0;   // 設計師本人只能用自己的頭位置（自己做的頭像只有自己能用）
  const canRegenerate = Boolean(job && wallet && (!wallet.designer || wallet.balance >= regenCost));

  useEffect(() => { loadImage("/wardrobe-heads.webp").then(setAtlas).catch(() => undefined); }, []);
  useEffect(() => { if (ownIndex >= 0) setHeadIndex(ownIndex); }, [ownIndex]);
  useEffect(() => {
    setHeadImgs(null); setHeadLabel("原本的頭");
    if (kind === "head" || !wallet?.name) return;
    let cancelled = false;
    (async () => {
      try {
        const state = await fetch("/api/outfit/look", { headers: auth(), cache: "no-store" }).then((r) => r.json()) as { head?: string };
        const chosen = state.head || "";
        const id = /^h:([0-9a-f-]{36})$/.exec(chosen)?.[1];
        if (!id) return;
        const imgs = await Promise.all([0, 1, 2].map((view) => loadImage(`/api/public/outfits/${id}/${view}.png`)));
        if (cancelled) return;
        setHeadImgs(imgs);
        const list = await fetch("/api/public/outfits", { cache: "no-store" }).then((r) => r.json()) as { heads?: Array<{ id: string; name: string }> };
        if (!cancelled) setHeadLabel(`目前選用的頭像「${list.heads?.find((h) => h.id === id)?.name || "自訂頭像"}」`);
      } catch { /* 讀不到就用原本的頭 */ }
    })();
    return () => { cancelled = true; };
  }, [kind, wallet?.name, token]);
  const FIT_VIEW = 1.6;   // 對位畫面的放大倍率（原頭像格子 × 1.6）
  useEffect(() => {
    if (phase !== "fit" || !crops.length || !atlas || !fitCanvas.current) return;
    const gap = 24, F = FIT_VIEW, cells = viewIndexes.map((view) => HEADS[headIndex][view] as Rect), pads = cells.map((c) => padFor(kind, c));
    const widths = cells.map((c, k) => (c.w + pads[k][0] + pads[k][2]) * F), heights = cells.map((c, k) => (c.h + pads[k][1] + pads[k][3]) * F);
    const canvas = fitCanvas.current;
    canvas.width = Math.round(widths.reduce((sum, w) => sum + w, 0) + gap * (cells.length - 1)); canvas.height = Math.round(Math.max(...heights)) + 8;
    const ctx = canvas.getContext("2d")!; ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.imageSmoothingQuality = "high";
    let x = 0;
    cells.forEach((base, view) => {
      const pad = pads[view], oy = canvas.height - 4 - heights[view], hx = x + pad[0] * F, hy = oy + pad[1] * F;
      const p = placeItem(kind, view, headIndex, crops[view], fits[view], F);
      // 帽子與眼鏡：原頭像畫在下面（讓你看到戴上去的樣子），頭像：半透明疊在上面對位
      if (showBase && kind !== "head") { if (headImgs) ctx.drawImage(headImgs[view], hx, hy, base.w * F, base.h * F); else ctx.drawImage(atlas, base.x, base.y, base.w, base.h, hx, hy, base.w * F, base.h * F); }
      ctx.drawImage(crops[view], hx + p.x, hy + p.y, p.w, p.h);
      if (showBase) {
        ctx.save();
        if (kind === "head") { ctx.globalAlpha = 0.5; ctx.drawImage(atlas, base.x, base.y, base.w, base.h, hx, hy, base.w * F, base.h * F); }
        const sk = base.s || (HEADS[headIndex][0] as Rect).s;
        if (sk) { ctx.globalAlpha = 1; ctx.strokeStyle = "#e0393e"; ctx.setLineDash([5, 4]); ctx.lineWidth = 1.5; ctx.strokeRect(hx + sk[0] * F, hy + sk[2] * F, (sk[1] - sk[0]) * F, (sk[3] - sk[2]) * F); }
        ctx.restore();
      }
      x += widths[view] + gap;
    });
  }, [phase, crops, atlas, fits, headIndex, showBase, headImgs]);
  const setFitValue = (key: keyof ViewFit, value: number) => setFits((current) => current.map((f, view) => (fitTarget === 3 || fitTarget === view) ? { ...f, [key]: value } : f));
  const fitValue = (key: keyof ViewFit) => fits[fitTarget === 3 ? 0 : fitTarget][key];
  /** 依欄位空白切不出預期的角度數時（例如角度之間貼在一起），退回「平均切成幾欄、各自貼著輪廓裁」，還是可以進對位自己調。 */
  function equalSplit(data: ImageData, count: number): ViewBox[] {
    const out: ViewBox[] = [], colW = Math.floor(data.width / count);
    for (let k = 0; k < count; k += 1) {
      let x0 = data.width, x1 = 0, y0 = data.height, y1 = 0;
      for (let y = 0; y < data.height; y += 1) for (let x = k * colW; x < (k + 1) * colW; x += 1) if (data.data[(y * data.width + x) * 4 + 3] > 32) { x0 = Math.min(x0, x); x1 = Math.max(x1, x + 1); y0 = Math.min(y0, y); y1 = Math.max(y1, y + 1); }
      if (x1 > x0 && y1 > y0) out.push({ x0, y0, x1, y1 });
    }
    return out;
  }
  /** 進入對位：自己重新量一次這張圖（不依賴畫面上的檢查結果），量不準就平均切；initial 是之前存的對位（編輯舊的時用）。 */
  async function openFit(src: string, initial?: ViewFit[] | null, forHead?: number) {
    const img = await loadImage(src);
    const canvas = document.createElement("canvas"); canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!; ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let views = (kind === "head" ? analyzeHead(data) : analyzeAccessory(kind, data)).views;
    if (views.length !== viewCount) views = componentViews(data, viewCount);
    if (views.length !== viewCount) views = valleyViews(data, viewCount);
    if (views.length !== viewCount) views = equalSplit(data, viewCount);
    if (views.length !== viewCount) { setError("找不到完整的各個角度，請重新生成。"); return; }
    setCrops(views.map((v) => cropView(img, v)));
    setFits(initial && initial.length === viewCount ? initial : viewIndexes.map(() => ({ scale: 1, dx: 0, dy: 0 })));
    if (forHead !== undefined && !lockedHead) setHeadIndex(forHead);
    setFitTarget(3); setPhase("fit");
  }
  async function startFit() { if (image) await openFit(image); }
  /** 編輯之前完成的：用當初挑的那一組原圖重新進對位，帶回上次的位置與名稱；存檔時蓋掉原本的。 */
  async function editItem(item: HeadItem) {
    setError(""); setNote("");
    try {
      const blobUrl = await fetch(item.bodyUrl, { headers: auth() }).then((r) => r.ok ? r.blob() : Promise.reject(new Error("讀不到當初生成的圖片"))).then((blob) => URL.createObjectURL(blob));
      setCandidates([blobUrl]); setPick(0); setDescribed(""); setJob({ id: item.id, attempts: item.attempts }); setName(item.name || "");
      await openFit(blobUrl, item.game?.fits, item.game?.headIndex);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "無法開啟編輯"); }
  }
  useEffect(() => { if (!loading) return; const t = window.setInterval(() => setElapsed((n) => n + 1), 1000); return () => window.clearInterval(t); }, [loading]);
  async function loadLibrary() {
    if (!token) return;
    try {
      const response = await fetch("/api/outfit/items", { headers: auth() });
      const payload = await response.json() as { items?: HeadItem[] };
      setLibrary((payload.items || []).filter((item) => item.kind === kind));
    } catch { /* 下次再讀 */ }
  }
  useEffect(() => { void loadLibrary(); }, [token]);
  // 挑到哪一組就量哪一組
  useEffect(() => {
    setQa(null);
    if (!image) return;
    let cancelled = false;
    loadImage(image).then((img) => {
      if (cancelled) return;
      const canvas = document.createElement("canvas"); canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d", { willReadFrequently: true })!; ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
      setQa(kind === "head" ? analyzeHead(data) : analyzeAccessory(kind, data));
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [image]);

  function addFiles(list: FileList | File[]) {
    const accepted = Array.from(list).filter((file) => /^image\/(png|jpeg|webp)$/.test(file.type) && file.size <= 10 * 1024 * 1024);
    if (accepted.length < Array.from(list).length) setError("參考照只接受 10MB 內的 PNG、JPG、WebP。");
    setFiles((current) => [...current, ...accepted].slice(0, 2));
  }
  async function generate(itemId = "") {
    if (!itemId && !description.trim() && !files.length) { setError("請輸入髮型與臉部描述（關鍵字），或上傳一張參考照。"); return; }
    setLoading(true); setElapsed(0); setError(""); setNote("");
    try {
      const form = new FormData();
      form.set("kind", kind); form.set("description", description.trim());
      if (itemId) form.set("itemId", itemId);
      files.forEach((file) => form.append("images", file));
      const response = await fetch("/api/outfit", { method: "POST", headers: auth(), body: form });
      const raw = (await response.text()).trim();
      let payload: { error?: string; itemId?: string; attempt?: number; images?: string[]; described?: string; transparent?: boolean };
      try { payload = JSON.parse(raw); } catch { throw new Error(response.status === 413 ? "附件太大，請壓縮後再試。" : `伺服器回應異常（${response.status}）：${raw.slice(0, 80)}`); }
      if (!response.ok || payload.error || !payload.images?.length) throw new Error(payload.error || "生成失敗，請稍後再試。");
      const list = payload.transparent === false ? await Promise.all(payload.images.map(async (src) => removeWhiteBackground(await loadImage(src)))) : payload.images;
      setCandidates(list); setPick(0); setDescribed(payload.described || ""); setPhase("make"); setCrops([]);
      if (payload.itemId) setJob({ id: payload.itemId, attempts: payload.attempt || 1 });
      void loadLibrary();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "生成失敗，請稍後再試。"); }
    finally { setLoading(false); reloadWallet(); }
  }
  async function save() {
    if (!job || !image || !crops.length || !name.trim()) return;
    setSaving(true); setError("");
    try {
      const assets = buildAssets(kind, crops, headIndex, fits);
      const response = await fetch(`/api/outfit/items/${job.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json", ...auth() },
        body: JSON.stringify({ name: name.trim(), cover: assets.cover, headAssets: { headIndex, scale: OUT_SCALE, fits, pads: assets.pads, views: assets.views, viewImages: assets.viewImages }, ...(candidates.length > 1 ? { variant: pick } : {}), complete: true }),
      });
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "儲存失敗");
      setNote(`「${name.trim()}」已存進我的${K.label}，並發佈到元宇宙的造型欄`); setCandidates([]); setJob(null); setName(""); setDescribed(""); setPhase("make"); setCrops([]);
      await loadLibrary();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "儲存失敗"); }
    finally { setSaving(false); }
  }
  async function remove(item: HeadItem) {
    if (!confirm(`確定刪除${K.label}「${item.name || "（未命名）"}」？`)) return;
    await fetch(`/api/outfit/items/${item.id}`, { method: "DELETE", headers: auth() }).catch(() => undefined);
    await loadLibrary();
  }

  return <>
    <div className="workspace">
      <section className="control">
        <div className="section-head"><div className="preview-title"><span className="step">01</span><h2>設計你的{K.label}</h2></div></div>
        {wallet?.designer && <div className="wallet" style={{ marginBottom: 14 }}><div className="wallet-top"><div><span className="wallet-label">{wallet.name} 的平台幣</span><b className="wallet-balance">{fmtCoin(wallet.balance)}<small> 點</small></b></div><div className="wallet-rule">每次生成 {fmtCoin(wallet.spendPerGeneration)} 點（一次三組供選）<br />不滿意再生成三組 {fmtCoin(wallet.spendPerRegeneration)} 點</div></div>{wallet.balance < wallet.spendPerGeneration && <p className="wallet-warn">餘額不足 {fmtCoin(wallet.spendPerGeneration)} 點，還不能生成。</p>}</div>}
        <div className="field-label">{K.refLabel} <span>選填 · 最多 2 張</span></div>
        <button className="drop" onClick={() => fileInput.current?.click()} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files); }} disabled={loading}><span className="upload-icon"><Upload size={22} /></span><strong>拖曳照片到這裡</strong><span>或點擊上傳參考照</span><small>{K.photoHint} · PNG / JPG / WebP · 每張 10 MB 以內</small></button>
        <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={(e: ChangeEvent<HTMLInputElement>) => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }} />
        {previews.length > 0 && <div className="thumbs">{previews.map(({ file, url }, index) => <div key={file.name + index}><img src={url} alt={`參考照 ${index + 1}`} /><button onClick={() => setFiles(files.filter((_, i) => i !== index))} aria-label={`移除照片 ${index + 1}`} disabled={loading}><X size={13} /></button></div>)}</div>}
        <label className="field-label" htmlFor="head-description">{K.descLabel} <span>沒有照片也可以直接描述</span></label>
        <textarea id="head-description" value={description} maxLength={600} disabled={loading} placeholder={K.placeholder} onChange={(e) => setDescription(e.target.value)} />
        <div className="prompt-foot"><span>只上傳照片時，會先讀出特徵再生成。</span><span>{description.length}/600</span></div>
        <div className="presets">{K.examples.map((example) => <button key={example} onClick={() => setDescription(example)} disabled={loading}>{example.split("、").slice(0, 2).join("＋")}</button>)}</div>
        <div className="rules" style={{ marginTop: 18 }}><Check size={15} /><span>已套用固定規範：{K.rule}</span></div>
        <button className="generate" onClick={() => void generate()} disabled={loading || !canGenerate || (!description.trim() && !files.length)}>{loading ? <LoaderCircle size={19} className="spin" /> : <Sparkles size={19} />}<span>{loading ? `正在生成 · ${elapsed} 秒` : `生成新的${K.label}${wallet?.designer ? `（${fmtCoin(wallet.spendPerGeneration)} 點）` : ""}`}</span></button>
        <small className="cost">一次生成三組供選；使用 OpenAI 圖片模型，會產生 API 費用，每次生成都會記錄在生成紀錄。</small>
        {error && <div className="error" role="alert">{error}</div>}
        {note && <div className="described">{note}</div>}
      </section>
      <section className="preview">
        <div className="section-head"><div className="preview-title"><span className="step">02</span><h2>{image ? `你的新${K.label}` : K.empty}</h2></div><span className="badge">{image ? "生成結果" : "等待生成"}</span></div>
        {phase === "fit" && crops.length ? <div className="fit">
          <div className={`canvas fit-canvas ${bg}`}><canvas ref={fitCanvas} className="sheet" /></div>
          <div className="preview-bottom"><span>{kind === "head" ? "紅色虛線是原本那顆頭的臉部範圍，半透明的是原頭像：把新頭像的臉對到上面，下巴與耳朵的位置對齊，眼鏡、帽子、耳機才會戴對位置。" : kind === "cap" ? `這是${headLabel}戴上帽子的樣子（紅色虛線是臉部範圍）：調整帽子的位置與大小，帽簷要壓在額頭上、側面帽簷朝前。` : `這是${headLabel}戴上眼鏡的樣子（紅色虛線是臉部範圍）：調整眼鏡的位置與大小，鏡框要對在眼睛上、側面鏡腳要搭到耳朵。`}</span><div className="bg-controls" aria-label="預覽背景">{(["check", "light", "dark"] as Bg[]).map((x) => <button key={x} className={bg === x ? "active" : ""} onClick={() => setBg(x)} aria-label={`切換${x === "check" ? "棋盤格" : x === "light" ? "淺色" : "深色"}背景`} style={{ background: x === "dark" ? "#292b28" : x === "light" ? "#fff" : "#d7dcd2" }} />)}</div></div>
          <div className="fit-controls">
            <div className="fit-row"><span>對位的頭</span><div className="fit-own">{lockedHead ? `${HEAD_NAMES[headIndex]}（本人）· 自己做的${K.label}只有自己能用，所以固定對到自己的頭` : <select value={headIndex} onChange={(e) => setHeadIndex(Number(e.target.value))}>{HEAD_NAMES.map((n, k) => <option key={n} value={k}>{n}</option>)}</select>}</div></div>
            <div className="fit-row"><span>調整角度</span><div className="chips">{([["全部一起", 3], ...viewIndexes.map((view) => [VIEW_NAMES[view], view])] as Array<[string, number]>).map(([label, value]) => <button key={label} className={fitTarget === value ? "on" : ""} onClick={() => setFitTarget(value)}>{label}</button>)}</div></div>
            <div className="fit-row"><span>上下</span><div className="nudge wide"><button aria-label="往上 5" onClick={() => setFitValue("dy", fitValue("dy") - 5)}>︽</button><button aria-label="往上" onClick={() => setFitValue("dy", fitValue("dy") - 1)}><ArrowUp size={15} /></button><input type="range" min={-120} max={120} step={1} value={fitValue("dy")} onChange={(e) => setFitValue("dy", Number(e.target.value))} aria-label="上下" /><button aria-label="往下" onClick={() => setFitValue("dy", fitValue("dy") + 1)}><ArrowDown size={15} /></button><button aria-label="往下 5" onClick={() => setFitValue("dy", fitValue("dy") + 5)}>︾</button><output>{fitValue("dy")}</output></div></div>
            <div className="fit-row"><span>左右</span><div className="nudge wide"><button aria-label="往左 5" onClick={() => setFitValue("dx", fitValue("dx") - 5)}>《</button><button aria-label="往左" onClick={() => setFitValue("dx", fitValue("dx") - 1)}><ArrowLeft size={15} /></button><input type="range" min={-120} max={120} step={1} value={fitValue("dx")} onChange={(e) => setFitValue("dx", Number(e.target.value))} aria-label="左右" /><button aria-label="往右" onClick={() => setFitValue("dx", fitValue("dx") + 1)}><ArrowRight size={15} /></button><button aria-label="往右 5" onClick={() => setFitValue("dx", fitValue("dx") + 5)}>》</button><output>{fitValue("dx")}</output></div></div>
            <div className="fit-row"><span>大小</span><div className="nudge"><button aria-label="縮小" onClick={() => setFitValue("scale", Math.max(0.5, Math.round((fitValue("scale") - 0.01) * 100) / 100))}>－</button><input type="range" min={50} max={160} step={1} value={Math.round(fitValue("scale") * 100)} onChange={(e) => setFitValue("scale", Number(e.target.value) / 100)} aria-label="大小" /><button aria-label="放大" onClick={() => setFitValue("scale", Math.min(1.6, Math.round((fitValue("scale") + 0.01) * 100) / 100))}>＋</button><output>{Math.round(fitValue("scale") * 100)}%</output></div></div>
            <label className="fit-default"><input type="checkbox" checked={showBase} onChange={(e) => setShowBase(e.target.checked)} /> {kind === "head" ? "疊上原頭像與臉部範圍" : "顯示我的頭與臉部範圍"}</label>
            <button className="fit-reset" onClick={() => setFits(viewIndexes.map(() => ({ scale: 1, dx: 0, dy: 0 })))}>全部重設</button>
          </div>
          <div className="fit-save">
            <label className="field-label" htmlFor="head-name">{K.label}名稱 <span>最多 30 字</span></label>
            <input id="head-name" className="fit-name" type="text" maxLength={30} value={name} placeholder={kind === "head" ? "例如：短髮版" : kind === "cap" ? "例如：紅色棒球帽" : "例如：黑框圓眼鏡"} onChange={(e) => setName(e.target.value)} />
            <div className="fit-buttons"><button className="generate" disabled={saving || !name.trim()} onClick={() => void save()}>{saving ? <LoaderCircle size={18} className="spin" /> : <Check size={18} />}<span>完成{K.label}</span></button><button className="ghost" disabled={saving} onClick={() => setPhase("make")}>返回上一步</button></div>
          </div>
        </div> : <>
        {described && <p className="described"><b>AI 從照片讀到的特徵：</b>{described}<button onClick={() => { setDescription(described); setFiles([]); }}>用這段文字當描述（不再附照片）</button></p>}
        <div className={`canvas ${bg}`} aria-busy={loading}>
          <div className="view-labels" style={viewCount === 2 ? { gridTemplateColumns: "repeat(2,1fr)" } : undefined}><span>正面 <small>FRONT</small></span><span>側面 <small>SIDE →</small></span>{viewCount === 3 && <span>背面 <small>BACK</small></span>}</div>
          {image ? <img className="sheet" src={image} alt={`生成的${K.label}各角度`} /> : <div className="empty-note"><UserRound size={30} /><p>{loading ? "圖片模型正在畫各個角度…" : "完成左側設定後，各角度會顯示在這裡。"}</p></div>}
          {loading && <div className="loading"><LoaderCircle className="spin" size={32} /><strong>正在製作你的新{K.label}</strong><span>通常需要 20 秒到幾分鐘，請保持頁面開啟。</span></div>}
        </div>
        {candidates.length > 1 && <div className="cand-row" role="radiogroup" aria-label="三組供選">{candidates.map((src, k) => <button key={k} type="button" role="radio" aria-checked={pick === k} className={pick === k ? "on" : ""} disabled={loading} onClick={() => setPick(k)}><span className="cand-thumb"><img src={src} alt={`第 ${k + 1} 組`} /></span><span>第 {k + 1} 組</span></button>)}</div>}
        <div className="preview-bottom"><span>{image ? "透明 PNG · 請檢查各角度是不是同一個" : `生成時會依固定規範畫出${K.label}。`}</span><div className="bg-controls" aria-label="預覽背景">{(["check", "light", "dark"] as Bg[]).map((x) => <button key={x} className={bg === x ? "active" : ""} onClick={() => setBg(x)} aria-label={`切換${x === "check" ? "棋盤格" : x === "light" ? "淺色" : "深色"}背景`} style={{ background: x === "dark" ? "#292b28" : x === "light" ? "#fff" : "#d7dcd2" }} />)}</div></div>
        {image && <div className="download-row"><button disabled={loading} onClick={() => { const a = document.createElement("a"); a.href = image; a.download = `${kind}-sheet.png`; a.click(); }}><Download size={17} />下載完整 PNG</button></div>}
        {image && job && <div className="job-card"><div><b>這個{K.label} · 第 {job.attempts} 次生成</b><span>在上面三組裡點選一組，滿意就進入下一步對位；都不滿意可以再生成三組（仍是同一個，每次再扣 {fmtCoin(regenCost)} 點）。</span></div>
          <div className="job-actions"><button className="primary" disabled={loading} onClick={() => void startFit()}>下一步：對位 <ArrowRight size={15} /></button><button disabled={loading || !canRegenerate} onClick={() => void generate(job.id)}><Sparkles size={14} />再生成三組（再扣 {fmtCoin(regenCost)} 點）</button></div></div>}
        {image && qa && <div className="qa"><h3>規格檢查 <b className={qa.ok ? "ok" : "warn"}>{qa.ok ? "全部通過" : "有項目需要留意"}</b></h3>
          <ul>{qa.checks.map((check) => <li key={check.id} className={check.ok ? "ok" : "bad"}>{check.ok ? <Check size={14} /> : <TriangleAlert size={14} />}<span><strong>{check.label}</strong><small>{check.detail}</small></span></li>)}</ul>
          <p className="qa-note">這是依規格自動量的參考，最後仍請用眼睛看：{K.qaNote}</p></div>}
        </>}
      </section>
    </div>
    <section className="history">
      <div className="section-head"><div className="preview-title"><span className="step">03</span><h2>我的{K.label}</h2></div><button className="refresh" onClick={() => void loadLibrary()}>重新整理</button></div>
      <p className="history-total">完成的{K.label}會存在這裡，並自動出現在元宇宙人物工具欄的「造型」裡（只有你自己能用）。</p>
      {!library.length ? <p className="empty-note">還沒有{K.label}。生成一個並完成後，會出現在這裡。</p> : <div className="library">{library.map((item) => <article key={item.id} className={`lib-card ${item.status}`}>
        <div className="lib-thumb"><AuthImg url={item.coverUrl || item.bodyUrl} token={token} alt={item.name || K.label} /></div>
        <div className="lib-main"><div className="lib-title"><strong>{item.name || "（未命名）"}</strong><span className={`badge-status ${item.status}`}>{item.status === "completed" ? "已完成" : "製作中"}</span></div><small>{item.description || "—"}</small><small>生成 {item.attempts} 次</small></div>
        <div className="lib-actions"><button onClick={() => void editItem(item)}><SlidersHorizontal size={13} />編輯</button><button onClick={() => void remove(item)}><Trash2 size={13} />刪除</button></div>
      </article>)}</div>}
    </section>
  </>;
}
