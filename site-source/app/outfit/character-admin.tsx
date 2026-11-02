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

  return <section className="history" style={{ marginBottom: 18 }}>
    <div className="section-head"><div className="preview-title"><h2>{canAll ? "角色製作單管理" : "我的角色"}</h2></div><span style={{ display: "flex", gap: 8 }}><button className="refresh" onClick={() => onOpen("new")}>＋ 新增一套角色</button><button className="refresh" onClick={() => void load()}>重新整理</button></span></div>
    {error && <div className="error">{error}</div>}
    {!jobs.length ? <p className="empty-note">還沒有角色。按右上角「新增一套角色」上傳照片開始製作；之後做好的每一套都會列在這裡，可以隨時指定哪一套是預設。</p> : <div style={{ overflowX: "auto" }}><table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
      <thead><tr style={{ textAlign: "left" }}>{canAll && <th>建立者</th>}<th>狀態</th><th>角度</th>{canAll && <th>費用</th>}<th>預設中</th><th>更新</th><th>操作</th></tr></thead>
      <tbody>{jobs.map((job) => <tr key={job.id} style={{ borderTop: "1px solid #0001" }}>
        {canAll && <td>{job.ownerName || "（無名）"}</td>}<td>{STATUS[job.status] || job.status}</td><td>{job.anglesDone}/8</td>{canAll && <td>US${job.costUsd.toFixed(2)}</td>}
        <td>{job.publishedAs ? <b style={{ color: "#1aa844" }}>✓ {job.publishedAs}</b> : "—"}</td><td>{job.updatedAt.slice(5, 16)}</td>
        <td style={{ whiteSpace: "nowrap" }}>{busy === job.id ? <LoaderCircle size={14} className="spin" /> : <>
          <button onClick={() => onOpen(job.id)}>{canAll ? "開啟／編輯" : "查看"}</button>{" "}
          {job.status === "published" && !job.publishedAs && <><button onClick={() => void act(`${job.id}/default`, { method: "POST", body: JSON.stringify({}) }, `把這套設為${job.target || "你"}的預設角色？3D 辦公室與頭像會換成這套。`)}>設為預設</button>{" "}</>}
          {canAll && job.publishedAs && <><select defaultValue="" onChange={(e) => { const name = e.target.value; e.target.value = ""; if (name) void act(job.id, { method: "PATCH", body: JSON.stringify({ action: "move", name }) }, `改成發佈給「${name}」？原本的「${job.publishedAs}」會退回舊造型。`); }}><option value="">改發佈給…</option>{targets.map((n) => <option key={n} value={n}>{n}</option>)}</select>{" "}
            <button onClick={() => void act(job.id, { method: "PATCH", body: JSON.stringify({ action: "unpublish" }) }, `取消「${job.publishedAs}」的上線？3D 辦公室會退回舊造型。`)}>取消上線</button>{" "}</>}
          <button onClick={() => void act(job.id, { method: "DELETE" }, `確定刪除這張製作單？圖片會一併刪除${job.publishedAs ? `，「${job.publishedAs}」也會取消上線` : ""}，無法復原。`)} style={{ color: "#c0392b" }}>刪除</button></>}</td>
      </tr>)}</tbody></table></div>}
  </section>;
}
