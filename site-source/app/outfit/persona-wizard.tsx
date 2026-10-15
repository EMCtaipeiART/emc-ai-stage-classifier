"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, LoaderCircle, Upload, UserRound } from "lucide-react";

// 個人形象精靈（企劃／專案人員第一次進服裝頁）：01 上傳個人照 → 02 頭像與身體各生成三個、各挑一個 → 03 頭像對位 → 04 身體拼接 → 完成。
// 03、04 沿用「頭像」與「服裝」原本的對位／拼接畫面（手法完全一樣），這裡只負責串起步驟與進度。測試期生成不扣平台幣。
export type PersonaState = { step: string; headItemId: string; outfitItemId: string; completed: boolean };
type Candidate = { itemId: string; images: string[]; pick: number };
type ItemLite = { id: string; status: string; kind?: string; bodyUrl?: string; variant?: number };

async function generateOne(token: string, kind: "head" | "outfit", file: File, notes: string): Promise<Candidate> {
  const form = new FormData();
  form.set("kind", kind); form.set("onboarding", "1"); form.set("description", notes.trim());
  form.append("images", file);
  const response = await fetch("/api/outfit", { method: "POST", headers: { "x-emc-editor-token": token }, body: form });
  const raw = (await response.text()).trim();
  let payload: { error?: string; itemId?: string; images?: string[] };
  try { payload = JSON.parse(raw); } catch { throw new Error(response.status === 413 ? "附件太大，請壓縮後再試。" : `伺服器回應異常（${response.status}）`); }
  if (!response.ok || payload.error || !payload.images?.length || !payload.itemId) throw new Error(payload.error || "生成失敗，請稍後再試。");
  return { itemId: payload.itemId, images: payload.images, pick: 0 };
}

const STEPS = ["上傳個人照", "挑頭像與身體", "頭像對位", "身體拼接"];

