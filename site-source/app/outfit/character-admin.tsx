"use client";

import { useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";

// 角色工坊管理（管理者與 Machi）：看所有人的製作單，開啟繼續編輯、改發佈給誰、取消上線、刪除。
type Job = { id: string; target?: string; ownerName: string; status: string; prompt: string; startRuns: number; anglesDone: number; costUsd: number; updatedAt: string; publishedAs: string };
const STATUS: Record<string, string> = { views3: "對位中", angles: "補角度／檢查中", published: "已完成" };

export default function CharacterAdmin({ token, onOpen, refreshKey, canAll = false }: { token: string; onOpen: (id: string) => void; refreshKey: number; canAll?: boolean }) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [targets, setTargets] = useState<string[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const headers = { "x-emc-editor-token": token };

  async function load() {
    try {
      const r = await fetch(canAll ? "/api/character?all=1" : "/api/character?mine=1", { headers, cache: "no-store" });
      const p = await r.json() as { jobs?: Job[]; targets?: string[]; error?: string };
      if (p.error) throw new Error(p.error);
      setJobs(p.jobs || []); setTargets(p.targets || []); setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "讀取失敗"); }
  }
  useEffect(() => { if (token) void load(); }, [token, refreshKey, canAll]);

  async function act(id: string, init: RequestInit, confirmText: string) {
    if (!window.confirm(confirmText)) return;
    setBusy(id); setError("");
    try {
      const r = await fetch(`/api/character/${id}`, { ...init, headers: { ...headers, "Content-Type": "application/json" } });
      const p = await r.json() as { error?: string };
      if (!r.ok || p.error) throw new Error(p.error || "操作失敗");
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "操作失敗"); }
    finally { setBusy(""); }
  }

  async function syncAvatar(id: string) {
    setBusy(id); setError("");
    try {
      const r = await fetch(`/api/character/${id}/default`, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({}) });
      const p = await r.json() as { error?: string; avatarSaved?: boolean };
      if (!r.ok || p.error) throw new Error(p.error || "操作失敗");
      if (!p.avatarSaved) throw new Error("頭像沒有存進去（可能這個人不是設計師、或你沒有權限替他更新）。");
      window.alert("頭像已更新，首頁重新整理後就會看到。");
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "操作失敗"); }
    finally { setBusy(""); }
  }

  return <section className="history" style={{ marginTop: 18 }}>
    <div className="section-head"><div className="preview-title"><h2>{canAll ? "角色製作單管理" : "我已做好的角色"}</h2></div><span style={{ display: "flex", gap: 8 }}><button className="open-btn" onClick={() => onOpen("new")}>＋ 新增一套角色</button><button className="refresh" onClick={() => void load()}>重新整理</button></span></div>
    <p className="history-total">{canAll ? "全部人員的角色製作單。「開啟／編輯」可回到三視圖對位、補其餘角度重新修改。" : "每做完一套都會留在這裡，隨時指定哪一套是 3D 辦公室裡的預設角色。"}</p>
    {error && <div className="error">{error}</div>}
    {!jobs.length ? <p className="empty-note">還沒有角色。按右上角「新增一套角色」上傳照片開始製作。</p> : <div className="library">{jobs.map((job) => <article key={job.id} className="lib-card">
      <div className="lib-thumb"><JobThumb id={job.id} token={token} /></div>
      <div className="lib-main"><div className="lib-title"><strong>{job.target || job.ownerName || "（未指定）"}</strong>
        {job.publishedAs && <span className="badge-status completed">✓ 預設中</span>}<span className="badge-status">{STATUS[job.status] || job.status}</span>{canAll && job.ownerName && job.target && job.ownerName !== job.target && <span className="badge-status">建立者 {job.ownerName}</span>}</div>
        <small>角度 {job.anglesDone}/8 · 更新 {job.updatedAt.slice(5, 16)}{canAll ? ` · 費用 US$${job.costUsd.toFixed(2)}` : ""}</small></div>
      <div className="lib-actions">{busy === job.id ? <LoaderCircle size={16} className="spin" /> : <>
        <button onClick={() => onOpen(job.id)}>{canAll ? "開啟／編輯" : "查看"}</button>
        {job.status === "published" && !job.publishedAs && <button className="primary" onClick={() => void act(`${job.id}/default`, { method: "POST", body: JSON.stringify({}) }, `把這套設為${job.target || "你"}的預設角色？3D 辦公室與頭像會換成這套。`)}>設為預設</button>}
        {job.status === "published" && job.publishedAs && <button onClick={() => void syncAvatar(job.id)}>更新頭像</button>}
        {canAll && job.publishedAs && <><select aria-label="改發佈給" defaultValue="" onChange={(e) => { const name = e.target.value; e.target.value = ""; if (name) void act(job.id, { method: "PATCH", body: JSON.stringify({ action: "move", name }) }, `改成發佈給「${name}」？原本的「${job.publishedAs}」會退回舊造型。`); }}><option value="">改發佈給…</option>{targets.filter((n) => n !== job.publishedAs).map((n) => <option key={n} value={n}>{n}</option>)}</select>
          <button onClick={() => void act(job.id, { method: "PATCH", body: JSON.stringify({ action: "unpublish" }) }, `取消「${job.publishedAs}」的上線？3D 辦公室會退回舊造型。`)}>取消上線</button></>}
        {!(job.publishedAs && !canAll) && <button className="danger" onClick={() => void act(job.id, { method: "DELETE" }, `確定刪除這張製作單？圖片會一併刪除${job.publishedAs ? `，「${job.publishedAs}」也會取消上線` : ""}，無法復原。`)}>刪除</button>}</>}</div>
    </article>)}</div>}
  </section>;
}

/** 縮圖：圖片要帶登入 token，所以用 fetch 取回再顯示（沒有就空白）。 */
function JobThumb({ id, token }: { id: string; token: string }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    let url = "", dead = false;
    fetch(`/api/character/${id}/asset/sheet.png`, { headers: { "x-emc-editor-token": token }, cache: "no-store" }).then((r) => r.ok ? r.blob() : Promise.reject(new Error("no"))).then((b) => { if (dead) return; url = URL.createObjectURL(b); setSrc(url); }).catch(() => undefined);
    return () => { dead = true; if (url) URL.revokeObjectURL(url); };
  }, [id, token]);
  return src ? <img src={src} alt="" /> : null;
}
