"use client";

import { useEffect, useState } from "react";

// 座位圖：依五樓、四樓的座位縮圖點選角色要坐的位置（會議室、茶水間不算座位）。沒選＝在辦公室自由走動，隨時可以回來改。
// 座標與 pixel-plaza/index.html 的 ROW_TOPS／GROUPS／SEATS4 一致（單位：版面 px）。
const ROW_TOPS = [355, 592, 828], GROUPS = [[463, 568, 673], [833, 938, 1043]];
type Seat = { key: string; x: number; y: number };
const seats5: Seat[] = [];
for (let g = 0; g < 2; g += 1) for (let r = 0; r < 3; r += 1) for (let c = 0; c < 3; c += 1) for (const pos of ["top", "bottom"] as const)
  seats5.push({ key: `5:${g}:${r}:${c}:${pos}`, x: GROUPS[g][c], y: pos === "top" ? ROW_TOPS[r] - 34 : ROW_TOPS[r] + 120 });
const seats4: Seat[] = [];
for (let g = 0; g < 5; g += 1) for (let slot = 1; slot <= 8; slot += 1) { const edge = 382.5 + 232.5 * g + 40, k = (slot - 1) % 4; seats4.push({ key: `4:${g}:${slot}`, x: 39 + 52.5 + 105 * k, y: slot > 4 ? edge + 120 : edge - 34 }); }
const desks5 = GROUPS.flatMap((cols) => cols.flatMap((x) => ROW_TOPS.map((top) => ({ x: x - 50, y: top, w: 100, h: 86 }))));
const desks4 = Array.from({ length: 5 }, (_, g) => ({ x: 39, y: 382.5 + 232.5 * g + 40 + 6, w: 420, h: 80 }));

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
  useEffect(() => { void load(); }, [token]);

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
  const view = floor === 5 ? { w: 1201, h: 1560, seats: seats5, desks: desks5 } : { w: 500, h: 1560, seats: seats4, desks: desks4 };

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
    {fixedName ? <p className="persona-hint">{name} 在 3D 辦公室有固定座位，不能另外指定。</p> : <svg viewBox={`0 0 ${view.w} ${view.h}`} style={{ width: "100%", maxWidth: floor === 5 ? 520 : 240, display: "block", margin: "0 auto", background: "#eef2f5", borderRadius: 12 }}>
      {floor === 5 ? <><rect x="6" y="6" width={view.w - 12} height="236" fill="none" stroke="#9aa7b2" strokeDasharray="14 10" strokeWidth="4" /><text x={view.w / 2} y="130" textAnchor="middle" fontSize="54" fill="#8794a0">廁所／會議室 A／電梯</text>
        <rect x="6" y="1040" width={view.w - 12} height="514" fill="none" stroke="#9aa7b2" strokeDasharray="14 10" strokeWidth="4" /><text x={view.w / 2} y="1290" textAnchor="middle" fontSize="54" fill="#8794a0">會議室 B／C／D・茶水間</text></>
        : <><rect x="6" y="6" width={view.w - 12} height="350" fill="none" stroke="#9aa7b2" strokeDasharray="14 10" strokeWidth="4" /><text x={view.w / 2} y="190" textAnchor="middle" fontSize="40" fill="#8794a0">電梯／廁所／茶水間</text></>}
      {view.desks.map((d, i) => <rect key={i} x={d.x} y={d.y} width={d.w} height={d.h} rx="10" fill="#cfd8e0" stroke="#6b7a88" strokeWidth="3" />)}
      {view.seats.map((s) => {
        const owner = ownerOf(s.key), isMine = s.key === mine, free = !owner;
        return <g key={s.key} onClick={() => free || isMine ? void choose(isMine ? "" : s.key) : undefined} style={{ cursor: free || isMine ? "pointer" : "not-allowed" }}>
          <title>{isMine ? `${name}（點一下清除）` : owner ? `${owner} 的座位` : "可選"}</title>
          <circle cx={s.x} cy={s.y} r={floor === 5 ? 26 : 22} fill={isMine ? "#ff9f2e" : free ? "#43d86c" : "#9aa7b2"} stroke="#1b2a33" strokeWidth="4" />
        </g>;
      })}
    </svg>}
    <p style={{ fontSize: 12, textAlign: "center", margin: "6px 0 0" }}>🟢 可選　🟠 {name || "你"}目前的位置　⚪ 已有人（滑過可看是誰）</p>
  </section>;
}

function seatLabel(key: string) {
  const f = /^5:(\d):(\d):(\d):(top|bottom)$/.exec(key);
  if (f) return `5F・${f[1] === "0" ? "設計部區" : "同仁區"}第 ${Number(f[2]) + 1} 排第 ${Number(f[3]) + 1} 欄（${f[4] === "top" ? "桌後" : "桌前"}）`;
  const g = /^4:(\d):(\d)$/.exec(key);
  return g ? `4F・第 ${Number(g[1]) + 1} 組 ${g[2]} 號` : key;
}
