"use client";

import { useEffect, useMemo, useRef, useState } from "react";

/**
 * 服裝頁開場的「像素辦公室小劇場」。
 * 真實同事（設計部優先）的角色在一間有咖啡角、辦公桌、印表機、會議室的辦公室裡演短劇：
 * 喝咖啡聊天、被客戶改稿、印表機卡紙、開會，最後新同事走進來坐到那張空位 —— 那張空位就是「你」。
 * 純展示：只讀公開的已發佈角色清單，不寫入任何資料，也不影響下面的製作流程。
 * 圖集：atlas-hd.png，12 個面向、1 列、每格 240px；第 0 格面向鏡頭、第 3 格朝畫面右、第 6 格背面、第 9 格朝畫面左。
 */
export const DESIGN_FIRST = ["Machi", "Anna", "Amber", "Leona", "Noise"];   // 這是設計部的系統，設計部人員優先出場
// 設計部五位用的是遊戲內建的圖集（不在雲端發佈清單裡），同一份圖集也放在公開的 3D 辦公室資料夾
const BUILTIN = (name: string) => `https://emc-art.com/pixel-plaza/sprites-hd/${encodeURIComponent(name)}.webp`;
const cloudSrc = (name: string, v: number) => `/api/public/characters/${encodeURIComponent(name)}/atlas-hd.png?v=${v}`;

const CINEMA_ORIGIN = "https://emc-art.com";
const W = 960, H = 430, S = 104, SPEED = 150;
const COL = { front: 0, right: 3, back: 6, left: 9 };
type Face = keyof typeof COL;
type Pt = { x: number; y: number; face: Face; work?: boolean };
const D1 = 330, D2 = 500, D3 = 670;   // 三張辦公桌的中心；中間那張（D2）是留給「你」的位置
const HOMES: Pt[] = [
  { x: D1, y: 300, face: "back", work: true }, { x: 118, y: 292, face: "right" }, { x: 230, y: 372, face: "front" },
  { x: D3, y: 300, face: "back", work: true }, { x: 420, y: 388, face: "front" }, { x: 800, y: 380, face: "left" },
];
const MINE_HOME: Pt = { x: D2, y: 300, face: "back", work: true };
const POKE = ["早安，今天也要加油", "這張稿我改好了", "有人要喝咖啡嗎？", "客戶說：再改一版", "我的位置超讚", "歡迎來到多元宇宙", "下班前再衝一波"];

type Person = { name: string; src: string };
type Act = { name: string; ghost: boolean; home: Pt; x: number; y: number; tx: number | null; ty: number | null; done: (() => void) | null; face: number; work: boolean; hop: number; el: HTMLDivElement | null; sprite: HTMLDivElement | null };
type Bubble = { id: number; x: number; y: number; text: string };

function taipeiClock() {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Taipei", hour: "numeric", minute: "numeric", hour12: false }).formatToParts(new Date());
  return { h: Number(parts.find((p) => p.type === "hour")?.value) % 24, m: Number(parts.find((p) => p.type === "minute")?.value) };
}

