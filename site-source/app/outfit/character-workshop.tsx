"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, LoaderCircle, Sparkles, Upload, UserRound, X } from "lucide-react";
import { normalizePhoto } from "@/lib/normalize-photo";
import {
  ANGLES, SHEET_CELL, SHEET_FOOT, SHEET_HEIGHT, assembleFrames, avatarOf, bakeAtlas, clean, cutout, diagnose, loadImg, measure, noAdjust, placeCell, splitViews, splitGrid, toBlob,
  type Adjust, type Canvas, type Measure,
} from "@/lib/character-image";

// 角色工坊（取代舊的「頭像＋身體拼接」精靈）：
// 01 上傳照片＋提示詞 → AI 三視圖 → 02 自動對位、使用者確認 → AI 補其餘 8 個角度 → 03 轉盤檢查（壞的可單獨重算）→ 04 發佈給 3D 辦公室。
const AI_ANGLES = [30, 60, 120, 150, 210, 240, 300, 330];
const STEPS = ["上傳照片", "三視圖對位", "補其餘角度", "檢查並上線"];
type JobInfo = { id: string; publishedAs?: string; target?: string; status: string; startRuns: number; angles: Record<string, number> };
type Props = { token: string; departmentLabel: string; canAll?: boolean; openId?: string; onPublished?: () => void; onNew?: () => void };
// 管理者發佈時要指定「這套是給誰的」：名單由後端（後台資料庫「帳號設定」）提供

async function postJson<T>(url: string, token: string, body: BodyInit, json = false): Promise<T> {
  const send = () => fetch(url, { method: "POST", headers: { "x-emc-editor-token": token, ...(json ? { "Content-Type": "application/json" } : {}) }, body });
  let response = await send();
  if (response.status === 401) { await new Promise((r) => setTimeout(r, 1200)); response = await send(); }   // 驗證登入的後端偶爾瞬斷（部署、冷啟動）：等一下再試一次
  const raw = (await response.text()).trim();
  let payload: T & { error?: string };
  try { payload = JSON.parse(raw); } catch { throw new Error(response.status === 413 ? "附件太大，請壓縮後再試。" : `伺服器回應異常（${response.status}）`); }
  if (!response.ok || payload.error) throw new Error(response.status === 401 ? (payload.error || "登入已失效，請回設計需求系統重新整理後再操作。") : payload.error || "操作失敗，請稍後再試。");
  return payload;
}