export default function PersonaWizard({ token, persona, setPersona, onOpenHead, onOpenOutfit, onFinished, departmentLabel }: {
  token: string; persona: PersonaState; setPersona: (next: PersonaState) => void; departmentLabel: string;
  onOpenHead: (itemId: string) => void; onOpenOutfit: (itemId: string) => void; onFinished: () => void;
}) {
  const auth = useMemo(() => ({ "x-emc-editor-token": token }), [token]);
  const [file, setFile] = useState<File | null>(null);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState("");
  const [head, setHead] = useState<Candidate | null>(null);
  const [body, setBody] = useState<Candidate | null>(null);
  const [items, setItems] = useState<ItemLite[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const restoring = useRef(false);
  const preview = useMemo(() => file ? URL.createObjectURL(file) : "", [file]);
  const stepIndex = persona.step === "pick" ? 1 : persona.step === "fit" ? (items.find((i) => i.id === persona.headItemId)?.status === "completed" ? 3 : 2) : persona.step === "done" ? 4 : (head && body ? 1 : 0);

  useEffect(() => { if (!busy) return; const t = window.setInterval(() => setElapsed((n) => n + 1), 1000); return () => window.clearInterval(t); }, [busy]);
  async function loadItems() {
    try { const r = await fetch("/api/outfit/items", { headers: auth }); const p = await r.json() as { items?: ItemLite[] }; setItems(p.items || []); } catch { /* 下次再讀 */ }
  }
  useEffect(() => { void loadItems(); const t = window.setInterval(() => void loadItems(), 4000); return () => window.clearInterval(t); }, [token]);
  const headDone = items.find((i) => i.id === persona.headItemId)?.status === "completed";
  const outfitDone = items.find((i) => i.id === persona.outfitItemId)?.status === "completed";
  useEffect(() => {
    if (persona.step === "fit" && headDone && outfitDone && !persona.completed) {
      void fetch("/api/outfit/persona", { method: "POST", headers: { "Content-Type": "application/json", ...auth }, body: JSON.stringify({ step: "done", complete: true }) }).then((r) => r.json() as Promise<{ persona?: PersonaState }>).then((p) => { if (p.persona) setPersona(p.persona); onFinished(); }).catch(() => undefined);
    }
  }, [persona.step, headDone, outfitDone]);

  const headExists = items.some((i) => i.id === persona.headItemId);
  const outfitExists = items.some((i) => i.id === persona.outfitItemId);
  // 重新整理或回來時：把之前生成的三個候選從紀錄裡讀回來（每人只能生成一次，不能因為頁面重新載入就丟掉）
  useEffect(() => {
    if (persona.step !== "pick" || !headExists || !outfitExists || (head && body) || restoring.current) return;
    restoring.current = true;
    (async () => {
      try {
        const load = async (id: string): Promise<Candidate | null> => {
          const item = items.find((entry) => entry.id === id);
          if (!item?.bodyUrl) return null;
          const images: string[] = [];
          for (let k = 0; k < 3; k += 1) {
            const blob = await fetch(`${item.bodyUrl.replace(/v=\d+$/, "")}v=${k}`, { headers: auth }).then((r) => r.ok ? r.blob() : Promise.reject(new Error("img"))).catch(() => null);
            if (blob) images.push(URL.createObjectURL(blob));
          }
          return images.length ? { itemId: id, images, pick: Math.min(item.variant || 0, images.length - 1) } : null;
        };
        const [h, b] = await Promise.all([load(persona.headItemId), load(persona.outfitItemId)]);
        if (h && b) { setHead(h); setBody(b); }
      } finally { restoring.current = false; }
    })();
  }, [persona.step, headExists, outfitExists, items.length]);
  async function generate() {
    if (!file || busy) return;
    setBusy(true); setElapsed(0); setError("");
    try {
      // 每人每種只能生成一次：已經有的（例如上次只成功一半）不再重生成，只補缺的
      const [h, b] = await Promise.all([
        headExists ? Promise.resolve(null) : generateOne(token, "head", file, notes),
        outfitExists ? Promise.resolve(null) : generateOne(token, "outfit", file, notes),
      ]);
      if (h) setHead(h); if (b) setBody(b);
      const r = await fetch("/api/outfit/persona", { method: "POST", headers: { "Content-Type": "application/json", ...auth }, body: JSON.stringify({ ...(h ? { headItemId: h.itemId } : {}), ...(b ? { outfitItemId: b.itemId } : {}), step: "pick" }) });
      const p = await r.json() as { persona?: PersonaState }; if (p.persona) setPersona(p.persona);
      void loadItems();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "生成失敗，請稍後再試。"); void loadItems(); }
    finally { setBusy(false); }
  }
  async function next() {
    if (!head || !body || busy) return;
    setBusy(true); setError("");
    try {
      for (const [c] of [[head], [body]] as Array<[Candidate]>) {
        const r = await fetch(`/api/outfit/items/${c.itemId}`, { method: "PATCH", headers: { "Content-Type": "application/json", ...auth }, body: JSON.stringify({ variant: c.pick }) });
        if (!r.ok) throw new Error("儲存選擇失敗，請再試一次。");
      }
      const r = await fetch("/api/outfit/persona", { method: "POST", headers: { "Content-Type": "application/json", ...auth }, body: JSON.stringify({ step: "fit" }) });
      const p = await r.json() as { persona?: PersonaState }; if (p.persona) setPersona(p.persona);
      onOpenHead(persona.headItemId || head.itemId);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "操作失敗"); }
    finally { setBusy(false); }
  }

  return <section className="persona">
    <div className="persona-head"><span className="step"><UserRound size={16} /></span><div><h2>建立你的角色</h2><p>{departmentLabel}同仁第一次使用：上傳一張個人照，生成頭像與身體各三個，挑好後拼接成你的角色。<b>每人只有一次生成機會，目前不扣平台幣</b>，請先選好照片再生成。</p></div></div>
    <ol className="persona-steps">{STEPS.map((label, index) => <li key={label} className={index < stepIndex ? "done" : index === stepIndex ? "now" : ""}><span>{index < stepIndex ? <Check size={13} /> : index + 1}</span>{label}</li>)}</ol>
    {error && <div className="error" role="alert">{error}</div>}

    {stepIndex === 0 && <div className="persona-card">
      <button className="drop" onClick={() => input.current?.click()} disabled={busy}><span className="upload-icon"><Upload size={22} /></span><strong>{file ? file.name : "選一張你的個人照"}</strong><small>清楚的正面或半身照最準，PNG／JPG／WebP，10MB 內</small></button>
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f && f.size <= 10 * 1024 * 1024) setFile(f); e.target.value = ""; }} />
      {preview && <div className="thumbs"><div><img src={preview} alt="個人照" /></div></div>}
      <label className="field-label" htmlFor="persona-notes">補充說明 <span>選填：想要的髮型、穿著、配件…</span></label>
      <textarea id="persona-notes" value={notes} maxLength={300} disabled={busy} placeholder="例如：短髮、戴黑框眼鏡、喜歡穿襯衫" onChange={(e) => setNotes(e.target.value)} />
      <button className="generate" onClick={() => void generate()} disabled={busy || !file}>{busy ? <><LoaderCircle size={19} className="spin" />生成中…{elapsed} 秒（頭像與身體同時進行，約 1～3 分鐘）</> : (headExists || outfitExists ? "補生成缺少的部分" : "生成頭像與身體（各 3 個）")}</button>
    </div>}

    {stepIndex === 1 && head && body && <div className="persona-card">
      <p className="persona-hint">頭像與身體各挑一個你最喜歡的。下一步會先對位頭像，再把頭像拼到身體上。</p>
      {([["頭像", head, setHead], ["身體", body, setBody]] as Array<[string, Candidate, (c: Candidate) => void]>).map(([label, cand, set]) => <div key={label} className="persona-row"><b>{label}</b><div className="persona-picks">{cand.images.map((src, index) => <button key={index} className={cand.pick === index ? "on" : ""} onClick={() => set({ ...cand, pick: index })} aria-label={`${label} ${index + 1}`}><img src={src} alt={`${label} ${index + 1}`} /></button>)}</div></div>)}
      <button className="generate" onClick={() => void next()} disabled={busy}>{busy ? <LoaderCircle size={19} className="spin" /> : "下一步：頭像對位"}</button>
    </div>}

    {stepIndex === 1 && !(head && body) && persona.step === "pick" && <div className="persona-card"><p>你已經生成過了。要重新挑選請回到上一次的頁面，或直接繼續：</p>
      <button className="generate" onClick={() => onOpenHead(persona.headItemId)}>繼續：頭像對位</button></div>}

    {(stepIndex === 2 || stepIndex === 3) && <div className="persona-card">
      <div className={"persona-todo" + (headDone ? " done" : "")}><span>{headDone ? <Check size={14} /> : "3"}</span><div><b>頭像對位</b><small>用頭像編輯畫面把頭對準，存檔完成。</small></div><button onClick={() => onOpenHead(persona.headItemId)}>{headDone ? "再編輯" : "開始對位"}</button></div>
      <div className={"persona-todo" + (outfitDone ? " done" : "")}><span>{outfitDone ? <Check size={14} /> : "4"}</span><div><b>身體拼接</b><small>把頭像拼到身體上、微調位置，存檔完成。{headDone ? "" : "（先完成頭像對位）"}</small></div><button disabled={!headDone} onClick={() => onOpenOutfit(persona.outfitItemId)}>{outfitDone ? "再編輯" : "開始拼接"}</button></div>
      <p className="persona-hint">兩項都完成後會自動結束這個流程，之後進服裝頁就是一般的服裝製作畫面。</p>
    </div>}
  </section>;
}