export default function OfficeTheater({ myName, characters, onStart }: { myName: string; characters: Record<string, number> | null; onStart: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const acts = useRef<Act[]>([]);
  const [k, setK] = useState(1);
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [clockNow, setClock] = useState<{ h: number; m: number } | null>(null);   // 伺服器與瀏覽器的時間不同，開頭先用白天，掛載後再換成真正的時間（不然會 hydration 不一致）
  const clock = clockNow ?? { h: 12, m: 0 };
  const [ctaPulse, setCtaPulse] = useState(false);
  const [deskGlow, setDeskGlow] = useState(false);
  const [printerShake, setPrinterShake] = useState(false);
  const [steam, setSteam] = useState(0);
  const [cine, setCine] = useState<"idle" | "loading" | "ready" | "off">("idle");   // 3D 辦公室劇場（嵌進來的 3D 辦公室）：載好就換掉下面的 2D 小劇場，載不起來就一直用 2D
  const bubbleId = useRef(0);

  const people: Person[] = useMemo(() => {
    if (!characters) return [];
    const cloud = Object.entries(characters).map(([name, v]) => ({ name, src: cloudSrc(name, Number(v) || 0) }));
    const all = [...cloud, ...DESIGN_FIRST.filter((n) => !cloud.some((c) => c.name === n)).map((name) => ({ name, src: BUILTIN(name) }))];
    const rank = (n: string) => (n === myName ? -1 : DESIGN_FIRST.includes(n) ? DESIGN_FIRST.indexOf(n) : 50);
    return all.sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name)).slice(0, 6);
  }, [characters, myName]);
  const hasMine = Boolean(myName) && Boolean(characters) && (myName in (characters || {}) || DESIGN_FIRST.includes(myName)) && people.some((p) => p.name === myName);

  const heroName = hasMine ? myName : "";
  useEffect(() => {
    if (!characters || cine !== "idle") return;
    const weak = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;
    let gl = false; try { const c = document.createElement("canvas"); gl = Boolean(c.getContext("webgl2") || c.getContext("webgl")); } catch { gl = false; }
    if (window.innerWidth < 720 || weak || !gl || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) { setCine("off"); return; }
    const t = window.setTimeout(() => setCine("loading"), 600);
    return () => window.clearTimeout(t);
  }, [characters, cine]);
  useEffect(() => {
    if (cine !== "loading" && cine !== "ready") return;
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== CINEMA_ORIGIN || !e.data) return;
      if (e.data.type === "cinemaReady") setCine("ready");
      if (e.data.type === "cinemaCta") setCtaPulse(Boolean(e.data.on));
    };
    window.addEventListener("message", onMessage);
    const giveUp = window.setTimeout(() => setCine((v) => (v === "loading" ? "off" : v)), 60000);   // 一分鐘還沒載好就放棄，繼續用 2D
    return () => { window.removeEventListener("message", onMessage); window.clearTimeout(giveUp); };
  }, [cine]);
  useEffect(() => { setClock(taipeiClock()); const t = window.setInterval(() => setClock(taipeiClock()), 30000); return () => window.clearInterval(t); }, []);
  useEffect(() => {
    const el = box.current; if (!el) return;
    const update = () => setK(el.clientWidth / W);
    update(); const ro = new ResizeObserver(update); ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const say = (x: number, y: number, text: string, ms = 2300) => {
    const id = ++bubbleId.current;
    setBubbles((list) => [...list.slice(-4), { id, x, y, text }]);
    window.setTimeout(() => setBubbles((list) => list.filter((b) => b.id !== id)), ms);
  };

  // 角色的位置、走動與朝向：直接改 DOM，不讓 React 每一格都重畫
  useEffect(() => {
    if (!people.length || cine === "ready") return;
    const root = box.current; if (!root) return;
    const nodes = Array.from(root.querySelectorAll<HTMLDivElement>("[data-act]"));
    let other = 0;
    const list: Act[] = nodes.map((el) => {
      const ghost = el.dataset.act === "?", name = el.dataset.act || "";
      const mine = !ghost && name === myName && hasMine;
      const home = ghost ? { x: -90, y: 372, face: "right" as Face } : mine ? MINE_HOME : HOMES[other++ % HOMES.length];
      return { name, ghost, home, x: home.x, y: home.y, tx: null, ty: null, done: null, face: COL[home.face], work: Boolean(home.work), hop: 0, el, sprite: el.querySelector<HTMLDivElement>(".th-sprite") };
    });
    acts.current = list;
    let last = performance.now(), raf = 0;
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      for (const a of list) {
        let moving = false;
        if (a.tx !== null && a.ty !== null) {
          const dx = a.tx - a.x, dy = a.ty - a.y, d = Math.hypot(dx, dy), step = SPEED * dt;
          if (d <= step) { a.x = a.tx; a.y = a.ty; a.tx = a.ty = null; const f = a.done; a.done = null; f?.(); }
          else { a.x += (dx / d) * step; a.y += (dy / d) * step; moving = true; a.face = Math.abs(dx) > Math.abs(dy) * 0.8 ? (dx > 0 ? COL.right : COL.left) : (dy < 0 ? COL.back : COL.front); }
        }
        const bob = moving ? Math.abs(Math.sin(now / 75)) * 7 : a.work ? Math.abs(Math.sin(now / 130)) * 2.5 : 0;
        a.hop = Math.max(0, a.hop - dt * 3);
        const lift = bob + Math.sin(Math.min(1, a.hop) * Math.PI) * 18;
        if (a.sprite) a.sprite.style.backgroundPosition = `${-a.face * S}px 0`;
        if (a.el) { a.el.style.transform = `translate3d(${a.x - S / 2}px, ${a.y - S - lift}px, 0)`; a.el.style.zIndex = String(Math.round(a.y)); }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [people, hasMine, myName, cine]);

  // 導演：一幕接一幕地演（離開頁面就停）
  useEffect(() => {
    if (!people.length || cine === "ready") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    let alive = true;
    const sleep = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));
    const check = () => { if (!alive) throw new Error("stop"); };
    const n = people.length;
    const A = (i: number) => acts.current[i % n];
    const go = (a: Act, x: number, y: number) => new Promise<void>((resolve) => { a.tx = x; a.ty = y; a.done = resolve; });
    const home = (a: Act) => go(a, a.home.x, a.home.y).then(() => { a.face = COL[a.home.face]; a.work = Boolean(a.home.work); });
    const face = (a: Act, f: Face) => { a.face = COL[f]; a.work = false; };
    const talk = async (a: Act, text: string, ms = 2200) => { check(); say(a.x, a.y - S, text, ms); await sleep(ms * 0.85); check(); };
    const ghost = () => acts.current.find((a) => a.ghost);
    const scenes: Array<() => Promise<void>> = [
      async () => {   // 咖啡時間
        const a = A(1), b = A(2);
        await go(b, a.x + 64, a.y + 12); face(b, "left"); face(a, "right"); setSteam((s) => s + 1);
        await talk(a, "今天第幾杯了？"); await talk(b, "不要問，問就是第三杯。"); await talk(a, "靈感都在咖啡裡。", 2000);
        await home(b); await home(a);
      },
      async () => {   // 改稿風暴
        const a = A(0), b = A(4);
        await go(b, a.x + 66, a.y + 40); face(b, "left"); face(a, "right");
        await talk(b, "客戶說，再改一版。"); await talk(a, "……好。", 1500); await talk(a, "這是第幾版了？", 1800); await talk(b, "final_真的最終版_2。", 2400);
        await home(b); await home(a);
      },
      async () => {   // 印表機卡紙
        const a = A(2), b = A(3);
        await go(a, 744, 326); face(a, "back"); setPrinterShake(true); window.setTimeout(() => setPrinterShake(false), 900);
        await talk(a, "嗶——卡紙了。", 1900);
        await go(b, 700, 356); face(b, "right");
        await talk(b, "你是不是又用力按？", 2000); await talk(a, "我很溫柔。", 1700);
        await Promise.all([home(a), home(b)]);
      },
      async () => {   // 開會
        const a = A(2), b = A(4);
        await Promise.all([go(a, 872, 322), go(b, 924, 342)]); face(a, "right"); face(b, "left");
        await talk(a, "五分鐘就好。", 1800); await talk(b, "上次你也這樣說。", 2200); await sleep(1200);
        await Promise.all([home(a), home(b)]);
      },
      async () => {   // 新同事到（自己已經入座的人，改成互道早安）
        const g = ghost();
        if (hasMine || !g) { await talk(A(1), "早安！", 1500); await talk(A(0), "早，今天也加油。", 1900); return; }
        g.el?.classList.add("on"); g.x = -90; g.y = 372;
        await go(g, 400, 372);
        for (const p of acts.current) if (!p.ghost) face(p, p.x < 400 ? "right" : "left");
        await talk(A(1), "新同事來了！", 1700); await talk(A(3), "歡迎入職，你的位置留好了。", 2600);
        setDeskGlow(true); setCtaPulse(true);
        await go(g, D2, 326); g.face = COL.back; g.work = true;
        await talk(g, "輪到我了嗎？", 1900); await sleep(1100);
        g.el?.classList.remove("on"); setCtaPulse(false); setDeskGlow(false); g.x = -90; g.work = false;
        for (const p of acts.current) if (!p.ghost) { p.face = COL[p.home.face]; p.work = Boolean(p.home.work); }
      },
    ];
    (async () => {
      try { await sleep(1800); for (let i = 0; ; i++) { check(); await scenes[i % scenes.length](); await sleep(2600); } }
      catch { /* 離開頁面 */ }
    })();
    return () => { alive = false; };
  }, [people, hasMine, cine]);

  const poke = (i: number) => {
    const a = acts.current[i]; if (!a || a.ghost) return;
    a.hop = 1;
    say(a.x, a.y - S, a.name === myName && hasMine ? "這就是你，快去選個座位吧" : `${a.name}：${POKE[Math.floor(Math.random() * POKE.length)]}`);
  };
  const pokeThing = (x: number, y: number, text: string, after?: () => void) => { say(x, y, text, 1900); after?.(); };

  const night = clock.h < 6 || clock.h >= 19, dusk = clock.h >= 17 && clock.h < 19;
  const sky = night ? ["#16233f", "#34487a"] : dusk ? ["#f1955f", "#fbd7a2"] : ["#86cdf3", "#d3ecfb"];
  const hourDeg = ((clock.h % 12) + clock.m / 60) * 30, minDeg = clock.m * 6;
  const handEnd = (deg: number, len: number) => `${620 + Math.sin((deg * Math.PI) / 180) * len},${58 - Math.cos((deg * Math.PI) / 180) * len}`;
  const working = clock.h >= 9 && clock.h < 19;

  return <section className="th" aria-label="多元宇宙辦公室小劇場">
    <div className="th-copy">
      <span className="th-eyebrow">EMC PIXEL OFFICE</span>
      <h2>歡迎入職，<br />你的位置留好了</h2>
      <p>上傳一張照片，AI 幫你做出專屬的像素角色。完成後你會出現在公司的多元宇宙裡，和同事一起上班、走動、聊天，是辦公室裡的一點小樂趣。</p>
      <button type="button" className={`th-cta${ctaPulse ? " pulse" : ""}`} onClick={onStart}>{hasMine ? "換一個新造型" : "做我的角色，入座"}<span aria-hidden>→</span></button>
      <small className="th-note">{characters ? (working ? "現在是上班時間，同事們都在辦公室裡" : "現在是下班時間，辦公室裡剩下幾位加班的同事") : "辦公室載入中…"}</small>
    </div>
    <div className="th-stage" ref={box} style={{ ["--k" as string]: k }} role="group" aria-label="像素辦公室，可以點擊互動">
      {cine === "ready" ? null : <div className="th-inner" style={{ width: W, height: H, transform: `scale(${k})` }}>
        <svg className="th-bg" viewBox={`0 0 ${W} ${H}`} width={W} height={H} shapeRendering="crispEdges" aria-hidden>
          <defs>
            <linearGradient id="thSky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={sky[0]} /><stop offset="1" stopColor={sky[1]} /></linearGradient>
            <pattern id="thTile" width="56" height="56" patternUnits="userSpaceOnUse"><rect width="56" height="56" fill="#dccdac" /><rect width="28" height="28" fill="#cfbf9b" /><rect x="28" y="28" width="28" height="28" fill="#cfbf9b" /></pattern>
          </defs>
          <rect width={W} height="176" fill="#e9efe0" /><rect y="150" width={W} height="26" fill="#d3ddc6" /><rect y="172" width={W} height="6" fill="#9fb392" />
          <rect y="178" width={W} height={H - 178} fill="url(#thTile)" />
          {[90, 240].map((x) => <g key={x}><rect x={x} y="28" width="120" height="86" fill="#8aa07c" /><rect x={x + 6} y="34" width="108" height="74" fill="url(#thSky)" /><rect x={x + 57} y="34" width="6" height="74" fill="#8aa07c" /><rect x={x + 6} y="68" width="108" height="6" fill="#8aa07c" />
            {night ? <g fill="#fff"><rect x={x + 18} y="46" width="3" height="3" /><rect x={x + 84} y="52" width="3" height="3" /><rect x={x + 40} y="90" width="3" height="3" /></g> : <g fill="#fff" opacity=".85"><rect x={x + 16} y="46" width="30" height="8" /><rect x={x + 22} y="40" width="18" height="8" /></g>}</g>)}
          <rect x="420" y="26" width="124" height="46" fill="#008214" /><rect x="420" y="66" width="124" height="6" fill="#005f0e" /><text x="482" y="58" textAnchor="middle" fontSize="28" fontWeight="900" letterSpacing="5" fill="#fff">EMC</text>
          <circle cx="620" cy="58" r="28" fill="#fff" stroke="#3b4a3a" strokeWidth="5" />
          <polyline points={`620,58 ${handEnd(hourDeg, 13)}`} stroke="#262d27" strokeWidth="4" fill="none" /><polyline points={`620,58 ${handEnd(minDeg, 20)}`} stroke="#262d27" strokeWidth="3" fill="none" /><circle cx="620" cy="58" r="3" fill="#d64550" />
          <rect x="700" y="24" width="170" height="92" fill="#fff" stroke="#8aa07c" strokeWidth="6" />
          <g fill="#ffd95a"><rect x="714" y="36" width="30" height="26" /><rect x="752" y="40" width="30" height="26" /></g><g fill="#9fd8ff"><rect x="792" y="36" width="30" height="26" /></g><g fill="#ffb3c7"><rect x="830" y="42" width="28" height="24" /></g>
          <g fill="#9aa397"><rect x="714" y="76" width="130" height="4" /><rect x="714" y="88" width="96" height="4" /><rect x="714" y="100" width="116" height="4" /></g>
          <rect x="34" y="126" width="176" height="52" fill="#b98b57" /><rect x="34" y="126" width="176" height="8" fill="#d6aa72" /><rect x="34" y="172" width="176" height="6" fill="#7b5a34" />
          <rect x="62" y="70" width="60" height="58" fill="#4a525a" /><rect x="68" y="78" width="48" height="16" fill="#9fd8ff" /><rect x="76" y="104" width="32" height="22" fill="#2b3138" /><rect x="86" y="108" width="12" height="14" fill="#f2f2f2" /><rect x="64" y="66" width="56" height="6" fill="#2b3138" />
          <rect x="140" y="110" width="14" height="16" fill="#fff" /><rect x="162" y="110" width="14" height="16" fill="#e87a7a" />
          {[D1, D2, D3].map((x) => <g key={x}>
            <rect x={x - 70} y="214" width="140" height="38" fill="#c9a36b" /><rect x={x - 70} y="214" width="140" height="8" fill="#e0bf8a" /><rect x={x - 70} y="252" width="10" height="26" fill="#7b5a34" /><rect x={x + 60} y="252" width="10" height="26" fill="#7b5a34" />
            <rect x={x - 28} y="170" width="56" height="40" fill="#2b3138" /><rect x={x - 24} y="174" width="48" height="30" fill={x === D2 && !hasMine ? "#3a4651" : working ? "#9fe3b0" : "#5c6b78"} /><rect x={x - 6} y="210" width="12" height="6" fill="#2b3138" />
            <rect x={x - 22} y="224" width="44" height="8" fill="#eef1ea" /><rect x={x + 42} y="204" width="12" height="14" fill="#fff" />
          </g>)}
          <g className={`th-deskglow${deskGlow ? " on" : ""}`}><rect x={D2 - 78} y="162" width="156" height="124" fill="none" stroke="#008214" strokeWidth="5" strokeDasharray="14 10" /></g>
          {!hasMine && <g><rect x={D2 - 40} y="290" width="80" height="26" rx="4" fill="#008214" /><text x={D2} y="308" textAnchor="middle" fontSize="15" fontWeight="800" fill="#fff">你的位置</text></g>}
          <g className={printerShake ? "th-shake" : ""}><rect x="728" y="226" width="64" height="30" fill="#e8ecef" stroke="#3b4a3a" strokeWidth="4" /><rect x="738" y="216" width="44" height="12" fill="#cfd6dc" /><rect x="738" y="244" width="44" height="6" fill="#4a525a" /><rect x="728" y="256" width="64" height="22" fill="#9a7a4c" /></g>
          <rect x="816" y="182" width="136" height="168" fill="#cfe9f5" fillOpacity=".38" stroke="#6f93a6" strokeWidth="5" /><rect x="826" y="262" width="86" height="40" fill="#b98b57" /><rect x="826" y="262" width="86" height="8" fill="#d6aa72" />
          <text x="884" y="204" textAnchor="middle" fontSize="13" fontWeight="800" fill="#4a6b7c">會議室</text>
          {[[22, 330], [930, 392]].map(([x, y]) => <g key={x}><rect x={x - 12} y={y} width="24" height="22" fill="#b0623f" /><rect x={x - 16} y={y - 26} width="32" height="12" fill="#3d8d4c" /><rect x={x - 10} y={y - 40} width="20" height="16" fill="#52a862" /></g>)}
        </svg>
        <button type="button" className="th-hit" style={{ left: 58, top: 62, width: 68, height: 72 }} aria-label="咖啡機" onClick={() => pokeThing(92, 120, "咖啡煮好了", () => setSteam((s) => s + 1))} />
        <button type="button" className="th-hit" style={{ left: 724, top: 212, width: 72, height: 50 }} aria-label="印表機" onClick={() => pokeThing(760, 210, "嗶——卡紙了", () => { setPrinterShake(true); window.setTimeout(() => setPrinterShake(false), 900); })} />
        {!hasMine && <button type="button" className="th-hit" style={{ left: D2 - 78, top: 162, width: 156, height: 124 }} aria-label="你的位置" onClick={onStart} />}
        <span className="th-steam" key={steam} style={{ left: 86, top: 40, opacity: steam ? 1 : 0 }}><i /><i /><i /></span>
        <div className="th-cat" aria-hidden><svg viewBox="0 0 16 12" width="48" height="36" shapeRendering="crispEdges"><rect x="3" y="4" width="10" height="6" fill="#e9a04a" /><rect x="11" y="2" width="4" height="5" fill="#e9a04a" /><rect x="11" y="1" width="1" height="2" fill="#e9a04a" /><rect x="14" y="1" width="1" height="2" fill="#e9a04a" /><rect x="0" y="5" width="3" height="2" fill="#e9a04a" /><rect x="4" y="10" width="2" height="2" fill="#c47d2e" /><rect x="10" y="10" width="2" height="2" fill="#c47d2e" /><rect x="13" y="4" width="1" height="1" fill="#262d27" /></svg></div>
        {people.map((p, i) => <div key={p.name} className="th-act" data-act={p.name}>
          <button type="button" className="th-sprite" onClick={() => poke(i)} aria-label={`${p.name}，點一下打招呼`} style={{ backgroundImage: `url(${p.src})`, backgroundSize: `${S * 12}px ${S}px` }} />
          <span className={`th-tag${p.name === myName && hasMine ? " me" : ""}`}>{p.name === myName && hasMine ? `${p.name}（你）` : p.name}</span>
        </div>)}
        {!hasMine && people.length > 0 && <div className="th-act th-ghost" data-act="?"><div className="th-sprite th-sil" /><span className="th-tag me">新同事</span></div>}
      </div>}
      {(cine === "loading" || cine === "ready") && <iframe className={`th-cine${cine === "ready" ? " on" : ""}`} title="辦公室劇場" tabIndex={-1} aria-hidden src={`${CINEMA_ORIGIN}/pixel-plaza/index.html?embed=1&cinema=1&v=20261109&hero=${encodeURIComponent(heroName)}`} />}
      <div className="th-bubbles" aria-live="polite">{cine !== "ready" && bubbles.map((b) => <div key={b.id} className="th-bubble" style={{ left: Math.min(Math.max(b.x * k, 96), Math.max(96, (box.current?.clientWidth || 600) - 96)), top: Math.max(8, b.y * k) }}>{b.text}</div>)}</div>
      {night && cine !== "ready" && <div className="th-night" />}
    </div>
  </section>;
}