export default function CharacterWorkshop({ token, departmentLabel, canAll = false, openId = "", onPublished, onNew }: Props) {
  const auth = useMemo(() => ({ "x-emc-editor-token": token }), [token]);
  const [job, setJob] = useState<JobInfo | null>(null);
  const [stage, setStage] = useState<"loading" | "upload" | "align" | "angles" | "review" | "done">("loading");
  const [file, setFile] = useState<File | null>(null);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState("");
  const [views, setViews] = useState<Canvas[]>([]);                 // 去背後的三張原圖
  const [adj, setAdj] = useState<Adjust[]>([noAdjust(), noAdjust(), noAdjust()]);
  const [sheetCells, setSheetCells] = useState<Canvas[]>([]);       // 規格化後三格（640）
  const [ai, setAi] = useState<Record<number, Canvas>>({});
  const [failed, setFailed] = useState<number[]>([]);
  const [turn, setTurn] = useState(0);
  const [myName, setMyName] = useState("");
  const [quality, setQuality] = useState<"medium" | "high">("medium");
  const [target, setTarget] = useState("");
  const [targets, setTargets] = useState<string[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const preview = useMemo(() => file ? URL.createObjectURL(file) : "", [file]);
  const stepIndex = stage === "upload" || stage === "loading" ? 0 : stage === "align" ? 1 : stage === "angles" ? 2 : 3;

  useEffect(() => {   // 製作中離開頁面會中斷這一輪，先提醒
    if (!busy) return; const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);
  useEffect(() => { if (!busy) return; setElapsed(0); const t = window.setInterval(() => setElapsed((n) => n + 1), 1000); return () => window.clearInterval(t); }, [busy]);

  async function fetchCanvas(id: string, name: string, bust = false): Promise<Canvas | null> {
    const response = await fetch(`/api/character/${id}/asset/${name}.png${bust ? `?t=${Date.now()}` : ""}`, { headers: auth, cache: "no-store" });
    if (!response.ok) return null;
    return cutout(await loadImg(await response.blob()));
  }

  // 進來時讀回自己的製作單，從上次停下的地方繼續
  useEffect(() => {
    if (!token) return;   // token 要等網址參數讀進來才有；沒有 token 就先不打 API（否則會多出一則「沒有登入資訊」的紅字）
    setError("");
    if (openId === "new") { setStage("upload"); return; }   // 「新增一套角色」：不接續舊的製作單
    (async () => {
      try {
        const r = await fetch("/api/character" + (openId ? `?id=${encodeURIComponent(openId)}` : ""), { headers: auth, cache: "no-store" });
        const p = await r.json() as { job?: JobInfo | null; error?: string; name?: string; targets?: string[] };
        setMyName(p.name || ""); setTargets(p.targets || []);
        if (p.error) throw new Error(p.error);
        if (!p.job) { setStage("upload"); return; }
        setJob(p.job);
        if (p.job.status === "views3") { const v = await fetchCanvas(p.job.id, "views3"); if (v) { setViews(splitViews(v).map((c) => clean(c))); setStage("align"); } else setStage("upload"); }
        else if (p.job.status === "angles" || p.job.status === "published") {
          const sheet = await fetchCanvas(p.job.id, "sheet");
          if (!sheet) { setStage("upload"); return; }
          setSheetCells([0, 1, 2].map((i) => { const c = mkCell(); c.getContext("2d")!.drawImage(sheet, i * SHEET_CELL, 0, SHEET_CELL, SHEET_CELL, 0, 0, SHEET_CELL, SHEET_CELL); return c; }));
          const got: Record<number, Canvas> = {};
          // 先讀 8 角度合圖，再用單獨補算過的角度蓋上去
          const grid = await fetchCanvas(p.job.id, "grid");
          if (grid) { const cs = splitGrid(grid).map((c) => clean(c)); if (cs.length === 8 && cs.every((c) => measure(c))) AI_ANGLES.forEach((d, i) => { got[d] = cs[i]; }); }
          // 不看次數紀錄，直接逐一讀圖：圖在伺服器上就算數（避免紀錄漏掉而重複計費）
          await Promise.all(AI_ANGLES.map(async (deg) => { const c = await fetchCanvas(p.job!.id, `a${String(deg).padStart(3, "0")}`); if (c) got[deg] = clean(c); }));
          setAi(got);
          setStage(p.job.status === "published" ? "done" : Object.keys(got).length === AI_ANGLES.length ? "review" : "angles");
        } else setStage("upload");
      } catch (cause) { setError(cause instanceof Error ? cause.message : "讀取失敗"); setStage("upload"); }
    })();
  }, [token]);

  const mkCell = () => { const c = document.createElement("canvas"); c.width = c.height = SHEET_CELL; return c; };
  const measures: Array<Measure | null> = useMemo(() => views.map((v) => measure(v)), [views]);
  const diagnosis = useMemo(() => views.length === 3 ? diagnose(measures) : null, [views, measures]);
  const cells = useMemo(() => views.length === 3 ? views.map((v, i) => measures[i] ? placeCell(v, measures[i]!, SHEET_CELL, SHEET_HEIGHT, SHEET_FOOT, adj[i]) : mkCell()) : [], [views, measures, adj]);

  async function generate() {
    if (!file || busy) return;
    setError(""); setBusy("三視圖生成中");
    try {
      const form = new FormData();
      form.set("prompt", notes.trim()); form.append("image", await normalizePhoto(file));
      if (job) form.set("jobId", job.id);
      const res = await postJson<{ jobId: string; startRuns: number }>("/api/character/start", token, form);
      const v = await fetchCanvas(res.jobId, "views3", true);
      if (!v) throw new Error("讀不到生成的三視圖，請再試一次。");
      setJob({ id: res.jobId, status: "views3", startRuns: res.startRuns, angles: {} });
      setViews(splitViews(v).map((c) => clean(c))); setAdj([noAdjust(), noAdjust(), noAdjust()]); setAi({}); setStage("align");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "生成失敗，請稍後再試。"); }
    finally { setBusy(""); }
  }

  async function confirmAlign() {
    if (!job || cells.length !== 3 || busy) return;
    setError(""); setBusy("儲存對位");
    try {
      const sheet = mkCell(); sheet.width = SHEET_CELL * 3;
      cells.forEach((c, i) => sheet.getContext("2d")!.drawImage(c, i * SHEET_CELL, 0));
      const form = new FormData();
      form.set("sheet", await toBlob(sheet), "sheet.png"); form.set("align", JSON.stringify({ adj, measures }));
      await postJson("/api/character/" + job.id + "/confirm", token, form);
      setSheetCells(cells); setJob({ ...job, status: "angles" }); setStage("angles"); setBusy("");
      void fillGrid(job.id);   // 確認後由系統自動一次補齊 8 個角度，不需要再按鈕
      return;
    } catch (cause) { setError(cause instanceof Error ? cause.message : "儲存失敗"); }
    finally { setBusy((b) => b === "儲存對位" ? "" : b); }
  }

  async function runAngle(jobId: string, deg: number) {
    await postJson("/api/character/" + jobId + "/angle", token, JSON.stringify({ deg, quality }), true);
    const c = await fetchCanvas(jobId, `a${String(deg).padStart(3, "0")}`, true);
    if (!c) throw new Error("讀不到生成的角度圖");
    setAi((prev) => ({ ...prev, [deg]: clean(c) }));
  }
  /** 其餘 8 個角度一次生成（一張 4×2 合圖，再切開）：比逐張生成便宜很多；個別不滿意再單獨補算。 */
  async function fillGrid(jobId = job?.id) {
    if (!jobId) return;
    setError(""); setBusy("8 個角度生成中"); setFailed([]);
    try {
      await postJson("/api/character/" + jobId + "/grid", token, JSON.stringify({ quality }), true);
      const g = await fetchCanvas(jobId, "grid", true);
      if (!g) throw new Error("讀不到生成的角度合圖，請按「重試」。");
      const cs = splitGrid(g).map((c) => clean(c));
      if (cs.length !== 8 || cs.some((c) => !measure(c))) throw new Error("合圖裡切不出 8 個完整人物，請按「重試」重新生成。");
      const next: Record<number, Canvas> = {}; AI_ANGLES.forEach((d, i) => { next[d] = cs[i]; });
      setAi(next); setStage("review");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "生成失敗，請稍後再試。"); setFailed([...AI_ANGLES]); }
    finally { setBusy(""); }
  }
  /** 逐張補還沒有的角度（同時最多 2 個，避免一次打爆額度）；失敗的記下來，可以單獨重算。 */
  async function fillAngles(only?: number, jobId = job?.id, have: Record<number, Canvas> = ai) {
    if (!jobId || (busy && !jobId)) return;
    setError(""); setBusy("補角度中"); setFailed([]);
    const todo = only ? [only] : AI_ANGLES.filter((deg) => !have[deg]);
    const bad: number[] = []; let firstError = "";
    const queue = [...todo];
    await Promise.all([0, 1].map(async () => {
      while (queue.length) { const deg = queue.shift()!; try { await runAngle(jobId, deg); } catch (cause) { bad.push(deg); firstError ||= cause instanceof Error ? cause.message : "生成失敗"; } }
    }));
    setFailed(bad); if (firstError) setError(`有 ${bad.length} 個角度失敗：${firstError}`);
    setBusy("");
    if (!bad.length) setStage("review");   // 只重算單一角度時也會回到檢查畫面
  }

  const frames = useMemo(() => sheetCells.length === 3 ? assembleFrames(sheetCells, ai) : [], [sheetCells, ai]);
  const turnRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const target = turnRef.current, frame = frames[turn];
    if (!target || !frame) return;
    const m = measure(frame); if (!m) return;
    const g = target.getContext("2d")!; g.clearRect(0, 0, target.width, target.height);
    g.fillStyle = "#e4eaef"; g.fillRect(0, 0, target.width, target.height);
    g.drawImage(placeCell(frame, m, 320, 290, 12), 0, 0);
  }, [frames, turn, stage]);

  const publishName = canAll ? target : myName;
  async function publish() {
    if (!job || busy || frames.some((f) => !f)) return;
    if (!publishName) { setError(canAll ? "請先選擇這套角色要發佈給誰。" : "找不到你的人物名字，請聯絡管理者。"); return; }
    if (canAll && !window.confirm(`確定要把這套角色發佈給「${publishName}」嗎？3D 辦公室裡的 ${publishName} 會換成新造型。`)) return;
    setError(""); setBusy("烘焙並上線");
    try {
      const all = frames as Canvas[];
      const small = bakeAtlas(all, 60), big = bakeAtlas(all, 240);
      const front = measure(all[0]) ? placeCell(all[0], measure(all[0])!, 320, 290, 12) : all[0];
      const form = new FormData();
      form.set("name", publishName); form.set("atlas", await toBlob(small), "atlas.png"); form.set("atlasHd", await toBlob(big), "atlas-hd.png"); form.set("avatar", avatarOf(front));
      await postJson("/api/character/" + job.id + "/publish", token, form);
      setJob({ ...job, publishedAs: publishName, target: publishName }); setStage("done"); onPublished?.();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "發佈失敗"); }
    finally { setBusy(""); }
  }

  // 管理者：從步驟列回到任何一步編輯（三視圖對位、補其餘角度…）；改完在最後一步重新按「確認上線」就會覆蓋預設
  async function goStage(i: number) {
    if (!job) return; setError("");
    if (i === 0) { setStage("upload"); return; }
    if (i === 1) { setBusy("讀取三視圖"); try { const v = await fetchCanvas(job.id, "views3"); if (v) { setViews(splitViews(v).map((c) => clean(c))); setStage("align"); } else setError("找不到這張的三視圖原圖。"); } finally { setBusy(""); } return; }
    if (i === 2) { setStage(Object.keys(ai).length === AI_ANGLES.length ? "review" : "angles"); return; }
    if (frames.length === 12 && frames.every(Boolean)) setStage("review"); else setError("角度還沒補齊，先到「補其餘角度」完成。");
  }
  async function makeMyDefault() {
    if (!job || busy) return; setError(""); setBusy("設定預設");
    try { const r = await postJson<{ name?: string }>(`/api/character/${job.id}/default`, token, JSON.stringify({ name: canAll ? (job.target || target) : undefined }), true); setJob({ ...job, publishedAs: r.name || job.target || "預設" }); onPublished?.(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "設定失敗"); }
    finally { setBusy(""); }
  }
  const nudge = (i: number, patch: Partial<Adjust>) => setAdj((prev) => prev.map((a, k) => k === i ? { ...a, ...patch } : a));
  const names = ["正面", "側面（朝右）", "背面"];

  return <section className="wk">
    <div className="section-head" style={{ marginTop: 26 }}><span className="step"><UserRound size={15} /></span><div><h2>生成角色</h2><p className="prompt-foot" style={{ margin: 0, fontSize: 11 }}>{departmentLabel}同仁：上傳個人照 → 三視圖對位 → 補其餘角度 → 上線到 3D 辦公室。</p></div></div>
    <ol className="persona-steps">{STEPS.map((label, index) => <li key={label} onClick={canAll && job && !busy && stage !== "loading" ? () => void goStage(index) : undefined} style={canAll && job ? { cursor: "pointer" } : undefined} title={canAll && job ? "管理者：回到這一步編輯" : undefined} className={index < stepIndex ? "done" : index === stepIndex ? "now" : stage === "done" ? "done" : ""}><span>{index < stepIndex || stage === "done" ? <Check size={13} /> : index + 1}</span>{label}</li>)}</ol>
    {error && <div className="error" role="alert">{error}</div>}

    {stage === "loading" && <div className="preview" style={{ marginTop: 14 }}><LoaderCircle className="spin" size={20} /> 讀取中…</div>}

    {stage === "upload" && <div className="workspace">
      <section className="control">
        <div className="section-head"><span className="step">01</span><h2>{job ? "重新生成三視圖" : "上傳照片，生成角色"}</h2></div>
        <div className="field-label">個人照片 <span>必填 · 1 張</span></div>
        <button className="drop" onClick={() => input.current?.click()} disabled={Boolean(busy)}><span className="upload-icon"><Upload size={22} /></span><strong>{file ? file.name : "拖曳或點擊上傳個人照"}</strong><span>清楚的正面或半身照最準</span><small>PNG / JPG / WebP · 10 MB 以內</small></button>
        <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f && f.size <= 10 * 1024 * 1024) setFile(f); e.target.value = ""; }} />
        {preview && <div className="thumbs"><div><img src={preview} alt="個人照" /><button onClick={() => setFile(null)} aria-label="移除照片" disabled={Boolean(busy)}><X size={13} /></button></div></div>}
        <label className="field-label" htmlFor="char-notes">提示詞 <span>選填 · 髮型、穿著、帽子、眼鏡都寫在這裡</span></label>
        <textarea id="char-notes" value={notes} maxLength={300} disabled={Boolean(busy)} placeholder="例如：短髮、戴黑框眼鏡、穿深藍襯衫" onChange={(e) => setNotes(e.target.value)} />
        <div className="prompt-foot"><span>帽子與眼鏡會直接畫在角色身上，不另外做配件。</span><span>{notes.length}/300</span></div>
        <div className="rules" style={{ marginTop: 18 }}><Check size={15} /><span>已套用固定規範：三視圖（正面、右側、背面）、透明背景</span></div>
        <button className="generate" onClick={() => void generate()} disabled={Boolean(busy) || !file} style={{ marginTop: 18 }}>{busy ? <><LoaderCircle size={19} className="spin" /><span>{busy}…{elapsed} 秒（約 1～3 分鐘）</span></> : <><Sparkles size={19} /><span>{job ? "重新生成三視圖" : "生成三視圖"}</span></>}</button>
        <small className="cost">使用 OpenAI 圖片模型生成，會產生 API 費用；每次生成都會記錄在「生成紀錄」。</small>
      </section>
      <section className="preview">
        <div className="section-head"><div className="preview-title"><span className="step">02</span><h2>製作流程</h2></div></div>
        <div className="guidance"><div><span>01 / VIEWS</span><b>三視圖＋自動對位</b><p>AI 先畫正面、側面、背面，系統自動量頭頂與腳底並對齊，你只要確認。</p></div><div><span>02 / ANGLES</span><b>一次補齊其餘角度</b><p>確認後用一張圖補齊其他 8 個角度，不滿意的角度可以單獨重算。</p></div></div>
        <div className="guidance"><div><span>03 / PUBLISH</span><b>上線到 3D 辦公室</b><p>檢查完按「確認上線」，頭像快照也一起更新。</p></div><div><span>04 / SETS</span><b>可以做很多套</b><p>每套都留在「我的角色」，隨時指定哪一套是預設。座位到「座位」分頁設定。</p></div></div>
      </section>
    </div>}

    {stage === "align" && views.length === 3 && <div className="preview" style={{ marginTop: 14 }}>
      <p className="persona-hint">已自動把三張圖縮成同高、腳底對齊、置中。紅線＝頭頂，綠線＝腳底，藍線＝中線。{diagnosis?.ok ? "檢查全部通過。" : ""}若頭和身體歪了，用下方滑桿微調；整體不對就回上一步重新生成。</p>
      {diagnosis && !diagnosis.ok && <ul className="persona-warn">{diagnosis.warnings.map((w) => <li key={w}>⚠ {w}</li>)}</ul>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
        {cells.map((cell, i) => <div key={i} style={{ background: "#e4eaef", borderRadius: 12, padding: 6 }}>
          <GuideCanvas cell={cell} />
          <b style={{ display: "block", textAlign: "center", margin: "4px 0" }}>{names[i]}</b>
          <label className="cp-f" style={{ display: "block", fontSize: 12 }}>大小<input type="range" min={0.85} max={1.15} step={0.005} value={adj[i].scale} onChange={(e) => nudge(i, { scale: Number(e.target.value) })} style={{ width: "100%" }} /></label>
          <label className="cp-f" style={{ display: "block", fontSize: 12 }}>左右<input type="range" min={-0.08} max={0.08} step={0.002} value={adj[i].dx} onChange={(e) => nudge(i, { dx: Number(e.target.value) })} style={{ width: "100%" }} /></label>
          <label className="cp-f" style={{ display: "block", fontSize: 12 }}>上下<input type="range" min={-0.06} max={0.06} step={0.002} value={adj[i].dy} onChange={(e) => nudge(i, { dy: Number(e.target.value) })} style={{ width: "100%" }} /></label>
        </div>)}
      </div>
      <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
        <button className="generate" onClick={() => void confirmAlign()} disabled={Boolean(busy)}>{busy ? <LoaderCircle size={19} className="spin" /> : "對位正確，開始補其他角度"}</button>
        <button onClick={() => setStage("upload")} disabled={Boolean(busy)}>不滿意，重新生成三視圖{job ? `（已用 ${job.startRuns} 次）` : ""}</button>
      </div>
    </div>}

    {stage === "angles" && <div className="preview" style={{ marginTop: 14, textAlign: "center", padding: "36px 20px" }}>
      <LoaderCircle size={44} className="spin" style={{ margin: "0 auto" }} />
      <h3 style={{ margin: "14px 0 4px" }}>{busy ? "正在製作你的角色…" : failed.length ? "有幾個角度沒做成功" : "準備中…"}</h3>
      <p className="persona-hint">AI 正依你確認的三視圖，一次畫出其餘 8 個角度，約 1～3 分鐘，完成會自動進入檢查畫面；不滿意的角度之後可以單獨補算。{!busy && Object.keys(ai).length ? `已完成的 ${Object.keys(ai).length} 個角度都已存起來，只會補算缺的，不會重複計費。` : "做好的角度會即時存起來；中途離開，下次回來只補缺的。"}</p>
      <div style={{ height: 10, borderRadius: 99, background: "#e4eaef", overflow: "hidden", margin: "14px auto", maxWidth: 420 }}><div style={{ height: "100%", width: `${Object.keys(ai).length / 8 * 100}%`, background: "linear-gradient(90deg,#43d86c,#1aa844)", transition: "width .4s" }} /></div>
      <p style={{ fontWeight: 700 }}>已完成 {Object.keys(ai).length} / 8　{busy ? `（${elapsed} 秒）` : ""}</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(8, 1fr)", gap: 6, maxWidth: 560, margin: "10px auto" }}>{AI_ANGLES.map((deg) => <div key={deg} style={{ fontSize: 11 }}>{ai[deg] ? <Thumb canvas={ai[deg]} /> : <div style={{ aspectRatio: "1", background: "#e4eaef", borderRadius: 8, display: "grid", placeItems: "center" }}>{failed.includes(deg) ? "✕" : busy ? <LoaderCircle size={12} className="spin" /> : ""}</div>}{deg}°</div>)}</div>
      {!busy && <button className="generate" onClick={() => void (Object.keys(ai).length ? fillAngles() : fillGrid())}>{failed.length ? "重試" : "開始生成其餘角度"}</button>}
    </div>}

    {stage === "review" && <div className="preview" style={{ marginTop: 14 }}>
      <p className="persona-hint">拖動滑桿轉一圈檢查每個角度：頭、帽子、眼鏡、衣服是不是和三視圖一致，高度與腳底有沒有跳動。哪個角度壞了就單獨重算；都沒問題按「確認上線」。</p>
      {canAll && <label style={{ display: "block", fontSize: 12, marginBottom: 6 }}>角度品質（管理者測試）：<select value={quality} onChange={(e) => setQuality(e.target.value as "medium" | "high")}><option value="medium">medium（省錢）</option><option value="high">high（較細緻）</option></select>　<button onClick={() => void fillGrid()} disabled={Boolean(busy)}>用此品質整組重算 8 個角度</button></label>}
      <canvas ref={turnRef} width={320} height={320} style={{ width: 320, maxWidth: "100%", borderRadius: 14, display: "block", margin: "0 auto" }} />
      <input type="range" min={0} max={ANGLES - 1} step={1} value={turn} onChange={(e) => setTurn(Number(e.target.value))} style={{ width: "100%", marginTop: 8 }} />
      <p style={{ textAlign: "center", fontWeight: 700 }}>{turn * 30}°</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 6 }}>{frames.map((f, k) => f ? <button key={k} onClick={() => setTurn(k)} style={{ border: k === turn ? "2px solid #2fbf57" : "2px solid transparent", borderRadius: 8, padding: 2, background: "#fff" }}><Thumb canvas={f} /><small>{k * 30}°</small></button> : null)}</div>
      {AI_ANGLES.includes(turn * 30) && <button onClick={() => void fillAngles(turn * 30)} disabled={Boolean(busy)}>{busy ? <LoaderCircle size={16} className="spin" /> : `重算 ${turn * 30}° 這個角度（已用 ${job?.angles[turn * 30] ?? 1} 次）`}</button>}
      {canAll && <label className="field-label" style={{ display: "block", marginTop: 12 }}>發佈給誰（管理者必選）<select value={target} onChange={(e) => setTarget(e.target.value)} style={{ display: "block", width: "100%", marginTop: 4, padding: 8, borderRadius: 10 }}><option value="">請選擇人物…</option>{targets.map((n) => <option key={n} value={n}>{n}</option>)}</select></label>}
      <button className="generate" onClick={() => void publish()} disabled={Boolean(busy)}>{busy ? <><LoaderCircle size={19} className="spin" />{busy}…</> : "確認無誤，上線到 3D 辦公室"}</button>
    </div>}

    {stage === "done" && <div className="preview" style={{ marginTop: 14 }}>
      <div className="section-head"><div className="preview-title"><span className="step"><Check size={14} /></span><h2>{job?.publishedAs ? `已上線 · 預設中（${job.publishedAs}）` : "這套已完成"}</h2></div></div>
      <p className="preview-bottom"><span>重新整理 3D 辦公室（約 1 分鐘內）就會看到新角色，首頁頭像框也會更新。要固定坐在某個位置，請到「座位」分頁；不選就在辦公室自由走動。</span></p>
      <div className="job-actions">
        {job && !job.publishedAs && <button className="generate" style={{ width: "auto", padding: "12px 20px" }} onClick={() => void makeMyDefault()} disabled={Boolean(busy)}>{busy ? <LoaderCircle size={19} className="spin" /> : <Check size={17} />}<span>把這套設為預設角色</span></button>}
        <button className="open-btn" onClick={() => onNew?.()}>＋ 再新增一套角色</button>
      </div>
    </div>}
  </section>;
}

