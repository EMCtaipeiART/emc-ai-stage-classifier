"use client";

import { useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";

// 角色工坊管理（管理者與 Machi）：看所有人的製作單，開啟繼續編輯、改發佈給誰、取消上線、刪除。
type Job = { id: string; ownerName: string; status: string; prompt: string; startRuns: number; anglesDone: number; costUsd: number; updatedAt: string; publishedAs: string };
const STATUS: Record<string, string> = { views3: "對位中", angles: "補角度／檢查中", published: "已上線" };

export default function CharacterAdmin({ token, onOpen, refreshKey }: { token: string; onOpen: (id: string) => void; refreshKey: number }) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [targets, setTargets] = useState<string[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const headers = { "x-emc-editor-token": token };

  async function load() {
    try {
      const r = await fetch("/api/character?all=1", { headers, cache: "no-store" });
      const p = await r.json() as { jobs?: Job[]; targets?: string[]; error?: string };
      if (p.error) throw new Error(p.error);
      setJobs(p.jobs || []); setTargets(p.targets || []); setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "讀取失敗"); }
  }
  useEffect(() => { void load(); }, [token, refreshKey]);

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

  return <section className="history" style={{ marginBottom: 18 }}>
    <div className="section-head"><div className="preview-title"><h2>角色製作單管理</h2></div><button className="refresh" onClick={() => void load()}>重新整理</button></div>
    {error && <div className="error">{error}</div>}
    {!jobs.length ? <p className="empty-note">還沒有人建立角色製作單。</p> : <div style={{ overflowX: "auto" }}><table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
      <thead><tr style={{ textAlign: "left" }}><th>建立者</th><th>狀態</th><th>角度</th><th>費用</th><th>發佈給</th><th>更新</th><th>操作</th></tr></thead>
      <tbody>{jobs.map((job) => <tr key={job.id} style={{ borderTop: "1px solid #0001" }}>
        <td>{job.ownerName || "（無名）"}</td><td>{STATUS[job.status] || job.status}</td><td>{job.anglesDone}/8</td><td>US${job.costUsd.toFixed(2)}</td>
        <td>{job.publishedAs || "—"}</td><td>{job.updatedAt.slice(5, 16)}</td>
        <td style={{ whiteSpace: "nowrap" }}>{busy === job.id ? <LoaderCircle size={14} className="spin" /> : <>
          <button onClick={() => onOpen(job.id)}>開啟</button>{" "}
          {job.publishedAs && <><select defaultValue="" onChange={(e) => { const name = e.target.value; e.target.value = ""; if (name) void act(job.id, { method: "PATCH", body: JSON.stringify({ action: "move", name }) }, `改成發佈給「${name}」？原本的「${job.publishedAs}」會退回舊造型。`); }}><option value="">改發佈給…</option>{targets.map((n) => <option key={n} value={n}>{n}</option>)}</select>{" "}
            <button onClick={() => void act(job.id, { method: "PATCH", body: JSON.stringify({ action: "unpublish" }) }, `取消「${job.publishedAs}」的上線？3D 辦公室會退回舊造型。`)}>取消上線</button>{" "}</>}
          <button onClick={() => void act(job.id, { method: "DELETE" }, `確定刪除這張製作單？圖片會一併刪除${job.publishedAs ? `，「${job.publishedAs}」也會取消上線` : ""}，無法復原。`)} style={{ color: "#c0392b" }}>刪除</button></>}</td>
      </tr>)}</tbody></table></div>}
  </section>;
}
