"use client";

import { ChangeEvent, DragEvent, useEffect, useMemo, useRef, useState } from "react";
import "./studio.css";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ArrowUpRight, Check, Download, LoaderCircle, LogOut, Pencil, Shirt, SlidersHorizontal, Sparkles, Star, Trash2, TriangleAlert, Upload, X } from "lucide-react";
import { analyzeOutfit, detectNecks, splitViews, type Check as QaCheck, type ViewBox } from "@/lib/outfit-check";
import { BODY_REF_HEIGHT, chinOf, defaultHeadFit, HEAD_FEMALE, HEAD_K, HEAD_NAMES, HEAD_OVERLAP, HEADS, type HeadFit } from "@/lib/outfit-heads";
import { formatTwd, formatUsd } from "@/lib/pricing";

type Quality = string;
type HistoryRecord = { id: string; createdAt: string; userId: string; status: string; model: string; quality: string; description: string; described: string; photoCount: number; seconds: number; usage: { input: number; output: number; total: number; costUsd: number }; transparent: boolean; error: string; imageUrl: string; variants?: number };
// D1 的 CURRENT_TIMESTAMP 是不帶時區的 UTC 字串
const formatTime = (value: string) => new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(value) ? value : `${value.replace(" ", "T")}Z`).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" });
const userLabel = (id: string) => id === "team-password" ? "團隊密碼" : id === "local-user" ? "本機" : id;
type Generated = { id: string; candidates: string[]; pick: number; described?: string; transparent?: boolean; image: string; model: string; quality: Quality; seconds: number; usage: { input: number; output: number; total: number; costUsd: number }; label: string };

const EXAMPLES = ["紅色棒球外套、白 T、黑色工作褲、白色厚底球鞋", "橘色連帽衫、淺色寬牛仔褲、黑色高筒帆布鞋", "灰色針織背心、白襯衫、卡其長褲、棕色短靴"];
type Bg = "check" | "light" | "dark";
type FitView = { x0: number; y0: number; x1: number; y1: number; neckX: number; neckY: number };
type Item = { id: string; name: string; status: "draft" | "completed"; isDefault: boolean; description: string; attempts: number; head: HeadFit | null; views: FitView[] | null; createdAt: string; updatedAt: string; completedAt: string | null; coverUrl: string; bodyUrl: string; published: boolean };
type FitBody = { img: HTMLImageElement; views: FitView[] };
const loadImageSrc = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = () => reject(new Error("圖片載入失敗")); image.src = src; });

/** 把頭像套到三個角度上。每個角度各自縮到「身體高 targetH」、頭用同一個換算（遊戲圖集身體高 168）接在頸頂，
 *  再依各自的寬度（含頭髮）左右排開、留間距——三個角度不會互相疊在一起。
 *  女生正面與側面頭髮在衣服後面、其餘頭在衣服上面（跟遊戲一樣）。
 *  畫面預覽用接近遊戲裡的大小（頭像本來就是低解析的遊戲素材，放太大才會顯得糊）；存檔用 336（跟發佈給遊戲的圖一樣）。 */
