"use client";

// 頭像生成器（2026-10-08）：跟服裝同一套流程——一次生成三組供選 → 挑一組 → 取名字完成；不滿意可再生成三組（同一件、扣再生成的點數）。
// 參考圖是遊戲現有五位人物的頭像（lib/head-reference.ts），規格見 lib/head-spec.ts 與 EMC-ART-Pixel-Office/docs/HEAD_SPEC.md。
// 完成的頭像存在「我的頭像」；目前還不會進元宇宙造型欄（遊戲要先支援自訂頭像）。
import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { Check, Download, LoaderCircle, Sparkles, Trash2, TriangleAlert, Upload, UserRound, X } from "lucide-react";
import { analyzeHead } from "@/lib/head-check";
import type { Check as QaCheck, ViewBox } from "@/lib/outfit-check";

type Wallet = { name: string; designer: boolean; admin: boolean; balance: number; spendPerGeneration: number; spendPerRegeneration: number };
type HeadItem = { id: string; name: string; status: string; description: string; attempts: number; updatedAt: string; kind: string; coverUrl: string; bodyUrl: string };
type Bg = "check" | "light" | "dark";
const fmtCoin = (value: number) => (Math.round(value * 10) / 10).toLocaleString("zh-TW", { maximumFractionDigits: 1 });
const EXAMPLES = ["黑色長直髮、中分、淺膚色", "棕色波浪長髮、挑染金色髮尾", "黑色短髮、瀏海蓋額頭、小麥膚色", "栗色短捲髮、露出耳朵"];

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

/** 三個角度各自貼著輪廓裁出來，用同一個縮放（最高的那個角度 = 260 px），回傳三張透明 PNG 與尺寸，以及排成一列的預覽圖。 */
function buildHeadAssets(source: HTMLImageElement, views: ViewBox[]) {
  const tallest = Math.max(...views.map((v) => v.y1 - v.y0)), scale = Math.min(1, 260 / tallest) || 1;
  const crops = views.map((v) => {
    const w = Math.max(1, Math.round((v.x1 - v.x0) * scale)), h = Math.max(1, Math.round((v.y1 - v.y0) * scale));
    const canvas = document.createElement("canvas"); canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d")!; ctx.imageSmoothingQuality = "high"; ctx.drawImage(source, v.x0, v.y0, v.x1 - v.x0, v.y1 - v.y0, 0, 0, w, h);
    return canvas;
  });
  const gap = 12, cover = document.createElement("canvas");
  cover.width = crops.reduce((sum, c) => sum + c.width, 0) + gap * (crops.length - 1); cover.height = Math.max(...crops.map((c) => c.height));
  let x = 0; const cctx = cover.getContext("2d")!;
  crops.forEach((c) => { cctx.drawImage(c, x, cover.height - c.height); x += c.width + gap; });
  return { views: crops.map((c) => ({ w: c.width, h: c.height })), viewImages: crops.map((c) => c.toDataURL("image/png")), cover: cover.toDataURL("image/png") };
}

