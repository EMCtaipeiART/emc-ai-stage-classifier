"use client";

import { ChangeEvent, DragEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatTwd, formatUsd, PRICE_PER_MILLION } from "@/lib/pricing";
import { Check, ChevronRight, Clipboard, ExternalLink, FileImage, History, LoaderCircle, RefreshCcw, RotateCcw, Sparkles, Upload, X } from "lucide-react";

type Result = { stage: "新製" | "再製" | "資訊不足"; confidence: number; reason: string; tasks: string[]; basis: string; missing: string[] };
type Usage = { input: number; cached?: number; output: number; total: number; costUsd?: number };
type AnalysisResult = Result & { usage: Usage; historyId?: string | null; historySaved?: boolean; historyWarning?: string; slidesWarning?: string };
type HistoryItem = {
  id: string;
  createdAt: string;
  sourceType: string;
  slidesUrl: string | null;
  imageCount: number;
  result: Result;
  usage: Usage;
  assets: Array<{ name: string; type: string; kind: "image" | "slides"; url: string }>;
};

// D1 的 CURRENT_TIMESTAMP 是不帶時區的 UTC 字串
const formatTime = (value: string) => new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(value) ? value : `${value.replace(" ", "T")}Z`).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" });

const stageTone = (stage?: string) => stage === "新製" ? "new" : stage === "再製" ? "rework" : "unknown";

function ResultDetails({ result }: { result: Result & { usage: Usage } }) {
  return <>
    <div className="detail"><h3>辨識到的工作內容</h3><div className="tags">{(result.tasks.length ? result.tasks : ["尚未辨識到明確工作項目"]).map((task) => <span key={task}>{task}</span>)}</div></div>
    <div className="detail"><h3>判斷依據</h3><p>{result.basis}</p></div>
    {!!result.missing.length && <div className="detail"><h3>建議補充</h3><ul>{result.missing.map((item) => <li key={item}>{item}</li>)}</ul></div>}
    <div className="detail usage-detail"><h3>API 用量與費用</h3>
      <table className="cost-table"><tbody>
        <tr><td>輸入</td><td>{(result.usage.input - (result.usage.cached || 0)).toLocaleString()} tokens</td><td>× ${PRICE_PER_MILLION.input}/1M</td></tr>
        {!!result.usage.cached && <tr><td>快取輸入</td><td>{result.usage.cached.toLocaleString()} tokens</td><td>× ${PRICE_PER_MILLION.cachedInput}/1M</td></tr>}
        <tr><td>輸出（含推理）</td><td>{result.usage.output.toLocaleString()} tokens</td><td>× ${PRICE_PER_MILLION.output}/1M</td></tr>
        <tr className="cost-total"><td>合計</td><td>{result.usage.total.toLocaleString()} tokens</td><td><b>{formatUsd(result.usage.costUsd || 0)}</b><small>{formatTwd(result.usage.costUsd || 0)}</small></td></tr>
      </tbody></table>
    </div>
  </>;
}