function composeFit(body: FitBody, headsImg: HTMLImageElement, fit: HeadFit, targetH = 220): HTMLCanvasElement {
  const u = targetH / BODY_REF_HEIGHT, K = HEAD_K * fit.scale, gap = Math.round(targetH * 0.12), margin = Math.round(targetH * 0.06);
  const parts = body.views.map((view, index) => {
    const f = targetH / (view.y1 - view.y0), bw = (view.x1 - view.x0) * f, rect = HEADS[fit.headIndex][index], chin = chinOf(fit.headIndex, index as 0 | 1 | 2);
    const nx = (view.neckX - view.x0) * f, hs = K * u;
    const hx = nx - chin.x * hs + fit.dx[index] * u, hy = HEAD_OVERLAP * u - chin.y * hs + fit.dy[index] * u, hw = rect.w * hs, hh = rect.h * hs;
    return { view, index, f, bw, rect, hx, hy, hw, hh, minX: Math.min(0, hx), maxX: Math.max(bw, hx + hw), minY: Math.min(0, hy), maxY: Math.max(targetH, hy + hh) };
  });
  const offY = margin + Math.max(0, ...parts.map((p) => -p.minY));
  const width = Math.ceil(margin * 2 + gap * (parts.length - 1) + parts.reduce((sum, p) => sum + (p.maxX - p.minX), 0));
  const height = Math.ceil(offY + Math.max(...parts.map((p) => p.maxY)) + margin);
  const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext("2d")!; ctx.imageSmoothingQuality = "high";
  let cursor = margin;
  parts.forEach((p) => {
    const ox = cursor - p.minX, oy = offY;
    const drawBody = () => ctx.drawImage(body.img, p.view.x0, p.view.y0, p.view.x1 - p.view.x0, p.view.y1 - p.view.y0, ox, oy, p.bw, targetH);
    const drawHead = () => ctx.drawImage(headsImg, p.rect.x, p.rect.y, p.rect.w, p.rect.h, ox + p.hx, oy + p.hy, p.hw, p.hh);
    if (HEAD_FEMALE[fit.headIndex] && p.index < 2) { drawHead(); drawBody(); } else { drawBody(); drawHead(); }
    cursor += p.maxX - p.minX + gap;
  });
  return canvas;
}
/** 模型沒給透明背景的圖（白底）先去背，才能疊頭。 */
function transparentCopy(image: HTMLImageElement): HTMLImageElement | Promise<HTMLImageElement> {
  const probe = document.createElement("canvas"); probe.width = image.naturalWidth; probe.height = image.naturalHeight;
  const ctx = probe.getContext("2d", { willReadFrequently: true })!; ctx.drawImage(image, 0, 0);
  if (ctx.getImageData(0, 0, 1, 1).data[3] < 250 || ctx.getImageData(image.naturalWidth - 1, 0, 1, 1).data[3] < 250) return image;
  return loadImageSrc(removeWhiteBackground(image));
}
/** 發佈給 Pixel Office：三個角度各裁成「身體高 336」的透明圖（遊戲圖集身體高 168 的兩倍），加上尺寸與頸頂位置。 */
function buildGameAssets(body: FitBody, fit: HeadFit) {
  const viewImages: string[] = [], views: Array<{ w: number; h: number; n: number }> = [];
  body.views.forEach((v) => {
    const f = (BODY_REF_HEIGHT * 2) / (v.y1 - v.y0), w = Math.round((v.x1 - v.x0) * f), h = Math.round((v.y1 - v.y0) * f);
    const canvas = document.createElement("canvas"); canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d")!; ctx.imageSmoothingQuality = "high";
    ctx.drawImage(body.img, v.x0, v.y0, v.x1 - v.x0, v.y1 - v.y0, 0, 0, w, h);
    viewImages.push(canvas.toDataURL("image/png")); views.push({ w, h, n: Math.round((v.neckX - v.x0) * f * 10) / 10 });
  });
  return { game: { views, head: fit }, viewImages };
}
async function prepareBody(src: string): Promise<FitBody> {
  const img = await transparentCopy(await loadImageSrc(src));
  const canvas = document.createElement("canvas"); canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!; ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const pixels = { data: data.data, width: data.width, height: data.height };
  const views = splitViews(pixels);
  if (views.length !== 3) throw new Error("沒辦法分出三個角度，無法套上大頭；請重新生成。");
  const necks = detectNecks(pixels, views);
  return { img, views: views.map((v, i) => ({ ...v, neckX: necks[i].x, neckY: necks[i].y })) };
}
type WalletEntry = { seq: number; at: string; kind: string; label: string; amount: number; counterparty: string; memo: string; ref: string };
type Wallet = { name: string; designer: boolean; admin: boolean; balance: number; spendPerGeneration: number; spendPerRegeneration: number; startDate: string; recent: WalletEntry[]; directory: string[] };
const TOKEN_KEY = "emcEditorToken";
const fmtCoin = (value: number) => (Math.round(value * 10) / 10).toLocaleString("zh-TW", { maximumFractionDigits: 1 });
/** 圖片要帶登入 token 才拿得到（<img> 不能帶標頭），所以用 fetch 取回再顯示。 */
function AuthImage({ url, token, alt }: { url: string; token: string; alt: string }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    let revoked = "";
    let cancelled = false;
    fetch(url, { headers: token ? { "x-emc-editor-token": token } : {} }).then((response) => response.ok ? response.blob() : Promise.reject(new Error("img"))).then((blob) => { if (!cancelled) { revoked = URL.createObjectURL(blob); setSrc(revoked); } }).catch(() => undefined);
    return () => { cancelled = true; if (revoked) URL.revokeObjectURL(revoked); };
  }, [url, token]);
  return src ? <img src={src} alt={alt} loading="lazy" /> : null;
}
// 規格化輸出：每個角度放進 400×392 的格子，身體高 336（參考圖 168 的兩倍），腳底落在格子下緣上方 28 px
const CELL = { w: 400, h: 392, body: 336, baseline: 364 };

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = () => reject(new Error("圖片載入失敗")); image.src = src; });
}
/** 模型沒給透明背景時，把從邊緣連起來的接近純白去掉（衣服裡的白色不會被連到）。 */
function removeWhiteBackground(image: HTMLImageElement) {
  const canvas = document.createElement("canvas"); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!; ctx.drawImage(image, 0, 0);
  const frame = ctx.getImageData(0, 0, canvas.width, canvas.height), { data, width, height } = frame;
  const near = (i: number) => data[i] > 236 && data[i + 1] > 236 && data[i + 2] > 236;
  const seen = new Uint8Array(width * height), stack: number[] = [];
  const push = (x: number, y: number) => { const k = y * width + x; if (!seen[k] && near(k * 4)) { seen[k] = 1; stack.push(k); } };
  for (let x = 0; x < width; x += 1) { push(x, 0); push(x, height - 1); }
  for (let y = 0; y < height; y += 1) { push(0, y); push(width - 1, y); }
  while (stack.length) {
    const k = stack.pop()!, x = k % width, y = (k - x) / width;
    data[k * 4 + 3] = 0;
    if (x > 0) push(x - 1, y); if (x < width - 1) push(x + 1, y); if (y > 0) push(x, y - 1); if (y < height - 1) push(x, y + 1);
  }
  ctx.putImageData(frame, 0, 0);
  return canvas.toDataURL("image/png");
}
function download(url: string, name: string) { const a = document.createElement("a"); a.href = url; a.download = name; a.click(); }
function cropCanvas(source: HTMLImageElement, box: ViewBox, pad = 4) {
  const canvas = document.createElement("canvas");
  canvas.width = box.x1 - box.x0 + pad * 2; canvas.height = box.y1 - box.y0 + pad * 2;
  canvas.getContext("2d")!.drawImage(source, box.x0 - pad, box.y0 - pad, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
  return canvas;
}
/** 三個角度用同一個縮放（以三張的平均高度為準），腳底對齊，排成一列標準格式。 */
function normalizedSheet(source: HTMLImageElement, views: ViewBox[]) {
  const meanHeight = views.reduce((sum, v) => sum + (v.y1 - v.y0), 0) / views.length, scale = CELL.body / meanHeight;
  const canvas = document.createElement("canvas"); canvas.width = CELL.w * views.length; canvas.height = CELL.h;
  const ctx = canvas.getContext("2d")!; ctx.imageSmoothingQuality = "high";
  views.forEach((v, index) => {
    const w = (v.x1 - v.x0) * scale, h = (v.y1 - v.y0) * scale;
    ctx.drawImage(source, v.x0, v.y0, v.x1 - v.x0, v.y1 - v.y0, index * CELL.w + (CELL.w - w) / 2, CELL.baseline - h, w, h);
  });
  return canvas;
}

export default function OutfitPage() {
  const [description, setDescription] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState("");
  const [items, setItems] = useState<Generated[]>([]);
  const [activeId, setActiveId] = useState("");
  const [bg, setBg] = useState<Bg>("check");
  const [token, setToken] = useState("");
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [walletError, setWalletError] = useState("");
  const [transfer, setTransfer] = useState({ to: "", amount: "", memo: "" });
  const [transferBusy, setTransferBusy] = useState(false);
  const [transferMessage, setTransferMessage] = useState("");
  const [records, setRecords] = useState<HistoryRecord[]>([]);
  const [totals, setTotals] = useState({ runs: 0, ok: 0, tokens: 0, costUsd: 0 });
  const [historyError, setHistoryError] = useState("");
  const [qa, setQa] = useState<{ checks: QaCheck[]; views: ViewBox[]; ok: boolean } | null>(null);
  // 製作單：生成 →（不滿意可重新生成，每次 100 點）→ 套上大頭微調 → 完成（可設為預設）→ 之後可編輯、刪除
  const [job, setJob] = useState<{ id: string; attempts: number; status: "draft" | "completed" } | null>(null);
  const [phase, setPhase] = useState<"make" | "fit">("make");
  const [library, setLibrary] = useState<Item[]>([]);
  const [libraryNote, setLibraryNote] = useState("");
  const [fitBody, setFitBody] = useState<FitBody | null>(null);
  const [fit, setFit] = useState<HeadFit>(defaultHeadFit(0));
  const [fitTarget, setFitTarget] = useState<0 | 1 | 2 | 3>(3);
  const [fitName, setFitName] = useState("");
  const [fitDefault, setFitDefault] = useState(false);
  const [fitBusy, setFitBusy] = useState(false);
  const [fitZoom, setFitZoom] = useState(1);
  const [headsImg, setHeadsImg] = useState<HTMLImageElement | null>(null);
  const fitCanvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => { loadImageSrc("/wardrobe-heads.webp").then(setHeadsImg).catch(() => undefined); }, []);
  // 預覽：每次調整都重畫（畫在畫面上的 canvas，縮到適合的寬度）
  useEffect(() => {
    if (phase !== "fit" || !fitBody || !headsImg || !fitCanvas.current) return;
    const composed = composeFit(fitBody, headsImg, fit, Math.round(220 * fitZoom)), target = fitCanvas.current;
    target.width = composed.width; target.height = composed.height;
    target.getContext("2d")!.drawImage(composed, 0, 0);
  }, [phase, fitBody, headsImg, fit, fitZoom]);
  const fileInput = useRef<HTMLInputElement>(null);
  const previews = useMemo(() => files.map((file) => ({ file, url: URL.createObjectURL(file) })), [files]);
  const active = items.find((item) => item.id === activeId) || null;

  // 登入：設計需求系統把 token 放在網址的 #t=…（# 後面的內容不會送到伺服器），這裡收下來存在這個分頁、立刻從網址拿掉。
  useEffect(() => {
    let value = "";
    try {
      const match = location.hash.match(/[#&]t=([^&]+)/);
      if (match) { value = decodeURIComponent(match[1]); sessionStorage.setItem(TOKEN_KEY, value); history.replaceState(null, "", location.pathname + location.search); }
      else value = sessionStorage.getItem(TOKEN_KEY) || "";
    } catch { /* 瀏覽器不讓用 sessionStorage 就當作沒登入 */ }
    setToken(value);
  }, []);
  const authHeaders = (): Record<string, string> => token ? { "x-emc-editor-token": token } : {};
  async function loadWallet() {
    if (!token) { setWallet(null); return; }
    try {
      const response = await fetch("/api/outfit/wallet", { headers: authHeaders() });
      const payload = await response.json() as Wallet & { error?: string };
      if (!response.ok) throw new Error(payload.error || "讀取平台幣失敗");
      setWallet(payload); setWalletError("");
    } catch (cause) { setWallet(null); setWalletError(cause instanceof Error ? cause.message : "讀取平台幣失敗"); }
  }
  useEffect(() => { void loadWallet(); void loadHistory(); }, [token]);
  async function submitTransfer() {
    if (transferBusy) return;
    setTransferBusy(true); setTransferMessage("");
    try {
      const response = await fetch("/api/outfit/wallet/transfer", { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(transfer) });
      const payload = await response.json() as { error?: string; amount?: number; to?: string; balance?: number };
      if (!response.ok) throw new Error(payload.error || "轉讓失敗");
      setTransferMessage(`已轉給 ${payload.to}：${fmtCoin(payload.amount || 0)} 點，目前餘額 ${fmtCoin(payload.balance || 0)} 點`);
      setTransfer({ to: transfer.to, amount: "", memo: "" });
      void loadWallet();
    } catch (cause) { setTransferMessage(cause instanceof Error ? cause.message : "轉讓失敗"); }
    finally { setTransferBusy(false); }
  }

  async function loadHistory() {
    try {
      const response = await fetch("/api/outfit/history", { headers: authHeaders() });
      const payload = await response.json() as { items?: HistoryRecord[]; totals?: typeof totals; error?: string };
      if (!response.ok) throw new Error(payload.error || "讀取紀錄失敗");
      setRecords(payload.items || []); setTotals(payload.totals || { runs: 0, ok: 0, tokens: 0, costUsd: 0 }); setHistoryError("");
    } catch (cause) { setHistoryError(cause instanceof Error ? cause.message : "讀取紀錄失敗"); }
  }
  function openRecord(record: HistoryRecord) {
    if (!record.imageUrl) return;
    void (async () => {
      const count = Math.max(1, record.variants || 1);
      const urls: string[] = [];
      for (let k = 0; k < count; k += 1) {
        const blobUrl = await fetch(`${record.imageUrl}${record.imageUrl.includes("?") ? "&" : "?"}v=${k}`, { headers: authHeaders() }).then((response) => response.ok ? response.blob() : Promise.reject(new Error("img"))).then((blob) => URL.createObjectURL(blob)).catch(() => "");
        if (blobUrl) urls.push(blobUrl);
      }
      if (!urls.length) { setError("讀取這張圖片失敗"); return; }
      const item: Generated = { id: record.id, candidates: urls, pick: 0, image: urls[0], model: record.model, quality: record.quality, seconds: record.seconds, usage: record.usage, label: record.description.slice(0, 24) || "照片生成", described: record.described };
      setItems((current) => [item, ...current.filter((existing) => existing.id !== record.id)].slice(0, 8)); setActiveId(record.id);
      window.scrollTo({ top: 0, behavior: "smooth" });
    })();
  }



  useEffect(() => {
    if (!loading) return;
    const started = Date.now();
    const timer = setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 500);
    return () => clearInterval(timer);
  }, [loading]);

  // 換一張圖就重新量一次
  useEffect(() => {
    if (!active) { setQa(null); return; }
    let cancelled = false;
    loadImage(active.image).then((image) => {
      const canvas = document.createElement("canvas"); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
      const ctx = canvas.getContext("2d", { willReadFrequently: true })!; ctx.drawImage(image, 0, 0);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
      if (!cancelled) setQa(analyzeOutfit({ data: data.data, width: data.width, height: data.height }));
    }).catch(() => { if (!cancelled) setQa(null); });
    return () => { cancelled = true; };
  }, [active]);

  function addFiles(list: FileList | File[]) {
    const incoming = Array.from(list).filter((file) => /^image\/(png|jpeg|webp)$/.test(file.type) && file.size <= 10 * 1024 * 1024);
    setFiles((current) => [...current, ...incoming].slice(0, 2));
  }
  function onDrop(event: DragEvent<HTMLElement>) { event.preventDefault(); addFiles(event.dataTransfer.files); }

  async function generate(refit = false, itemId = "") {
    if (!refit && !itemId && !description.trim() && !files.length) { setError("請輸入服裝描述（關鍵字），或上傳一張服裝參考圖。"); return; }
    setLoading(true); setElapsed(0); setError("");
    try {
      const form = new FormData();
      form.set("description", description.trim() || (itemId ? library.find((entry) => entry.id === itemId)?.description || "" : "")); 
      if (itemId) form.set("itemId", itemId);
      if (refit && active) {
        // 把目前這張當成「衣服」，要求重新套到標準身體上
        form.set("mode", "refit");
        form.append("images", await (await fetch(active.image, { headers: active.image.startsWith("/api/") ? authHeaders() : {} })).blob(), "draft.png");
      } else files.forEach((file) => form.append("images", file));
      const response = await fetch("/api/outfit", { method: "POST", headers: authHeaders(), body: form });
      const raw = (await response.text()).trim();
      let payload: { error?: string; itemId?: string; attempt?: number; images?: string[]; described?: string; transparent?: boolean; model?: string; quality?: Quality; seconds?: number; usage?: Generated["usage"] };
      try { payload = JSON.parse(raw); }
      catch { throw new Error(response.status === 413 ? "附件太大，請壓縮後再試。" : `伺服器回應異常（${response.status}）：${raw.slice(0, 80)}`); }
      if (!response.ok || payload.error || !payload.images?.length) throw new Error(payload.error || "生成失敗，請稍後再試。");
      const candidates = payload.transparent === false ? await Promise.all(payload.images.map(async (src) => removeWhiteBackground(await loadImage(src)))) : payload.images;
      const item: Generated = { id: crypto.randomUUID(), candidates, pick: 0, image: candidates[0], model: payload.model || "", quality: payload.quality || "high", seconds: payload.seconds || 0, usage: payload.usage || { input: 0, output: 0, total: 0, costUsd: 0 }, label: description.trim().slice(0, 24) || "參考圖生成", described: payload.described || "" };
      setItems((current) => [item, ...current].slice(0, 8)); setActiveId(item.id);
      if (payload.itemId) setJob({ id: payload.itemId, attempts: payload.attempt || 1, status: "draft" });
      setPhase("make"); setFitBody(null);
      void loadHistory(); void loadWallet(); void loadLibrary();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "生成失敗，請稍後再試。"); void loadHistory(); void loadWallet(); }
    finally { setLoading(false); }
  }

  async function loadLibrary() {
    if (!token) { setLibrary([]); return; }
    try {
      const response = await fetch("/api/outfit/items", { headers: authHeaders() });
      const payload = await response.json() as { items?: Item[]; error?: string };
      if (!response.ok) throw new Error(payload.error || "讀取我的服裝失敗");
      setLibrary(payload.items || []);
    } catch (cause) { setLibraryNote(cause instanceof Error ? cause.message : "讀取我的服裝失敗"); }
  }
  useEffect(() => { void loadLibrary(); }, [token]);
  // 以前（發佈功能上線前）完成的服裝：自動補發佈到 Pixel Office，不用使用者重新儲存
  const publishTried = useRef(new Set<string>());
  useEffect(() => {
    const pending = library.find((entry) => entry.status === "completed" && !entry.published && entry.bodyUrl && !publishTried.current.has(entry.id));
    if (!pending || !token) return;
    publishTried.current.add(pending.id);
    (async () => {
      try {
        const blobUrl = await fetch(pending.bodyUrl, { headers: authHeaders() }).then((response) => response.blob()).then((blob) => URL.createObjectURL(blob));
        const body = await prepareBody(blobUrl);
        const response = await fetch(`/api/outfit/items/${pending.id}`, { method: "PATCH", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(buildGameAssets(body, pending.head || defaultHeadFit(HEAD_NAMES.indexOf((wallet?.name || "") as (typeof HEAD_NAMES)[number]) >= 0 ? HEAD_NAMES.indexOf((wallet?.name || "") as (typeof HEAD_NAMES)[number]) : 0))) });
        if (response.ok) { setLibraryNote(`「${pending.name}」已發佈到元宇宙造型欄`); await loadLibrary(); }
      } catch { /* 下次重新整理再試 */ }
    })();
  }, [library, token]);
  const ownHeadIndex = () => { const at = HEAD_NAMES.indexOf((wallet?.name || "") as (typeof HEAD_NAMES)[number]); return at >= 0 ? at : 0; };
  function enterFit(body: FitBody, nextFit: HeadFit, name: string, isDefault: boolean) {
    setFitBody(body); setFit({ ...nextFit, headIndex: ownHeadIndex() }); setFitTarget(3); setFitName(name); setFitDefault(isDefault); setPhase("fit"); setError("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  /** 剛生成好 → 進入「套上大頭」。 */
  function pickCandidate(k: number) {
    setItems((current) => current.map((entry) => entry.id === activeId ? { ...entry, pick: k, image: entry.candidates[k] } : entry));
  }
  async function startFit() {
    if (!active || !job) return;
    if (active.candidates.length > 1) await fetch(`/api/outfit/items/${job.id}`, { method: "PATCH", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify({ variant: active.pick }) }).catch(() => undefined);
    try { enterFit(await prepareBody(active.image), defaultHeadFit(ownHeadIndex()), library.find((entry) => entry.id === job.id)?.name || "", false); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "無法套上大頭"); }
  }
  /** 從「我的服裝」打開（製作中的繼續做、已完成的編輯）。 */
  async function openItem(item: Item) {
    try {
      const blobUrl = await fetch(item.bodyUrl, { headers: authHeaders() }).then((response) => response.ok ? response.blob() : Promise.reject(new Error("讀取衣服圖片失敗"))).then((blob) => URL.createObjectURL(blob));
      const body = await prepareBody(blobUrl);
      setJob({ id: item.id, attempts: item.attempts, status: item.status });
      const generated: Generated = { id: `item-${item.id}-${item.attempts}`, candidates: [blobUrl], pick: 0, image: blobUrl, model: "", quality: "high", seconds: 0, usage: { input: 0, output: 0, total: 0, costUsd: 0 }, label: item.name || item.description.slice(0, 24) || "服裝" };
      setItems((current) => [generated, ...current.filter((entry) => entry.id !== generated.id)].slice(0, 8)); setActiveId(generated.id);
      enterFit(body, item.head || defaultHeadFit(ownHeadIndex()), item.name, item.isDefault);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "打開失敗"); }
  }
  function setFitValue(key: "dx" | "dy", value: number) {
    setFit((current) => { const next = [...current[key]] as [number, number, number]; if (fitTarget === 3) next.fill(value); else next[fitTarget] = value; return { ...current, [key]: next }; });
  }
  const fitValue = (key: "dx" | "dy") => fit[key][fitTarget === 3 ? 0 : fitTarget];
  /** 完成（或儲存修改）：存預覽圖（含頭）、頭的設定、各角度頸頂位置、名字、是否預設。 */
  async function saveFit(complete: boolean) {
    if (!job || !fitBody || !headsImg) return;
    if (!fitName.trim()) { setError("請幫這件服裝取個名字。"); return; }
    setFitBusy(true); setError("");
    try {
      const cover = composeFit(fitBody, headsImg, fit, 336).toDataURL("image/png");
      const response = await fetch(`/api/outfit/items/${job.id}`, { method: "PATCH", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify({ name: fitName.trim(), isDefault: fitDefault, head: fit, views: fitBody.views, cover, complete, ...(active && active.candidates.length > 1 ? { variant: active.pick } : {}), ...(complete || job.status === "completed" ? buildGameAssets(fitBody, fit) : {}) }) });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "儲存失敗");
      setJob({ ...job, status: complete || job.status === "completed" ? "completed" : "draft" });
      setLibraryNote(complete ? `「${fitName.trim()}」已完成製作${fitDefault ? "，並設為預設服裝" : ""}` : "已儲存修改");
      await loadLibrary();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "儲存失敗"); }
    finally { setFitBusy(false); }
  }
  async function toggleDefault(item: Item) {
    const response = await fetch(`/api/outfit/items/${item.id}`, { method: "PATCH", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify({ isDefault: !item.isDefault }) });
    const payload = await response.json() as { error?: string };
    if (!response.ok) setLibraryNote(payload.error || "設定失敗"); else { setLibraryNote(item.isDefault ? "已取消預設" : `「${item.name}」已設為預設服裝`); if (job?.id === item.id) setFitDefault(!item.isDefault); }
    await loadLibrary();
  }
  async function removeItem(item: Item) {
    if (!confirm(`確定刪除「${item.name || "這件服裝"}」？\n刪除後會從清單移除（紀錄仍會保留）；已扣的平台幣不會退回。`)) return;
    const response = await fetch(`/api/outfit/items/${item.id}`, { method: "DELETE", headers: authHeaders() });
    if (!response.ok) { const payload = await response.json().catch(() => ({})) as { error?: string }; setLibraryNote(payload.error || "刪除失敗"); return; }
    if (job?.id === item.id) { setJob(null); setPhase("make"); setFitBody(null); }
    setLibraryNote(`已刪除「${item.name || "服裝"}」`);
    await loadLibrary();
  }
  async function downloadCover(item: Item) {
    const url = item.coverUrl || item.bodyUrl;
    if (!url) return;
    const blob = await fetch(url, { headers: authHeaders() }).then((response) => response.blob());
    const blobUrl = URL.createObjectURL(blob); download(blobUrl, `outfit-${item.name || item.id}.png`); setTimeout(() => URL.revokeObjectURL(blobUrl), 2000);
  }
  /** 新的一件：不帶製作單編號，扣 200 點。 */
  function startNew() { setJob(null); setPhase("make"); setFitBody(null); void generate(); }
  const regenCost = wallet?.spendPerRegeneration ?? 50;
  const canRegenerate = Boolean(job && job.status === "draft" && wallet && (!wallet.designer || wallet.balance >= regenCost));

  const needsCoins = Boolean(wallet?.designer);
  const canGenerate = Boolean(token && wallet && (!needsCoins || wallet.balance >= wallet.spendPerGeneration) && (needsCoins || wallet.admin));
  async function saveSheet(kind: "original" | "normalized") {
    if (!active) return;
    if (kind === "original") { download(active.image, `outfit-${active.label || "sheet"}.png`); return; }
    if (!qa || qa.views.length !== 3) { setError("需要先分出三個角度才能做規格化（請看下面的檢查結果）。"); return; }
    const image = await loadImage(active.image);
    download(normalizedSheet(image, qa.views).toDataURL("image/png"), `outfit-${active.label || "sheet"}-standard.png`);
  }
  async function saveView(index: number) {
    if (!active || !qa || !qa.views[index]) return;
    const image = await loadImage(active.image);
    download(cropCanvas(image, qa.views[index]).toDataURL("image/png"), `outfit-${active.label || "sheet"}-${["front", "side", "back"][index]}.png`);
  }

  return <div className="studio">
    <header><a className="brand" href="/outfit"><span className="mark"><Shirt size={23} /></span><span>PIXEL OFFICE<small>OUTFIT STUDIO</small></span></a><div className="head-right"><span className="private-dot">團隊工具</span><a className="studio-link" href="/">階段判定器 <ArrowUpRight size={14} /></a><a className="studio-link" href="/api/logout"><LogOut size={14} />登出</a></div></header>
    <main>
      <div className="intro"><div><span className="eyebrow">YOUR NEXT LOOK, THREE WAYS.</span><h1>把穿搭靈感，變成遊戲服裝<span>。</span></h1><p>一張參考照，或一段描述。延續同一套畫風，生成完整服裝三視圖。</p></div><div className="intro-number"><b>03</b><span>FRONT · SIDE · BACK</span></div></div>
      <div className="workspace">
        <section className="control">
          <div className="section-head"><span className="step">01</span><h2>設計你的下一套服裝</h2></div>
          <div className="wallet">
            {!token ? <div className="wallet-locked"><b>需要從設計需求系統進入</b><span>請先登入設計需求系統，再點左側選單的「服裝」，才會帶入你的帳號與平台幣。</span></div>
              : walletError ? <div className="wallet-locked"><b>讀不到平台幣</b><span>{walletError}</span></div>
              : !wallet ? <div className="wallet-locked"><span>讀取平台幣中…</span></div>
              : !wallet.designer ? <div className="wallet-locked"><b>{wallet.admin ? "管理員" : "沒有設計師身分"}</b><span>{wallet.admin ? "你沒有設計師平台幣，生成不扣點，所有紀錄仍會留存。" : "只有設計師帳號有平台幣，才能使用服裝生成器。"}</span></div>
              : <>
                <div className="wallet-top"><div><span className="wallet-label">{wallet.name} 的平台幣</span><b className="wallet-balance">{fmtCoin(wallet.balance)}<small> 點</small></b></div><div className="wallet-rule">每次生成 {fmtCoin(wallet.spendPerGeneration)} 點（一次三組供選）<br />不滿意再生成三組 {fmtCoin(wallet.spendPerRegeneration)} 點<br />完成案件積分 1 點 = 1 點（{wallet.startDate} 起）</div></div>
                {wallet.balance < wallet.spendPerGeneration && <p className="wallet-warn">餘額不足 {fmtCoin(wallet.spendPerGeneration)} 點，還不能生成；完成案件累積，或請同事轉讓。</p>}
                <details className="wallet-transfer"><summary>轉讓點數給同事</summary>
                  <div className="transfer-form"><select value={transfer.to} onChange={(e) => setTransfer({ ...transfer, to: e.target.value })}><option value="">選擇設計師</option>{wallet.directory.map((name) => <option key={name} value={name}>{name}</option>)}</select><input type="number" min="0.1" step="0.1" placeholder="點數" value={transfer.amount} onChange={(e) => setTransfer({ ...transfer, amount: e.target.value })} /><input type="text" maxLength={60} placeholder="備註（選填）" value={transfer.memo} onChange={(e) => setTransfer({ ...transfer, memo: e.target.value })} /><button disabled={transferBusy || !transfer.to || !transfer.amount} onClick={() => void submitTransfer()}>{transferBusy ? "轉讓中…" : "確認轉讓"}</button></div>
                  <p className="transfer-note">轉讓會立即入帳，無法自行取消；雙方的紀錄都會留在帳本，如果轉錯請聯絡管理員處理。</p>
                  {transferMessage && <p className="transfer-msg">{transferMessage}</p>}
                </details></>}
          </div>
          <div className="field-label">服裝參考圖片 <span>選填 · 最多 2 張</span></div>
          <button className="drop" onClick={() => fileInput.current?.click()} onDragOver={(e) => e.preventDefault()} onDrop={onDrop} disabled={loading}><span className="upload-icon"><Upload size={22} /></span><strong>拖曳圖片到這裡</strong><span>或點擊上傳服裝參考</span><small>PNG / JPG / WebP · 每張 10 MB 以內</small></button>
          <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={(e: ChangeEvent<HTMLInputElement>) => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }} />
          {previews.length > 0 && <div className="thumbs">{previews.map(({ file, url }, index) => <div key={file.name + index}><img src={url} alt={`服裝參考 ${index + 1}`} /><button onClick={() => setFiles(files.filter((_, i) => i !== index))} aria-label={`移除圖片 ${index + 1}`} disabled={loading}><X size={13} /></button></div>)}</div>}
          <label className="field-label" htmlFor="outfit-description">服裝描述 <span>沒有圖片也可以直接描述</span></label>
          <textarea id="outfit-description" value={description} maxLength={600} disabled={loading} placeholder="例如：短版粉色外套、黑色寬褲、厚底鞋。保留珍珠滾邊，移除包包。" onChange={(e) => setDescription(e.target.value)} />
          <div className="prompt-foot"><span>只上傳圖片時，會先讀出圖中的衣服再生成。</span><span>{description.length}/600</span></div>
          <div className="presets">{EXAMPLES.map((example) => <button key={example} onClick={() => setDescription(example)} disabled={loading}>{example.split("、").slice(0, 2).join("＋")}</button>)}</div>
          <div className="rules" style={{ marginTop: 18 }}><Check size={15} /><span>已套用固定規範：無頭身體、朝右側面、透明背景</span></div>
          <button className="generate" onClick={() => startNew()} disabled={loading || !canGenerate || (!description.trim() && !files.length)}>{loading ? <LoaderCircle size={19} className="spin" /> : <Sparkles size={19} />}<span>{loading ? `正在生成 · ${elapsed} 秒` : `生成新的一件${wallet?.designer ? `（${fmtCoin(wallet.spendPerGeneration)} 點・一次三組）` : ""}`}</span>{!loading && <ArrowUpRight size={20} />}</button>
          <small className="cost">使用 OpenAI 圖片模型生成，會產生 API 費用；每次生成都會記錄在下方。</small>
          {error && <div className="error" role="alert">{error}</div>}
        </section>
        <section className="preview">
          <div className="section-head"><div className="preview-title"><span className="step">02</span><h2>{phase === "fit" && fitBody ? "套上大頭，微調位置" : active ? "你的新服裝" : "三視圖預覽"}</h2></div><span className="badge">{phase === "fit" && fitBody ? "最後一步" : active ? "生成結果" : "等待生成"}</span></div>
          {active?.described && <p className="described"><b>AI 從照片讀到的衣服：</b>{active.described}<button onClick={() => { setDescription(active.described || ""); setFiles([]); }}>用這段文字當描述（不再附照片）</button></p>}
          {phase === "fit" && fitBody ? <div className="fit">
            <div className={`canvas fit-canvas ${bg}`}><canvas ref={fitCanvas} className="sheet" /></div>
            <div className="preview-bottom"><span>預設用接近遊戲裡的大小預覽；頭像是低解析的遊戲素材，放大檢查位置時會顯得比較糊，這是正常的。 <button className="zoom-toggle" onClick={() => setFitZoom(fitZoom === 1 ? 1.6 : 1)}>{fitZoom === 1 ? "放大檢查" : "回到實際大小"}</button></span><div className="bg-controls" aria-label="預覽背景">{(["check", "light", "dark"] as Bg[]).map((x) => <button key={x} className={bg === x ? "active" : ""} onClick={() => setBg(x)} aria-label={`切換${x === "check" ? "棋盤格" : x === "light" ? "淺色" : "深色"}背景`} style={{ background: x === "dark" ? "#292b28" : x === "light" ? "#fff" : "#d7dcd2" }} />)}</div></div>
            <div className="fit-controls">
              <div className="fit-row"><span>頭像</span><div className="fit-own">{wallet?.designer ? `${HEAD_NAMES[fit.headIndex]}（本人）· 自己做的服裝只有自己能穿，所以固定用自己的頭` : "預覽用（沒有設計師身分，這件服裝不會進元宇宙）"}</div></div>
              <div className="fit-row"><span>調整角度</span><div className="chips">{([["全部一起", 3], ["正面", 0], ["側面", 1], ["背面", 2]] as Array<[string, 0 | 1 | 2 | 3]>).map(([label, value]) => <button key={label} className={fitTarget === value ? "on" : ""} onClick={() => setFitTarget(value)}>{label}</button>)}</div></div>
              <div className="fit-row"><span>上下</span><div className="nudge"><button aria-label="頭往上" onClick={() => setFitValue("dy", fitValue("dy") - 1)}><ArrowUp size={15} /></button><input type="range" min={-80} max={80} step={1} value={fitValue("dy")} onChange={(e) => setFitValue("dy", Number(e.target.value))} aria-label="頭的上下位置" /><button aria-label="頭往下" onClick={() => setFitValue("dy", fitValue("dy") + 1)}><ArrowDown size={15} /></button><b>{fitValue("dy")}</b></div></div>
              <div className="fit-row"><span>左右</span><div className="nudge"><button aria-label="頭往左" onClick={() => setFitValue("dx", fitValue("dx") - 1)}><ArrowLeft size={15} /></button><input type="range" min={-60} max={60} step={1} value={fitValue("dx")} onChange={(e) => setFitValue("dx", Number(e.target.value))} aria-label="頭的左右位置" /><button aria-label="頭往右" onClick={() => setFitValue("dx", fitValue("dx") + 1)}><ArrowRight size={15} /></button><b>{fitValue("dx")}</b></div></div>
              <div className="fit-row"><span>頭大小</span><div className="nudge"><button aria-label="縮小" onClick={() => setFit({ ...fit, scale: Math.max(0.6, Math.round((fit.scale - 0.01) * 100) / 100) })}>－</button><input type="range" min={70} max={130} step={1} value={Math.round(fit.scale * 100)} onChange={(e) => setFit({ ...fit, scale: Number(e.target.value) / 100 })} aria-label="頭的大小" /><button aria-label="放大" onClick={() => setFit({ ...fit, scale: Math.min(1.5, Math.round((fit.scale + 0.01) * 100) / 100) })}>＋</button><b>{Math.round(fit.scale * 100)}%</b></div></div>
              <button className="fit-reset" onClick={() => setFit(defaultHeadFit(fit.headIndex))}>全部重設</button>
            </div>
            <div className="fit-save">
              <label className="field-label" htmlFor="fit-name">服裝名稱 <span>最多 30 字</span></label>
              <input id="fit-name" className="fit-name" type="text" maxLength={30} value={fitName} placeholder="例如：紅色棒球外套" onChange={(e) => setFitName(e.target.value)} />
              <label className="fit-default"><input type="checkbox" checked={fitDefault} onChange={(e) => setFitDefault(e.target.checked)} /> 設為我的預設服裝</label>
              <div className="fit-buttons">
                <button className="generate" disabled={fitBusy || !fitName.trim()} onClick={() => void saveFit(job?.status !== "completed")}>{fitBusy ? <LoaderCircle size={18} className="spin" /> : <Check size={18} />}<span>{job?.status === "completed" ? "儲存修改" : "完成服裝製作"}</span></button>
                <button className="ghost" disabled={fitBusy} onClick={() => setPhase("make")}>返回上一步</button>
              </div>
              {job?.status === "draft" && <button className="refit" disabled={loading || fitBusy || !canRegenerate} onClick={() => void generate(false, job.id)}><Sparkles size={14} />對這一輪三組都不滿意？再生成三組（再扣 {fmtCoin(regenCost)} 點，仍是同一件）</button>}
            </div>
          </div> : <>
          <div className={`canvas ${bg}`} aria-busy={loading}>
            <div className="view-labels"><span>正面 <small>FRONT</small></span><span>側面 <small>SIDE →</small></span><span>背面 <small>BACK</small></span></div>
            {active ? <img className="sheet" src={active.image} alt="生成的服裝正面、朝右側面、背面三視圖" /> : <div className="empty-note"><Shirt size={30} /><p>{loading ? "圖片模型正在畫三個角度…" : "完成左側設定後，三視圖會顯示在這裡。"}</p></div>}
            {loading && <div className="loading"><LoaderCircle className="spin" size={32} /><strong>正在製作你的下一套服裝</strong><span>通常需要 20 秒到幾分鐘，請保持頁面開啟。</span></div>}
          </div>
          {active && active.candidates.length > 1 && <div className="cand-row" role="radiogroup" aria-label="三組供選">{active.candidates.map((src, k) => <button key={k} type="button" role="radio" aria-checked={active.pick === k} className={active.pick === k ? "on" : ""} disabled={loading} onClick={() => pickCandidate(k)}><span className="cand-img"><img src={src} alt={`方案 ${k + 1}`} /></span><b>方案 {k + 1}{active.pick === k ? "（目前選用）" : ""}</b></button>)}</div>}
          <div className="preview-bottom"><span>{active ? "透明 PNG · 請檢查三個角度與頸頂對齊" : "生成時會依固定規範替換為你的服裝。"}</span><div className="bg-controls" aria-label="預覽背景">{(["check", "light", "dark"] as Bg[]).map((x) => <button key={x} className={bg === x ? "active" : ""} onClick={() => setBg(x)} aria-label={`切換${x === "check" ? "棋盤格" : x === "light" ? "淺色" : "深色"}背景`} style={{ background: x === "dark" ? "#292b28" : x === "light" ? "#fff" : "#d7dcd2" }} />)}</div></div>
          <div className="download-row"><button disabled={!active || loading} onClick={() => void saveSheet("original")}><Download size={17} />下載完整 PNG</button><div>{["正面", "側面", "背面"].map((name, index) => <button key={name} disabled={!qa?.views[index] || loading} onClick={() => void saveView(index)}>{name}<Download size={13} /></button>)}</div></div>
          <p className="crop-note">各角度下載是依輪廓自動裁切；「規格化版本」會把三個角度放進同比例、腳底對齊的標準格子。</p>
          {active && <div className="download-row" style={{ marginTop: 10 }}><button disabled={loading} onClick={() => void saveSheet("normalized")}><Download size={17} />下載規格化版本</button></div>}
          {active && job && <div className="job-card"><div><b>這件服裝 · 第 {job.attempts} 次生成</b><span>{job.status === "draft" ? "在上面三組裡點選一組，滿意就進入下一步，套上大頭微調位置；三組裡挑一組；都不滿意可以再生成三組（仍是同一件，每次再扣 {fmtCoin(regenCost)} 點）。" : "這件已完成製作；可以在下面「我的服裝」編輯或刪除。"}</span></div>
            <div className="job-actions">{job.status === "draft" && <button className="primary" disabled={loading || !qa || qa.views.length !== 3} onClick={() => void startFit()}>下一步：套上大頭 <ArrowRight size={15} /></button>}{job.status === "draft" && <button disabled={loading || !canRegenerate} onClick={() => void generate(false, job.id)}><Sparkles size={14} />不滿意？再生成三組（再扣 {fmtCoin(regenCost)} 點）</button>}</div>
            {job.status === "draft" && wallet?.designer && wallet.balance < regenCost && <p className="wallet-warn">餘額不足 {fmtCoin(regenCost)} 點，還不能再生成。</p>}</div>}
          {active && qa && <div className="qa"><h3>規格檢查 <b className={qa.ok ? "ok" : "warn"}>{qa.ok ? "全部通過" : "有項目需要留意"}</b></h3>
            <ul>{qa.checks.map((check) => <li key={check.id} className={check.ok ? "ok" : "bad"}>{check.ok ? <Check size={14} /> : <TriangleAlert size={14} />}<span><strong>{check.label}</strong><small>{check.detail}</small></span></li>)}</ul>
            <p className="qa-note">這是依規格自動量的參考，最後仍請用眼睛看：頭、帽子、眼鏡不能出現；脖子要平切；三個角度的衣服要是同一套。</p></div>}
          {active && !qa?.ok && <button className="refit" disabled={loading} onClick={() => void generate(true, job?.id || "")}><Sparkles size={14} />比例不對？用這張的衣服重新套到標準身體（{job ? `再扣 ${fmtCoin(regenCost)} 點` : "再生成一次"}）</button>}
          {active && <p className="usage-line">{active.model} · 最高品質 · {active.seconds} 秒 · {active.usage.total.toLocaleString()} tokens · <b>約 {formatUsd(active.usage.costUsd)}</b>（{formatTwd(active.usage.costUsd)}）</p>}
          {items.length > 1 && <div className="variants">{items.map((item) => <button key={item.id} className={item.id === activeId ? "on" : ""} onClick={() => setActiveId(item.id)}><img src={item.image} alt={item.label} /><span>{item.label}</span></button>)}</div>}
          <div className="guidance"><div><span>01 / REF</span><b>換穿搭，保留比例</b><p>照片只決定衣服款式。身體比例、圓潤手部與厚底鞋維持一致。</p></div><div><span>02 / STYLE</span><b>你的固定服裝系列</b><p>暖黑粗線條、清楚色塊與左上光源，讓每套服裝能接上同一個角色。</p></div></div>
          </>}
        </section>
      </div>
      <section className="history">
        <div className="section-head"><div className="preview-title"><span className="step">03</span><h2>我的服裝</h2></div><button className="refresh" onClick={() => void loadLibrary()}>重新整理</button></div>
        <p className="history-total">完成製作的服裝可以設為預設、編輯（調整頭的位置、改名字）或刪除；製作中的可以繼續做。{libraryNote && <b> ｜ {libraryNote}</b>}</p>
        {!library.length ? <p className="empty-note">還沒有服裝。生成一件、套上大頭並完成製作後，會出現在這裡。</p> : <div className="library">{library.map((item) => <article key={item.id} className={`lib-card ${item.status}`}>
          <div className="lib-thumb"><AuthImage url={item.coverUrl || item.bodyUrl} token={token} alt={item.name || "服裝"} /></div>
          <div className="lib-main"><div className="lib-title"><strong>{item.name || "（未命名）"}</strong>{item.isDefault && <span className="badge-default"><Star size={11} /> 預設</span>}<span className={`badge-status ${item.status}`}>{item.status === "completed" ? "已完成" : "製作中"}</span>{item.status === "completed" && <span className={`badge-status ${item.published ? "completed" : ""}`}>{item.published ? "已在元宇宙造型欄" : "發佈中…"}</span>}</div>
            <small>{item.description || "—"}</small><small>更新 {formatTime(item.updatedAt)} · 生成 {item.attempts} 次</small></div>
          <div className="lib-actions"><button onClick={() => void openItem(item)}><Pencil size={13} />{item.status === "completed" ? "編輯" : "繼續製作"}</button>{item.status === "completed" && <button onClick={() => void toggleDefault(item)}><Star size={13} />{item.isDefault ? "取消預設" : "設為預設"}</button>}<button onClick={() => void downloadCover(item)}><Download size={13} />下載</button><button className="danger" onClick={() => void removeItem(item)}><Trash2 size={13} />刪除</button></div>
        </article>)}</div>}
      </section>
      <section className="history">
        <div className="section-head"><div className="preview-title"><span className="step">04</span><h2>生成紀錄</h2></div><button className="refresh" onClick={() => void loadHistory()}>重新整理</button></div>
        <p className="history-total">共 <b>{totals.runs}</b> 次（成功 {totals.ok} 次）· 累計 {totals.tokens.toLocaleString()} tokens · 約 <b>{formatUsd(totals.costUsd)}</b>（{formatTwd(totals.costUsd)}）· 每次生成（成功與失敗）都會記錄並保存圖片</p>
        {historyError && <div className="error">{historyError}</div>}
        {!records.length && !historyError ? <p className="empty-note">完成第一次生成後，紀錄會顯示在這裡。</p> : <div className="records">{records.map((record) => <article key={record.id} className="record">
          {record.imageUrl ? <button className="thumb" onClick={() => openRecord(record)} aria-label="重新打開這次的結果"><AuthImage url={record.imageUrl} token={token} alt={record.description || "生成結果"} /></button> : <div className="thumb failed-thumb"><TriangleAlert size={22} /></div>}
          <div className="record-main"><div className="record-meta"><time>{formatTime(record.createdAt)}</time><span>{userLabel(record.userId)}</span><span>{record.model} · 最高品質</span>{record.status === "ok" && <span>{record.seconds} 秒 · 約 {formatUsd(record.usage.costUsd)}</span>}</div>
            <strong>{record.description || (record.described ? `（照片）${record.described}` : "（參考照片）")}</strong>
            {record.status === "failed" && <p className="record-error">失敗：{record.error}</p>}
            {record.described && record.description && <small>AI 讀到的衣服：{record.described}</small>}</div>
          {record.imageUrl && <button className="open-btn" onClick={() => openRecord(record)}>重新打開</button>}
        </article>)}</div>}
      </section>
      {wallet?.designer && <section className="history">
        <div className="section-head"><div className="preview-title"><span className="step">05</span><h2>平台幣明細</h2></div><button className="refresh" onClick={() => void loadWallet()}>重新整理</button></div>
        <p className="history-total">你的最近 {wallet.recent.length} 筆紀錄（完整帳本由管理員保存，每筆都有簽章，無法事後修改）</p>
        {!wallet.recent.length ? <p className="empty-note">還沒有紀錄。完成案件後，積分會自動記入。</p> : <div className="records">{wallet.recent.map((entry) => <article key={entry.seq} className="coin-entry"><time>{formatTime(entry.at)}</time><strong>{entry.label}{entry.counterparty ? `（${entry.kind === "transfer_in" ? "來自" : "給"} ${entry.counterparty}）` : ""}</strong><span className="coin-memo">{entry.memo}</span><b className={entry.amount >= 0 ? "plus" : "minus"}>{entry.amount >= 0 ? "+" : ""}{fmtCoin(entry.amount)}</b></article>)}</div>}
      </section>}
      <footer><span>PIXEL OFFICE / CREATIVE TOOLS</span><span>每一套，都有你的風格。</span></footer>
    </main>
  </div>;
}
