"use client";

import { ChangeEvent, DragEvent, useEffect, useMemo, useRef, useState } from "react";
import "./studio.css";
import { ArrowUpRight, Check, Download, LoaderCircle, LogOut, Shirt, SlidersHorizontal, Sparkles, TriangleAlert, Upload, X } from "lucide-react";
import { analyzeOutfit, type Check as QaCheck, type ViewBox } from "@/lib/outfit-check";
import { formatTwd, formatUsd } from "@/lib/pricing";

type Quality = "low" | "medium" | "high";
type HistoryRecord = { id: string; createdAt: string; userId: string; status: string; model: string; quality: string; description: string; described: string; photoCount: number; seconds: number; usage: { input: number; output: number; total: number; costUsd: number }; transparent: boolean; error: string; imageUrl: string };
// D1 的 CURRENT_TIMESTAMP 是不帶時區的 UTC 字串
const formatTime = (value: string) => new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(value) ? value : `${value.replace(" ", "T")}Z`).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" });
const userLabel = (id: string) => id === "team-password" ? "團隊密碼" : id === "local-user" ? "本機" : id;
type Generated = { id: string; described?: string; transparent?: boolean; image: string; model: string; quality: Quality; seconds: number; usage: { input: number; output: number; total: number; costUsd: number }; label: string };

