"use client";

import { ChangeEvent, DragEvent, useEffect, useMemo, useRef, useState } from "react";
import { Check, Download, LoaderCircle, Shirt, Sparkles, Upload, X, TriangleAlert } from "lucide-react";
import { analyzeOutfit, type Check as QaCheck, type ViewBox } from "@/lib/outfit-check";
import { formatTwd, formatUsd } from "@/lib/pricing";

type Quality = "low" | "medium" | "high";
type Generated = { id: string; described?: string; transparent?: boolean; image: string; model: string; quality: Quality; seconds: number; usage: { input: number; output: number; total: number; costUsd: number }; label: string };

const QUALITIES: Array<{ id: Quality; label: string; hint: string }> = [
  { id: "low", label: "快速", hint: "約 20–40 秒，適合先看大概" },
  { id: "medium", label: "標準", hint: "約 40–90 秒（建議）" },
  { id: "high", label: "高品質", hint: "約 1.5–3 分鐘，費用最高" },
];
const EXAMPLES = ["紅色棒球外套、白 T、黑色工作褲、白色厚底球鞋", "橘色連帽衫、淺色寬牛仔褲、黑色高筒帆布鞋", "灰色針織背心、白襯衫、卡其長褲、棕色短靴"];
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
  const [qa, setQa] = useState<{ checks: QaCheck[]; views: ViewBox[]; ok: boolean } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const previews = useMemo(() => files.map((file) => ({ file, url: URL.createObjectURL(file) })), [files]);
  const active = items.find((item) => item.id === activeId) || null;

  // 這把金鑰能用的圖片模型（預設用 chatgpt-image-latest：跟 ChatGPT 網頁版同一條線；沒有就用清單最後一個）
  useEffect(() => {
    fetch("/api/outfit").then((response) => response.json() as Promise<{ models?: string[]; current?: string }>).then((payload) => {
      const list = payload.models || [];
      setModels(list);
      setModel(list.includes("chatgpt-image-latest") ? "chatgpt-image-latest" : (payload.current && list.includes(payload.current) ? payload.current : list[list.length - 1] || ""));
    }).catch(() => undefined);
  }, []);

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
  function onDrop(event: DragEvent<HTMLDivElement>) { event.preventDefault(); addFiles(event.dataTransfer.files); }

  async function generate(refit = false) {
    if (!refit && !description.trim() && !files.length) { setError("請輸入服裝描述（關鍵字），或上傳一張服裝參考圖。"); return; }
    setLoading(true); setElapsed(0); setError("");
    try {
      const form = new FormData();
      form.set("description", description.trim()); form.set("quality", quality); if (model) form.set("model", model);
      if (refit && active) {
        // 把目前這張當成「衣服」，要求重新套到標準身體上
        form.set("mode", "refit");
        form.append("images", await (await fetch(active.image)).blob(), "draft.png");
      } else files.forEach((file) => form.append("images", file));
      const response = await fetch("/api/outfit", { method: "POST", body: form });
      const raw = (await response.text()).trim();
      let payload: { error?: string; image?: string; described?: string; transparent?: boolean; model?: string; quality?: Quality; seconds?: number; usage?: Generated["usage"] };
      try { payload = JSON.parse(raw); }
      catch { throw new Error(response.status === 413 ? "附件太大，請壓縮後再試。" : `伺服器回應異常（${response.status}）：${raw.slice(0, 80)}`); }
      if (!response.ok || payload.error || !payload.image) throw new Error(payload.error || "生成失敗，請稍後再試。");
      const image = payload.transparent === false ? removeWhiteBackground(await loadImage(payload.image)) : payload.image;
      const item: Generated = { id: crypto.randomUUID(), image, model: payload.model || "", quality: payload.quality || quality, seconds: payload.seconds || 0, usage: payload.usage || { input: 0, output: 0, total: 0, costUsd: 0 }, label: description.trim().slice(0, 24) || "參考圖生成", described: payload.described || "" };
      setItems((current) => [item, ...current].slice(0, 8)); setActiveId(item.id);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "生成失敗，請稍後再試。"); }
    finally { setLoading(false); }
  }

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

  return <main className="app-shell">
    <header className="topbar"><div className="brand"><span className="brand-mark">E</span><span>EMC AI 服裝生成器<small>PIXEL OFFICE OUTFIT SHEET</small></span></div><span className="service"><a className="logout" href="/">← 階段判定器</a><a className="logout" href="/api/logout">登出</a></span></header>
    <section className="page">
      <div className="intro"><div><h1>一次生成一套服裝的三個角度</h1><p>輸入關鍵字，或上傳服裝參考圖，AI 會照 Pixel Office 的人物比例，畫出正面、側面、背面。</p></div></div>
      <div className="workspace">
        <section className="panel input-panel">
          <div className="panel-title"><h2>描述這套服裝</h2><span>01／輸入</span></div>
          <label htmlFor="outfit-description">服裝關鍵字 <em>（英文或中文都可以）</em></label>
          <textarea id="outfit-description" value={description} maxLength={600} placeholder="例如：紅色棒球外套、白 T、黑色工作褲、白色厚底球鞋" onChange={(e) => setDescription(e.target.value)} />
          <div className="under-field"><div className="chips">{EXAMPLES.map((example) => <button key={example} type="button" onClick={() => setDescription(example)}>{example.split("、")[0]}…</button>)}</div><span>{description.length} / 600</span></div>
          <div className="source-box dropzone primary-source" onDragOver={(e) => e.preventDefault()} onDrop={onDrop} onClick={() => fileInput.current?.click()}><input ref={fileInput} hidden multiple type="file" accept="image/png,image/jpeg,image/webp" onChange={(e: ChangeEvent<HTMLInputElement>) => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }} /><Upload size={24} /><div><strong>上傳服裝參考圖 <em>選填</em></strong><small>最多 2 張、每張 10MB 內；可以是衣服照片或設計稿。有上傳時，上面的文字會當成補充說明</small></div></div>
          {previews.length > 0 && <div className="previews">{previews.map(({ file, url }, index) => <div key={file.name + index}><img src={url} alt={file.name} /><button aria-label={`移除 ${file.name}`} onClick={(e) => { e.stopPropagation(); setFiles(files.filter((_, i) => i !== index)); }}><X size={14} /></button></div>)}</div>}
          {models.length > 1 && <label className="model-row">圖片模型<select value={model} onChange={(e) => setModel(e.target.value)}>{models.map((id) => <option key={id} value={id}>{id}</option>)}</select></label>}
          <div className="quality-row" role="radiogroup" aria-label="品質">{QUALITIES.map((option) => <button key={option.id} type="button" role="radio" aria-checked={quality === option.id} className={quality === option.id ? "on" : ""} onClick={() => setQuality(option.id)}><strong>{option.label}</strong><small>{option.hint}</small></button>)}</div>
          {error && <p className="error" role="alert">{error}</p>}
          <button className="analyze" disabled={loading} onClick={() => void generate()}>{loading ? <><LoaderCircle className="spin" size={19} />生成中… 已 {elapsed} 秒</> : <><Sparkles size={19} />開始生成</>}</button>
          <p className="privacy">使用 OpenAI 圖片模型生成，需要付費；金鑰只保留在伺服器端。每次生成都以現有人物的無頭身體當底圖、只換衣服，所以比例會跟遊戲裡一致。</p>
        </section>
        <aside className="panel result-panel" aria-live="polite">
          <div className="panel-title"><h2>生成結果</h2><span>02／檢查與下載</span></div>
          {!active ? <div className="empty"><span><Shirt size={30} /></span><strong>{loading ? "正在生成三個角度" : "等待生成"}</strong><p>{loading ? "圖片模型畫一張約需 30 秒到 3 分鐘，請不要關閉頁面。" : "完成左側資料後，結果會顯示在這裡。"}</p></div> : <div className="result-content">
            <div className="outfit-preview"><img src={active.image} alt="生成的服裝三視圖" /></div>
            <div className="outfit-actions"><button className="accept" onClick={() => void saveSheet("original")}><Download size={16} />下載原圖</button><button onClick={() => void saveSheet("normalized")}><Download size={16} />下載規格化版本</button></div>
            {!qa?.ok && <button className="refit" disabled={loading} onClick={() => void generate(true)}><Sparkles size={15} />比例不對？用這張的衣服重新套到標準身體（再生成一次）</button>}
            <div className="outfit-actions three">{["正面", "側面", "背面"].map((name, index) => <button key={name} disabled={!qa?.views[index]} onClick={() => void saveView(index)}><Download size={14} />{name}</button>)}</div>
            {qa && <div className="detail"><h3>規格檢查 <b className={qa.ok ? "qa-ok" : "qa-warn"}>{qa.ok ? "全部通過" : "有項目需要留意"}</b></h3>
              <ul className="qa-list">{qa.checks.map((check) => <li key={check.id} className={check.ok ? "ok" : "bad"}>{check.ok ? <Check size={15} /> : <TriangleAlert size={15} />}<span><strong>{check.label}</strong><small>{check.detail}</small></span></li>)}</ul>
              <p className="qa-note">這是依規格自動量的參考，最後仍請用眼睛看：頭、帽子、眼鏡不能出現；脖子要平切；三個角度的衣服要是同一套。</p></div>}
            {active.described && <div className="detail"><h3>AI 從照片讀到的衣服</h3><p>{active.described}</p><button className="text-link" onClick={() => { setDescription(active.described || ""); setFiles([]); }}>用這段文字當描述（不再附照片）</button></div>}
            <div className="detail usage-detail"><h3>這次的用量</h3><p>{active.model} · {QUALITIES.find((q) => q.id === active.quality)?.label} · {active.seconds} 秒 · {active.usage.total.toLocaleString()} tokens · <b>約 {formatUsd(active.usage.costUsd)}</b>（{formatTwd(active.usage.costUsd)}）</p></div>
          </div>}
        </aside>
      </div>
      {items.length > 1 && <section className="panel history-panel"><div className="history-heading"><div><span><Shirt size={20} /></span><div><h2>這次拜訪生成的版本</h2><p>只保留在這個頁面，重新整理就會消失，要用的請先下載。</p></div></div></div>
        <div className="outfit-history">{items.map((item) => <button key={item.id} className={item.id === activeId ? "on" : ""} onClick={() => setActiveId(item.id)}><img src={item.image} alt={item.label} /><span>{item.label}</span></button>)}</div></section>}
    </section>
  </main>;
}