function GuideCanvas({ cell }: { cell: Canvas }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const t = ref.current; if (!t) return;
    const g = t.getContext("2d")!, k = t.width / SHEET_CELL;
    g.clearRect(0, 0, t.width, t.height); g.drawImage(cell, 0, 0, t.width, t.height);
    const line = (x0: number, y0: number, x1: number, y1: number, color: string) => { g.strokeStyle = color; g.lineWidth = 1.5; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); };
    line(0, (SHEET_CELL - SHEET_FOOT - SHEET_HEIGHT) * k, t.width, (SHEET_CELL - SHEET_FOOT - SHEET_HEIGHT) * k, "#e64a5e");
    line(0, (SHEET_CELL - SHEET_FOOT) * k, t.width, (SHEET_CELL - SHEET_FOOT) * k, "#2bb468");
    line(t.width / 2, 0, t.width / 2, t.height, "#2f9dbf");
  }, [cell]);
  return <canvas ref={ref} width={200} height={200} style={{ width: "100%", display: "block" }} />;
}

function Thumb({ canvas }: { canvas: Canvas }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const t = ref.current; if (!t) return;
    const g = t.getContext("2d")!, m = measure(canvas); g.clearRect(0, 0, t.width, t.height);
    g.fillStyle = "#e4eaef"; g.fillRect(0, 0, t.width, t.height);
    if (m) g.drawImage(placeCell(canvas, m, 96, 88, 4), 0, 0);
  }, [canvas]);
  return <canvas ref={ref} width={96} height={96} style={{ width: "100%", display: "block", borderRadius: 8 }} />;
}
