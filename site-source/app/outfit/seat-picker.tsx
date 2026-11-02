"use client";

import { useEffect, useState } from "react";

// 座位圖：依五樓、四樓的座位縮圖點選角色要坐的位置（會議室、茶水間不算座位）。沒選＝在辦公室自由走動，隨時可以回來改。
// 座位資料與座標在 lib/seat-layout.ts（量自 3D 辦公室的實際椅子）。
import { SEATS_4F, SEATS_5F, desksOf, type SeatPos } from "@/lib/seat-layout";
const FX4 = 3600;
// 非座位的區域（虛線框，只當方位提示）：[x, z, 寬, 高, 文字]；四樓座標已扣掉 3600 偏移
const ZONES_5: Array<[number, number, number, number, string]> = [[6, -60, 1189, 290, "廁所／會議室 A／電梯"], [6, 1050, 1189, 500, "會議室 B／C／D・茶水間"]];
const ZONES_4: Array<[number, number, number, number, string]> = [[-90, -90, 1500, 360, "電梯／廁所／茶水間（長桌）"], [830, 400, 300, 320, "會議室 H"], [640, 1330, 440, 200, "會議室 F／G"]];
const view5 = { x0: 0, z0: -80, w: 1201, h: 1640, seats: SEATS_5F, desks: desksOf(SEATS_5F), zones: ZONES_5, r: 26, font: 54 };
const view4 = { x0: -100, z0: -100, w: 1530, h: 1700, seats: SEATS_4F.map((s) => ({ ...s, x: s.x - FX4 })), desks: desksOf(SEATS_4F).map((d) => ({ ...d, x: d.x - FX4 })), zones: ZONES_4, r: 24, font: 48 };

type SeatData = { fixed: Record<string, string>; seats: Record<string, string>; me: string; targets: string[] };

export default function SeatPicker({ token, canAll, defaultName = "" }: { token: string; canAll: boolean; defaultName?: string }) {
  const [data, setData] = useState<SeatData | null>(null);
  const [name, setName] = useState(defaultName);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [floor, setFloor] = useState<5 | 4>(5);
  const headers = { "x-emc-editor-token": token };

  async function load() {
    try {
      const r = await fetch("/api/character/seat", { headers, cache: "no-store" });
      const p = await r.json() as SeatData & { error?: string };
      if (p.error) throw new Error(p.error);
      setData(p); setName((n) => n || defaultName || p.me); setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "讀取失敗"); }
  }
  useEffect(() => { if (token) void load(); }, [token]);

  async function choose(seat: string) {
    if (!data || !name || busy) return;
    setBusy(true); setError("");
    try {
      const r = await fetch("/api/character/seat", { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ name, seat }) });
      const p = await r.json() as { error?: string };
      if (!r.ok || p.error) throw new Error(p.error || "設定失敗");
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "設定失敗"); }
    finally { setBusy(false); }
  }

  if (!data) return <section className="persona-card">{error ? <div className="error">{error}</div> : "讀取座位圖…"}</section>;
  const mine = data.seats[name] || "";
  const ownerOf = (key: string) => Object.entries(data.fixed).find(([, s]) => s === key)?.[0] || Object.entries(data.seats).find(([, s]) => s === key)?.[0] || "";
  const fixedName = Object.keys(data.fixed).includes(name);
  const view = floor === 5 ? view5 : view4;

  return <section className="persona-card">
    <h3 style={{ margin: "0 0 4px" }}>座位圖</h3>
    <p className="persona-hint">點一個綠色的位置，角色上線後就固定坐在那裡；不選就在辦公室自由走動，之後隨時可以回來改。會議室、茶水間不能當座位。</p>
    {error && <div className="error" role="alert">{error}</div>}
    <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", margin: "8px 0" }}>
      {canAll && <label>設定誰的座位：<select value={name} onChange={(e) => setName(e.target.value)}>{data.targets.map((n) => <option key={n} value={n}>{n}</option>)}</select></label>}
      {!canAll && <b>{name}</b>}
      <span>目前：{fixedName ? "3D 辦公室固定座位" : mine ? seatLabel(mine) : "自由走動"}</span>
      {mine && <button onClick={() => void choose("")} disabled={busy}>清除（自由走動）</button>}
      <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>{([5, 4] as const).map((f) => <button key={f} onClick={() => setFloor(f)} style={{ fontWeight: floor === f ? 800 : 500, outline: floor === f ? "2px solid #2fbf57" : "none" }}>{f}F</button>)}</span>
    </div>
    {fixedName ? <p className="persona-hint">{name} 在 3D 辦公室有固定座位，不能另外指定。</p> : <svg viewBox={`${view.x0} ${view.z0} ${view.w} ${view.h}`} style={{ width: "100%", maxWidth: floor === 5 ? 520 : 640, display: "block", margin: "0 auto", background: "#eef2f5", borderRadius: 12 }}>
      {view.zones.map(([x, z, w, h, label]) => <g key={label}><rect x={x} y={z} width={w} height={h} fill="none" stroke="#9aa7b2" strokeDasharray="14 10" strokeWidth="4" /><text x={x + w / 2} y={z + h / 2} textAnchor="middle" fontSize={view.font} fill="#8794a0">{label}</text></g>)}
      {view.desks.map((d, i) => <rect key={i} x={d.x} y={d.y} width={d.w} height={d.h} rx="10" fill="#cfd8e0" stroke="#6b7a88" strokeWidth="3" />)}
      {view.seats.map((s: SeatPos) => {
        const key = floor === 4 ? `S:${s.x + FX4}:${s.z}:${s.back ? "b" : "t"}` : s.key, owner = ownerOf(key), isMine = key === mine, free = !owner;
        return <g key={key} onClick={() => free || isMine ? void choose(isMine ? "" : key) : undefined} style={{ cursor: free || isMine ? "pointer" : "not-allowed" }}>
          <title>{isMine ? `${name}（點一下清除）` : owner ? `${owner} 的座位` : "可選"}</title>
          <circle cx={s.x} cy={s.z} r={view.r} fill={isMine ? "#ff9f2e" : free ? "#43d86c" : "#9aa7b2"} stroke="#1b2a33" strokeWidth="4" />
        </g>;
      })}
    </svg>}
    <p style={{ fontSize: 12, textAlign: "center", margin: "6px 0 0" }}>🟢 可選　🟠 {name || "你"}目前的位置　⚪ 已有人（滑過可看是誰）</p>
  </section>;
}

function seatLabel(key: string) {
  const m = /^S:(\d+):(\d+):(t|b)$/.exec(key);
  if (!m) return key;
  return Number(m[1]) >= 3000 ? "4F 辦公桌" : "5F 辦公桌";
}