const QUALITIES: Array<{ id: Quality; label: string; hint: string }> = [
  { id: "low", label: "快速", hint: "約 20–40 秒，適合先看大概" },
  { id: "medium", label: "標準", hint: "約 40–90 秒（建議）" },
  { id: "high", label: "高品質", hint: "約 1.5–3 分鐘，費用最高" },
];
const EXAMPLES = ["紅色棒球外套、白 T、黑色工作褲、白色厚底球鞋", "橘色連帽衫、淺色寬牛仔褲、黑色高筒帆布鞋", "灰色針織背心、白襯衫、卡其長褲、棕色短靴"];
type Bg = "check" | "light" | "dark";
type WalletEntry = { seq: number; at: string; kind: string; label: string; amount: number; counterparty: string; memo: string; ref: string };
type Wallet = { name: string; designer: boolean; admin: boolean; balance: number; spendPerGeneration: number; startDate: string; recent: WalletEntry[]; directory: string[] };
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
  const [quality, setQuality] = useState<Quality>("medium");
  const [models, setModels] = useState<string[]>([]);
  const [model, setModel] = useState("");
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
    const blobUrl = await fetch(record.imageUrl, { headers: authHeaders() }).then((response) => response.blob()).then((blob) => URL.createObjectURL(blob)).catch(() => "");
    if (!blobUrl) { setError("讀取這張圖片失敗"); return; }
    const item: Generated = { id: record.id, image: blobUrl, model: record.model, quality: record.quality as Quality, seconds: record.seconds, usage: record.usage, label: record.description.slice(0, 24) || "照片生成", described: record.described };
    setItems((current) => [item, ...current.filter((existing) => existing.id !== record.id)].slice(0, 8)); setActiveId(record.id);
    window.scrollTo({ top: 0, behavior: "smooth" });
    })();
  }

  // 這把金鑰能用的圖片模型（預設用後端指定的模型 gpt-image-2.5-sunburst）
  useEffect(() => {
    if (!token) return;
    fetch("/api/outfit", { headers: authHeaders() }).then((response) => response.json() as Promise<{ models?: string[]; current?: string }>).then((payload) => {
      const list = payload.models || [];
      setModels(list);
      setModel(payload.current && list.includes(payload.current) ? payload.current : (list.includes("gpt-image-2.5-sunburst") ? "gpt-image-2.5-sunburst" : list[list.length - 1] || ""));
    }).catch(() => undefined);
  }, [token]);

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

  async function generate(refit = false) {
    if (!refit && !description.trim() && !files.length) { setError("請輸入服裝描述（關鍵字），或上傳一張服裝參考圖。"); return; }
    setLoading(true); setElapsed(0); setError("");
    try {
      const form = new FormData();
      form.set("description", description.trim()); form.set("quality", quality); if (model) form.set("model", model);
      if (refit && active) {
        // 把目前這張當成「衣服」，要求重新套到標準身體上
        form.set("mode", "refit");
        form.append("images", await (await fetch(active.image, { headers: active.image.startsWith("/api/") ? authHeaders() : {} })).blob(), "draft.png");
      } else files.forEach((file) => form.append("images", file));
      const response = await fetch("/api/outfit", { method: "POST", headers: authHeaders(), body: form });
      const raw = (await response.text()).trim();
      let payload: { error?: string; image?: string; described?: string; transparent?: boolean; model?: string; quality?: Quality; seconds?: number; usage?: Generated["usage"] };
      try { payload = JSON.parse(raw); }
      catch { throw new Error(response.status === 413 ? "附件太大，請壓縮後再試。" : `伺服器回應異常（${response.status}）：${raw.slice(0, 80)}`); }
      if (!response.ok || payload.error || !payload.image) throw new Error(payload.error || "生成失敗，請稍後再試。");
      const image = payload.transparent === false ? removeWhiteBackground(await loadImage(payload.image)) : payload.image;
      const item: Generated = { id: crypto.randomUUID(), image, model: payload.model || "", quality: payload.quality || quality, seconds: payload.seconds || 0, usage: payload.usage || { input: 0, output: 0, total: 0, costUsd: 0 }, label: description.trim().slice(0, 24) || "參考圖生成", described: payload.described || "" };
      setItems((current) => [item, ...current].slice(0, 8)); setActiveId(item.id);
      void loadHistory(); void loadWallet();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "生成失敗，請稍後再試。"); void loadHistory(); void loadWallet(); }
    finally { setLoading(false); }
  }

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
                <div className="wallet-top"><div><span className="wallet-label">{wallet.name} 的平台幣</span><b className="wallet-balance">{fmtCoin(wallet.balance)}<small> 點</small></b></div><div className="wallet-rule">每次生成 {fmtCoin(wallet.spendPerGeneration)} 點<br />完成案件積分 1 點 = 1 點（{wallet.startDate} 起）</div></div>
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
          <div className="settings"><SlidersHorizontal size={16} /><label htmlFor="outfit-quality">生成品質</label></div>
          <div className="quality-row" role="radiogroup" aria-label="品質" id="outfit-quality">{QUALITIES.map((option) => <button key={option.id} type="button" role="radio" aria-checked={quality === option.id} className={quality === option.id ? "on" : ""} disabled={loading} onClick={() => setQuality(option.id)}><strong>{option.label}</strong><small>{option.hint}</small></button>)}</div>
          {models.length > 1 && <label className="model-row">圖片模型<select value={model} disabled={loading} onChange={(e) => setModel(e.target.value)}>{models.map((id) => <option key={id} value={id}>{id}</option>)}</select></label>}
          <div className="rules" style={{ marginTop: 18 }}><Check size={15} /><span>已套用固定規範：無頭身體、朝右側面、透明背景</span></div>
          <button className="generate" onClick={() => void generate()} disabled={loading || !canGenerate || (!description.trim() && !files.length)}>{loading ? <LoaderCircle size={19} className="spin" /> : <Sparkles size={19} />}<span>{loading ? `正在生成 · ${elapsed} 秒` : "生成服裝三視圖"}</span>{!loading && <ArrowUpRight size={20} />}</button>
          <small className="cost">使用 OpenAI 圖片模型生成，會產生 API 費用；每次生成都會記錄在下方。</small>
          {error && <div className="error" role="alert">{error}</div>}
        </section>
        <section className="preview">
          <div className="section-head"><div className="preview-title"><span className="step">02</span><h2>{active ? "你的新服裝" : "三視圖預覽"}</h2></div><span className="badge">{active ? "生成結果" : "等待生成"}</span></div>
          {active?.described && <p className="described"><b>AI 從照片讀到的衣服：</b>{active.described}<button onClick={() => { setDescription(active.described || ""); setFiles([]); }}>用這段文字當描述（不再附照片）</button></p>}
          <div className={`canvas ${bg}`} aria-busy={loading}>
            <div className="view-labels"><span>正面 <small>FRONT</small></span><span>側面 <small>SIDE →</small></span><span>背面 <small>BACK</small></span></div>
            {active ? <img className="sheet" src={active.image} alt="生成的服裝正面、朝右側面、背面三視圖" /> : <div className="empty-note"><Shirt size={30} /><p>{loading ? "圖片模型正在畫三個角度…" : "完成左側設定後，三視圖會顯示在這裡。"}</p></div>}
            {loading && <div className="loading"><LoaderCircle className="spin" size={32} /><strong>正在製作你的下一套服裝</strong><span>通常需要 20 秒到幾分鐘，請保持頁面開啟。</span></div>}
          </div>
          <div className="preview-bottom"><span>{active ? "透明 PNG · 請檢查三個角度與頸頂對齊" : "生成時會依固定規範替換為你的服裝。"}</span><div className="bg-controls" aria-label="預覽背景">{(["check", "light", "dark"] as Bg[]).map((x) => <button key={x} className={bg === x ? "active" : ""} onClick={() => setBg(x)} aria-label={`切換${x === "check" ? "棋盤格" : x === "light" ? "淺色" : "深色"}背景`} style={{ background: x === "dark" ? "#292b28" : x === "light" ? "#fff" : "#d7dcd2" }} />)}</div></div>
          <div className="download-row"><button disabled={!active || loading} onClick={() => void saveSheet("original")}><Download size={17} />下載完整 PNG</button><div>{["正面", "側面", "背面"].map((name, index) => <button key={name} disabled={!qa?.views[index] || loading} onClick={() => void saveView(index)}>{name}<Download size={13} /></button>)}</div></div>
          <p className="crop-note">各角度下載是依輪廓自動裁切；「規格化版本」會把三個角度放進同比例、腳底對齊的標準格子。</p>
          {active && <div className="download-row" style={{ marginTop: 10 }}><button disabled={loading} onClick={() => void saveSheet("normalized")}><Download size={17} />下載規格化版本</button></div>}
          {active && qa && <div className="qa"><h3>規格檢查 <b className={qa.ok ? "ok" : "warn"}>{qa.ok ? "全部通過" : "有項目需要留意"}</b></h3>
            <ul>{qa.checks.map((check) => <li key={check.id} className={check.ok ? "ok" : "bad"}>{check.ok ? <Check size={14} /> : <TriangleAlert size={14} />}<span><strong>{check.label}</strong><small>{check.detail}</small></span></li>)}</ul>
            <p className="qa-note">這是依規格自動量的參考，最後仍請用眼睛看：頭、帽子、眼鏡不能出現；脖子要平切；三個角度的衣服要是同一套。</p></div>}
          {active && !qa?.ok && <button className="refit" disabled={loading} onClick={() => void generate(true)}><Sparkles size={14} />比例不對？用這張的衣服重新套到標準身體（再生成一次）</button>}
          {active && <p className="usage-line">{active.model} · {QUALITIES.find((q) => q.id === active.quality)?.label} · {active.seconds} 秒 · {active.usage.total.toLocaleString()} tokens · <b>約 {formatUsd(active.usage.costUsd)}</b>（{formatTwd(active.usage.costUsd)}）</p>}
          {items.length > 1 && <div className="variants">{items.map((item) => <button key={item.id} className={item.id === activeId ? "on" : ""} onClick={() => setActiveId(item.id)}><img src={item.image} alt={item.label} /><span>{item.label}</span></button>)}</div>}
          <div className="guidance"><div><span>01 / REF</span><b>換穿搭，保留比例</b><p>照片只決定衣服款式。身體比例、圓潤手部與厚底鞋維持一致。</p></div><div><span>02 / STYLE</span><b>你的固定服裝系列</b><p>暖黑粗線條、清楚色塊與左上光源，讓每套服裝能接上同一個角色。</p></div></div>
        </section>
      </div>
      <section className="history">
        <div className="section-head"><div className="preview-title"><span className="step">03</span><h2>生成紀錄</h2></div><button className="refresh" onClick={() => void loadHistory()}>重新整理</button></div>
        <p className="history-total">共 <b>{totals.runs}</b> 次（成功 {totals.ok} 次）· 累計 {totals.tokens.toLocaleString()} tokens · 約 <b>{formatUsd(totals.costUsd)}</b>（{formatTwd(totals.costUsd)}）· 每次生成（成功與失敗）都會記錄並保存圖片</p>
        {historyError && <div className="error">{historyError}</div>}
        {!records.length && !historyError ? <p className="empty-note">完成第一次生成後，紀錄會顯示在這裡。</p> : <div className="records">{records.map((record) => <article key={record.id} className="record">
          {record.imageUrl ? <button className="thumb" onClick={() => openRecord(record)} aria-label="重新打開這次的結果"><AuthImage url={record.imageUrl} token={token} alt={record.description || "生成結果"} /></button> : <div className="thumb failed-thumb"><TriangleAlert size={22} /></div>}
          <div className="record-main"><div className="record-meta"><time>{formatTime(record.createdAt)}</time><span>{userLabel(record.userId)}</span><span>{record.model} · {QUALITIES.find((q) => q.id === record.quality)?.label || record.quality}</span>{record.status === "ok" && <span>{record.seconds} 秒 · 約 {formatUsd(record.usage.costUsd)}</span>}</div>
            <strong>{record.description || (record.described ? `（照片）${record.described}` : "（參考照片）")}</strong>
            {record.status === "failed" && <p className="record-error">失敗：{record.error}</p>}
            {record.described && record.description && <small>AI 讀到的衣服：{record.described}</small>}</div>
          {record.imageUrl && <button className="open-btn" onClick={() => openRecord(record)}>重新打開</button>}
        </article>)}</div>}
      </section>
      {wallet?.designer && <section className="history">
        <div className="section-head"><div className="preview-title"><span className="step">04</span><h2>平台幣明細</h2></div><button className="refresh" onClick={() => void loadWallet()}>重新整理</button></div>
        <p className="history-total">你的最近 {wallet.recent.length} 筆紀錄（完整帳本由管理員保存，每筆都有簽章，無法事後修改）</p>
        {!wallet.recent.length ? <p className="empty-note">還沒有紀錄。完成案件後，積分會自動記入。</p> : <div className="records">{wallet.recent.map((entry) => <article key={entry.seq} className="coin-entry"><time>{formatTime(entry.at)}</time><strong>{entry.label}{entry.counterparty ? `（${entry.kind === "transfer_in" ? "來自" : "給"} ${entry.counterparty}）` : ""}</strong><span className="coin-memo">{entry.memo}</span><b className={entry.amount >= 0 ? "plus" : "minus"}>{entry.amount >= 0 ? "+" : ""}{fmtCoin(entry.amount)}</b></article>)}</div>}
      </section>}
      <footer><span>PIXEL OFFICE / CREATIVE TOOLS</span><span>每一套，都有你的風格。</span></footer>
    </main>
  </div>;
}