export default function HeadStudio({ token, wallet, reloadWallet }: { token: string; wallet: Wallet | null; reloadWallet: () => void }) {
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
  const fileInput = useRef<HTMLInputElement>(null);
  const previews = useMemo(() => files.map((file) => ({ file, url: URL.createObjectURL(file) })), [files]);
  const image = candidates[pick] || "";
  const regenCost = wallet?.spendPerRegeneration ?? 50;
  const needsCoins = Boolean(wallet?.designer);
  const canGenerate = Boolean(token && wallet && (!needsCoins || wallet.balance >= wallet.spendPerGeneration) && (needsCoins || wallet.admin));
  const canRegenerate = Boolean(job && wallet && (!wallet.designer || wallet.balance >= regenCost));

  useEffect(() => { if (!loading) return; const t = window.setInterval(() => setElapsed((n) => n + 1), 1000); return () => window.clearInterval(t); }, [loading]);
  async function loadLibrary() {
    if (!token) return;
    try {
      const response = await fetch("/api/outfit/items", { headers: auth() });
      const payload = await response.json() as { items?: HeadItem[] };
      setLibrary((payload.items || []).filter((item) => item.kind === "head"));
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
      setQa(analyzeHead(ctx.getImageData(0, 0, canvas.width, canvas.height)));
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
      form.set("kind", "head"); form.set("description", description.trim());
      if (itemId) form.set("itemId", itemId);
      files.forEach((file) => form.append("images", file));
      const response = await fetch("/api/outfit", { method: "POST", headers: auth(), body: form });
      const raw = (await response.text()).trim();
      let payload: { error?: string; itemId?: string; attempt?: number; images?: string[]; described?: string; transparent?: boolean };
      try { payload = JSON.parse(raw); } catch { throw new Error(response.status === 413 ? "附件太大，請壓縮後再試。" : `伺服器回應異常（${response.status}）：${raw.slice(0, 80)}`); }
      if (!response.ok || payload.error || !payload.images?.length) throw new Error(payload.error || "生成失敗，請稍後再試。");
      const list = payload.transparent === false ? await Promise.all(payload.images.map(async (src) => removeWhiteBackground(await loadImage(src)))) : payload.images;
      setCandidates(list); setPick(0); setDescribed(payload.described || "");
      if (payload.itemId) setJob({ id: payload.itemId, attempts: payload.attempt || 1 });
      void loadLibrary();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "生成失敗，請稍後再試。"); }
    finally { setLoading(false); reloadWallet(); }
  }
  async function save() {
    if (!job || !image || !qa || qa.views.length !== 3 || !name.trim()) return;
    setSaving(true); setError("");
    try {
      const assets = buildHeadAssets(await loadImage(image), qa.views);
      const response = await fetch(`/api/outfit/items/${job.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json", ...auth() },
        body: JSON.stringify({ name: name.trim(), cover: assets.cover, headAssets: { views: assets.views, viewImages: assets.viewImages }, variant: pick, complete: true }),
      });
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "儲存失敗");
      setNote(`「${name.trim()}」已存進我的頭像`); setCandidates([]); setJob(null); setName(""); setDescribed("");
      await loadLibrary();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "儲存失敗"); }
    finally { setSaving(false); }
  }
  async function remove(item: HeadItem) {
    if (!confirm(`確定刪除頭像「${item.name || "（未命名）"}」？`)) return;
    await fetch(`/api/outfit/items/${item.id}`, { method: "DELETE", headers: auth() }).catch(() => undefined);
    await loadLibrary();
  }

  return <>
    <div className="workspace">
      <section className="control">
        <div className="section-head"><div className="preview-title"><span className="step">01</span><h2>設計你的頭像</h2></div></div>
        {wallet?.designer && <div className="wallet" style={{ marginBottom: 14 }}><div className="wallet-top"><div><span className="wallet-label">{wallet.name} 的平台幣</span><b className="wallet-balance">{fmtCoin(wallet.balance)}<small> 點</small></b></div><div className="wallet-rule">每次生成 {fmtCoin(wallet.spendPerGeneration)} 點（一次三組供選）<br />不滿意再生成三組 {fmtCoin(wallet.spendPerRegeneration)} 點</div></div>{wallet.balance < wallet.spendPerGeneration && <p className="wallet-warn">餘額不足 {fmtCoin(wallet.spendPerGeneration)} 點，還不能生成。</p>}</div>}
        <div className="field-label">參考照片 <span>選填 · 最多 2 張</span></div>
        <button className="drop" onClick={() => fileInput.current?.click()} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files); }} disabled={loading}><span className="upload-icon"><Upload size={22} /></span><strong>拖曳照片到這裡</strong><span>或點擊上傳參考照</span><small>只會讀髮型與膚色等特徵，不會把照片本身送去畫圖 · PNG / JPG / WebP · 每張 10 MB 以內</small></button>
        <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={(e: ChangeEvent<HTMLInputElement>) => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }} />
        {previews.length > 0 && <div className="thumbs">{previews.map(({ file, url }, index) => <div key={file.name + index}><img src={url} alt={`參考照 ${index + 1}`} /><button onClick={() => setFiles(files.filter((_, i) => i !== index))} aria-label={`移除照片 ${index + 1}`} disabled={loading}><X size={13} /></button></div>)}</div>}
        <label className="field-label" htmlFor="head-description">髮型與臉部描述 <span>沒有照片也可以直接描述</span></label>
        <textarea id="head-description" value={description} maxLength={600} disabled={loading} placeholder="例如：黑色及肩短髮、側分瀏海、淺膚色，戴小圓耳環。" onChange={(e) => setDescription(e.target.value)} />
        <div className="prompt-foot"><span>只上傳照片時，會先讀出髮型再生成。</span><span>{description.length}/600</span></div>
        <div className="presets">{EXAMPLES.map((example) => <button key={example} onClick={() => setDescription(example)} disabled={loading}>{example.split("、").slice(0, 2).join("＋")}</button>)}</div>
        <div className="rules" style={{ marginTop: 18 }}><Check size={15} /><span>已套用固定規範：只有頭、三個角度、透明背景</span></div>
        <button className="generate" onClick={() => void generate()} disabled={loading || !canGenerate || (!description.trim() && !files.length)}>{loading ? <LoaderCircle size={19} className="spin" /> : <Sparkles size={19} />}<span>{loading ? `正在生成 · ${elapsed} 秒` : `生成新的頭像${wallet?.designer ? `（${fmtCoin(wallet.spendPerGeneration)} 點）` : ""}`}</span></button>
        <small className="cost">一次生成三組供選；使用 OpenAI 圖片模型，會產生 API 費用，每次生成都會記錄在生成紀錄。</small>
        {error && <div className="error" role="alert">{error}</div>}
        {note && <div className="described">{note}</div>}
      </section>
      <section className="preview">
        <div className="section-head"><div className="preview-title"><span className="step">02</span><h2>{image ? "你的新頭像" : "三視圖預覽"}</h2></div><span className="badge">{image ? "生成結果" : "等待生成"}</span></div>
        {described && <p className="described"><b>AI 從照片讀到的特徵：</b>{described}<button onClick={() => { setDescription(described); setFiles([]); }}>用這段文字當描述（不再附照片）</button></p>}
        <div className={`canvas ${bg}`} aria-busy={loading}>
          <div className="view-labels"><span>正面 <small>FRONT</small></span><span>側面 <small>SIDE →</small></span><span>背面 <small>BACK</small></span></div>
          {image ? <img className="sheet" src={image} alt="生成的頭像正面、朝右側面、背面三視圖" /> : <div className="empty-note"><UserRound size={30} /><p>{loading ? "圖片模型正在畫三個角度…" : "完成左側設定後，三視圖會顯示在這裡。"}</p></div>}
          {loading && <div className="loading"><LoaderCircle className="spin" size={32} /><strong>正在製作你的新頭像</strong><span>通常需要 20 秒到幾分鐘，請保持頁面開啟。</span></div>}
        </div>
        {candidates.length > 1 && <div className="cand-row" role="radiogroup" aria-label="三組供選">{candidates.map((src, k) => <button key={k} type="button" role="radio" aria-checked={pick === k} className={pick === k ? "on" : ""} disabled={loading} onClick={() => setPick(k)}><span className="cand-thumb"><img src={src} alt={`第 ${k + 1} 組`} /></span><span>第 {k + 1} 組</span></button>)}</div>}
        <div className="preview-bottom"><span>{image ? "透明 PNG · 請檢查三個角度是不是同一個人" : "生成時會依固定規範畫出頭像。"}</span><div className="bg-controls" aria-label="預覽背景">{(["check", "light", "dark"] as Bg[]).map((x) => <button key={x} className={bg === x ? "active" : ""} onClick={() => setBg(x)} aria-label={x}>{x === "check" ? "透明" : x === "light" ? "淺" : "深"}</button>)}</div></div>
        {image && <div className="download-row"><button disabled={loading} onClick={() => { const a = document.createElement("a"); a.href = image; a.download = "head-sheet.png"; a.click(); }}><Download size={17} />下載完整 PNG</button></div>}
        {image && job && <div className="job-card"><div><b>這個頭像 · 第 {job.attempts} 次生成</b><span>在上面三組裡點選一組，取名字後完成；都不滿意可以再生成三組（仍是同一個，每次再扣 {fmtCoin(regenCost)} 點）。</span></div>
          <label className="field-label" htmlFor="head-name">頭像名稱 <span>最多 30 字</span></label>
          <input id="head-name" className="fit-name" type="text" maxLength={30} value={name} placeholder="例如：短髮版" onChange={(e) => setName(e.target.value)} />
          <div className="job-actions"><button className="primary" disabled={saving || loading || !name.trim() || !qa || qa.views.length !== 3} onClick={() => void save()}>{saving ? <LoaderCircle size={15} className="spin" /> : <Check size={15} />}完成頭像</button><button disabled={loading || !canRegenerate} onClick={() => void generate(job.id)}><Sparkles size={14} />再生成三組（再扣 {fmtCoin(regenCost)} 點）</button></div></div>}
        {image && qa && <div className="qa"><h3>規格檢查 <b className={qa.ok ? "ok" : "warn"}>{qa.ok ? "全部通過" : "有項目需要留意"}</b></h3>
          <ul>{qa.checks.map((check) => <li key={check.id} className={check.ok ? "ok" : "bad"}>{check.ok ? <Check size={14} /> : <TriangleAlert size={14} />}<span><strong>{check.label}</strong><small>{check.detail}</small></span></li>)}</ul>
          <p className="qa-note">這是依規格自動量的參考，最後仍請用眼睛看：只能有頭（沒有脖子、身體、帽子、眼鏡）；背面不能有臉；三個角度的髮色與髮型要一致。</p></div>}
      </section>
    </div>
    <section className="history">
      <div className="section-head"><div className="preview-title"><span className="step">03</span><h2>我的頭像</h2></div><button className="refresh" onClick={() => void loadLibrary()}>重新整理</button></div>
      <p className="history-total">完成的頭像會存在這裡。目前還不會進元宇宙造型欄（遊戲要先支援自訂頭像），先把頭像做好存起來。</p>
      {!library.length ? <p className="empty-note">還沒有頭像。生成一個並完成後，會出現在這裡。</p> : <div className="library">{library.map((item) => <article key={item.id} className={`lib-card ${item.status}`}>
        <div className="lib-thumb"><AuthImg url={item.coverUrl || item.bodyUrl} token={token} alt={item.name || "頭像"} /></div>
        <div className="lib-main"><div className="lib-title"><strong>{item.name || "（未命名）"}</strong><span className={`badge-status ${item.status}`}>{item.status === "completed" ? "已完成" : "製作中"}</span></div><small>{item.description || "—"}</small><small>生成 {item.attempts} 次</small></div>
        <div className="lib-actions"><button onClick={() => void remove(item)}><Trash2 size={13} />刪除</button></div>
      </article>)}</div>}
    </section>
  </>;
}