export default function Home() {
  const [slidesUrl, setSlidesUrl] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [rulesOpen, setRulesOpen] = useState(false);
  const [override, setOverride] = useState<"新製" | "再製" | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [usageTotals, setUsageTotals] = useState({ analyses: 0, tokens: 0, costUsd: 0 });
  const [accessProtected, setAccessProtected] = useState(false);
  const [viewing, setViewing] = useState<HistoryItem | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const previews = useMemo(() => files.map((file) => ({ file, url: URL.createObjectURL(file) })), [files]);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const response = await fetch("/api/history");
      const payload = await response.json();
      if (response.ok) {
        setHistory(payload.items || []);
        setUsageTotals(payload.totals || { analyses: 0, tokens: 0, costUsd: 0 });
        setAccessProtected(Boolean(payload.accessProtected));
      }
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    fetch("/api/history")
      .then((response) => response.json().then((payload) => ({ ok: response.ok, payload })))
      .then(({ ok, payload }) => {
        if (!active || !ok) return;
        setHistory(payload.items || []);
        setUsageTotals(payload.totals || { analyses: 0, tokens: 0, costUsd: 0 });
        setAccessProtected(Boolean(payload.accessProtected));
      })
      .finally(() => { if (active) setHistoryLoading(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!viewing && !rulesOpen) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { setViewing(null); setRulesOpen(false); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [viewing, rulesOpen]);

  function addFiles(list: FileList | File[]) {
    const incoming = Array.from(list).filter((file) => /^image\/(png|jpeg|webp)$/.test(file.type) && file.size <= 10 * 1024 * 1024);
    setFiles((current) => [...current, ...incoming].slice(0, 3));
  }
  function restart() {
    setFiles([]); setSlidesUrl(""); setResult(null); setError(""); setOverride(null); setAccepted(false);
    if (fileInput.current) fileInput.current.value = "";
    void loadHistory();
  }
  function onDrop(event: DragEvent<HTMLDivElement>) { event.preventDefault(); addFiles(event.dataTransfer.files); }
  async function analyze() {
    if (!files.length && !slidesUrl.trim()) { setError("請上傳截圖，或貼上公開的 Google Slides 連結。"); return; }
    setLoading(true); setError(""); setAccepted(false); setOverride(null);
    try {
      const form = new FormData(); form.set("slidesUrl", slidesUrl.trim()); files.forEach((file) => form.append("images", file));
      const response = await fetch("/api/analyze", { method: "POST", body: form });
      const raw = await response.text();
      let payload;
      try { payload = JSON.parse(raw); }
      catch { throw new Error(response.status === 413 ? "附件太大，請壓縮截圖後再試。" : `伺服器回應異常（${response.status}）：${raw.slice(0, 80)}`); }
      if (!response.ok) throw new Error(payload.error || "分析失敗，請稍後再試。");
      setResult(payload);
      await loadHistory();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "分析失敗，請稍後再試。"); }
    finally { setLoading(false); }
  }
  const finalStage = override || result?.stage;
  const tone = stageTone(result?.stage);

  return <main className="app-shell">
    <header className="topbar"><div className="brand"><span className="brand-mark">E</span><span>EMC AI 階段判定器<small>DESIGN REQUEST ASSISTANT</small></span></div><span className="service"><i />AI 判定服務{accessProtected && <a className="logout" href="/api/logout">登出</a>}</span></header>
    <section className="page">
      <div className="intro"><div><h1>這個案件是新製，還是再製？</h1><p>上傳截圖最準確；若沒有截圖，也可貼上公開的 Google Slides。</p></div><button className="rule-link" onClick={() => setRulesOpen(true)}>查看判定規則 <ChevronRight size={17} /></button></div>
      <div className="workspace">
        <section className="panel input-panel">
          <div className="panel-title"><h2>提供案件資料</h2><span>01／加入附件</span></div>
          <div className="priority-note"><b>判定優先順序</b><span><strong>1</strong> 截圖</span><ChevronRight size={15} /><span><strong>2</strong> Google Slides</span></div>
          <div className="source-grid">
            <div className="source-box dropzone primary-source" onDragOver={(e) => e.preventDefault()} onDrop={onDrop} onClick={() => fileInput.current?.click()}><input ref={fileInput} hidden multiple type="file" accept="image/png,image/jpeg,image/webp" onChange={(e: ChangeEvent<HTMLInputElement>) => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }} /><Upload size={24} /><div><strong>上傳截圖 <em>首選</em></strong><small>最多 3 張，每張 10MB 內；AI 會優先閱讀截圖</small></div></div>
            <div className="source-box"><div className="source-label"><FileImage size={20} /><div><strong>公開 Google Slides</strong><small>需設定「知道連結的任何人都可查看」</small></div></div><input type="url" value={slidesUrl} onChange={(e) => setSlidesUrl(e.target.value)} placeholder="貼上 docs.google.com/presentation 連結" /></div>
          </div>
          {previews.length > 0 && <div className="previews">{previews.map(({ file, url }, index) => <div key={file.name + index}><img src={url} alt={file.name} /><button aria-label={`移除 ${file.name}`} onClick={(e) => { e.stopPropagation(); setFiles(files.filter((_, i) => i !== index)); }}><X size={14} /></button></div>)}</div>}
          {error && <p className="error" role="alert">{error}</p>}
          <div className="actions">
            <button className="analyze" disabled={loading} onClick={analyze}>{loading ? <><LoaderCircle className="spin" size={19} />AI 分析中…</> : <><Sparkles size={19} />開始 AI 分析</>}</button>
            <button className="restart" disabled={loading || (!files.length && !slidesUrl && !result && !error)} onClick={restart}><RotateCcw size={17} />重新開始</button>
          </div>
          <p className="privacy">附件由伺服器端分析並保存於私人紀錄；API 金鑰不會出現在瀏覽器中。</p>
          <div className="usage-summary"><span>已分析 <b>{usageTotals.analyses}</b> 次 · 累計 <b>{usageTotals.tokens.toLocaleString()}</b> tokens · <b>{formatUsd(usageTotals.costUsd || 0)}</b>（{formatTwd(usageTotals.costUsd || 0)}）</span><a href="https://platform.openai.com/settings/organization/billing/" target="_blank" rel="noreferrer">查看剩餘額度 <ExternalLink size={13} /></a></div>
        </section>
        <aside className="panel result-panel" aria-live="polite">
          <div className="panel-title"><h2>AI 判定建議</h2><span>02／確認結果</span></div>
          {!result ? <div className="empty"><span><Sparkles size={30} /></span><strong>{loading ? "正在分析案件內容" : "等待需求內容"}</strong><p>{loading ? "AI 正在綜合您提供的資料。" : "完成左側資料後，判定結果會顯示在這裡。"}</p></div> : <div className="result-content">
            <div className={`verdict ${tone}`}><div><strong>AI 判定：{result.stage}</strong><b>信心度 {result.confidence}%</b></div><p>{result.reason}</p><div className="meter"><i style={{ width: `${result.confidence}%` }} /></div></div>
            <ResultDetails result={result} />
            {result.slidesWarning && <p className="notice">{result.slidesWarning}；本次已改以截圖完成分析。</p>}
            {result.historyWarning && <p className="error">判定已完成，但紀錄未保存：{result.historyWarning}</p>}
            {result.stage !== "資訊不足" && <div className="decision"><button className="accept" onClick={() => setAccepted(true)}><Check size={17} />{accepted ? `已採用「${finalStage}」` : `採用「${finalStage}」`}</button><button onClick={() => { setOverride(result.stage === "新製" ? "再製" : "新製"); setAccepted(false); }}>改為「{result.stage === "新製" ? "再製" : "新製"}」</button></div>}
            <div className="utilities"><button onClick={() => navigator.clipboard.writeText(JSON.stringify({ ...result, finalStage }, null, 2))}><Clipboard size={15} />複製結果</button><button onClick={restart}><RotateCcw size={15} />重新開始</button></div>
          </div>}
        </aside>
      </div>
      <section className="panel history-panel">
        <div className="history-heading"><div><span><History size={20} /></span><div><h2>分析紀錄</h2><p>保留最近 50 筆結果、附件與用量，可隨時重新調閱。</p></div></div><button onClick={() => void loadHistory()} disabled={historyLoading}><RefreshCcw className={historyLoading ? "spin" : ""} size={16} />重新整理</button></div>
        {historyLoading && !history.length ? <p className="history-empty">正在載入紀錄…</p> : !history.length ? <p className="history-empty">完成第一次分析後，紀錄會顯示在這裡。</p> : <div className="history-list">{history.map((item) => <article key={item.id} className="history-card">
          <div className={`history-stage ${stageTone(item.result.stage)}`}>{item.result.stage}</div>
          <div className="history-main"><div className="history-meta"><time>{formatTime(item.createdAt)}</time><span>{item.sourceType}</span><span>{item.usage.total.toLocaleString()} tokens · {formatUsd(item.usage.costUsd || 0)}</span></div><strong>{item.result.reason}</strong>
            {!!item.assets.length && <div className="history-assets">{item.assets.map((asset) => asset.kind === "image" ? <a key={asset.url} href={asset.url} target="_blank" rel="noreferrer"><img src={asset.url} alt={asset.name} /></a> : <a key={asset.url} href={asset.url} target="_blank" rel="noreferrer"><FileImage size={15} />簡報快照</a>)}</div>}
          </div>
          <button className="view-history" onClick={() => setViewing(item)}>查看結果</button>
        </article>)}</div>}
      </section>
    </section>
    {viewing && <div className="modal-backdrop" onMouseDown={() => setViewing(null)}><section className="modal result-modal" role="dialog" aria-modal="true" aria-label="分析結果" onMouseDown={(e) => e.stopPropagation()}>
      <button className="modal-close" aria-label="關閉" onClick={() => setViewing(null)}><X /></button>
      <h2>分析結果</h2>
      <p>{formatTime(viewing.createdAt)} · {viewing.sourceType}{viewing.slidesUrl && <> · <a href={viewing.slidesUrl} target="_blank" rel="noreferrer">Google Slides 連結</a></>}</p>
      <div className="result-modal-body">
        <div className="modal-assets">
          <h3>附件截圖</h3>
          {viewing.assets.length ? viewing.assets.map((asset, index) => asset.kind === "image"
            ? <a key={asset.url} href={asset.url} target="_blank" rel="noreferrer" title="開新分頁看原圖"><img src={asset.url} alt={`截圖 ${index + 1}`} /><span>截圖 {index + 1}（點擊看原圖）</span></a>
            : <a key={asset.url} className="slides-file" href={asset.url} target="_blank" rel="noreferrer"><FileImage size={18} />下載簡報快照 PDF</a>)
            : <p className="history-empty">此紀錄沒有保存附件。</p>}
        </div>
        <div className="modal-text">
          <div className={`verdict ${stageTone(viewing.result.stage)}`}><div><strong>AI 判定：{viewing.result.stage}</strong><b>信心度 {viewing.result.confidence}%</b></div><p>{viewing.result.reason}</p><div className="meter"><i style={{ width: `${viewing.result.confidence}%` }} /></div></div>
          <ResultDetails result={{ ...viewing.result, usage: viewing.usage }} />
          <div className="utilities"><button onClick={() => navigator.clipboard.writeText(JSON.stringify(viewing.result, null, 2))}><Clipboard size={15} />複製結果</button></div>
        </div>
      </div>
    </section></div>}
    {rulesOpen && <div className="modal-backdrop" onMouseDown={() => setRulesOpen(false)}><section className="modal" onMouseDown={(e) => e.stopPropagation()}><button className="modal-close" onClick={() => setRulesOpen(false)}><X /></button><h2>案件階段判定規則</h2><p>判斷核心是實際設計工作與可否沿用完整版型，不只看關鍵字或是否提供官方素材。</p><div className="rule-grid"><article><h3>新製（符合任一項）</h3><ul><li>從零建立視覺或版型</li><li>新 Campaign／新 KV／新風格</li><li>素材（影片、產品圖、Logo）僅供內容使用，仍需重新設計</li><li>在素材上新增標題、價格、CTA、徽章等資訊或圖示</li><li>不同版型比例造成構圖、背景、標題、價格或 CTA 必須重排</li></ul></article><article><h3>再製（須全部成立）</h3><ul><li>已有可直接沿用的完整版型或完成稿（上面新增資訊或圖示就不算）</li><li>只需等比例縮放、延伸或裁切（上面新增資訊或圖示就不算）</li><li>單純更換文案、價格、日期或圖片（上面新增資訊或圖示就不算）</li><li>不需要重建主要構圖與資訊層級</li></ul></article></div></section></div>}
  </main>;
}
