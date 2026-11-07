"use client";

import { useEffect, useRef, useState } from "react";

/**
 * 服裝頁最上面的「迷你辦公室」：讀公開的已發佈角色清單，讓真實同事的像素角色在裡面走動；
 * 點人物、點咖啡機／盆栽／印表機／貓都有小互動。純展示，不寫入任何資料，也不影響下面的製作流程。
 * 圖集：atlas-hd.png，12 個面向、1 列、每格 240px；第 0 格面向鏡頭、第 3 格朝畫面右、第 6 格背面、第 9 格朝畫面左。
 */
const DESIGN_FIRST = ["Machi", "Anna", "Amber", "Leona", "Noise"];   // 這是設計部的系統，設計部人員優先出場
const MAX_PEOPLE = 9;
// 設計部的五位用的是遊戲內建的圖集（不在雲端發佈清單裡），同一份圖集也放在公開的 3D 辦公室資料夾
const BUILTIN = (name: string) => `https://emc-art.com/pixel-plaza/sprites-hd/${encodeURIComponent(name)}.webp`;
const COL = { front: 0, right: 3, back: 6, left: 9 };
const LINES = [
  "早安～今天也要加油 ☕", "這張稿我改好了喔！", "有人要喝咖啡嗎？", "戳我幹嘛 😆", "客戶說：再改一版～",
  "我的位置超讚，你也來選一個！", "歡迎來到多元宇宙！", "做一個你的角色，來跟我們一起上班吧", "下班前再衝一波！", "今天的靈感在咖啡裡 ☕",
];
const OBJECT_LINES: Record<string, string[]> = {
  coffee: ["☕ 咖啡煮好了！", "☕ 今天的豆子特別香", "☕ 有人排隊了"],
  plant: ["🌱 長高了一點點", "🪴 它說謝謝你澆水"],
  printer: ["📄 嗶——卡紙了！", "📄 印好了，是昨天的稿"],
  cat: ["🐈 喵～", "🐈 呼嚕呼嚕 ❤", "🐈 要摸摸"],
};

type Agent = { name: string; el: HTMLDivElement; sprite: HTMLDivElement; x: number; y: number; vx: number; wait: number; goal: number | null; bubbleTimer: number; mine: boolean };
type Bubble = { id: number; x: number; y: number; text: string };

export default function OfficeHero({ myName, onStart }: { myName: string; onStart: () => void }) {
  const stage = useRef<HTMLDivElement>(null);
  const [people, setPeople] = useState<Array<{ name: string; src: string }>>([]);
  const [total, setTotal] = useState(0);
  const [poked, setPoked] = useState(0);
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [ready, setReady] = useState(false);
  const agents = useRef<Agent[]>([]);
  const bubbleId = useRef(0);
  const pokedRef = useRef(0);

  useEffect(() => {
    let dead = false;
    fetch("/api/public/characters", { cache: "no-store" }).then((r) => r.json() as Promise<{ characters?: Record<string, number> }>).then((data) => {
      if (dead) return;
      const cloud = Object.entries(data.characters || {}).map(([name, v]) => ({ name, src: `/api/public/characters/${encodeURIComponent(name)}/atlas-hd.png?v=${Number(v) || 0}` }));
      const all = [...cloud, ...DESIGN_FIRST.filter((name) => !cloud.some((c) => c.name === name)).map((name) => ({ name, src: BUILTIN(name) }))];
      setTotal(all.length);
      const rank = (name: string) => { const i = DESIGN_FIRST.indexOf(name); return name === myName ? -1 : i < 0 ? 99 : i; };
      setPeople(all.sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name)).slice(0, window.innerWidth < 600 ? 6 : MAX_PEOPLE));
    }).catch(() => undefined).finally(() => { if (!dead) setReady(true); });
    return () => { dead = true; };
  }, [myName]);

  const say = (x: number, y: number, text: string) => {
    const id = ++bubbleId.current;
    setBubbles((list) => [...list.slice(-3), { id, x, y, text }]);
    window.setTimeout(() => setBubbles((list) => list.filter((b) => b.id !== id)), 2200);
  };
  const countPoke = () => { pokedRef.current += 1; setPoked(pokedRef.current); };

  // 走動動畫：直接改 DOM 樣式，不讓 React 每一格都重畫
  useEffect(() => {
    const root = stage.current;
    if (!root || !people.length) return;
    const nodes = Array.from(root.querySelectorAll<HTMLDivElement>("[data-agent]"));
    const list: Agent[] = nodes.map((el, i) => ({
      name: el.dataset.agent || "", el, sprite: el.querySelector<HTMLDivElement>(".hero-sprite")!,
      x: 0.12 + (0.76 * (i + 0.5)) / nodes.length, y: (i % 3) / 2, vx: 0, wait: 0.4 + Math.random() * 3, goal: null, bubbleTimer: 0, mine: el.dataset.mine === "1",
    }));
    agents.current = list;
    let last = performance.now(), raf = 0;
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      const width = root.clientWidth, size = Math.min(96, Math.max(64, width / 7));
      root.style.setProperty("--s", `${size}px`);
      for (const a of list) {
        if (a.goal !== null) { const d = a.goal - a.x; if (Math.abs(d) < 0.01) { a.goal = null; a.vx = 0; a.wait = 2.2; } else a.vx = Math.sign(d) * 0.11; }
        else if (a.wait > 0) { a.wait -= dt; a.vx = 0; if (a.wait <= 0) { a.vx = (Math.random() < 0.5 ? -1 : 1) * (0.05 + Math.random() * 0.06); a.wait = 2 + Math.random() * 4; } }
        else a.wait = 1 + Math.random() * 3;
        a.x = Math.min(0.94, Math.max(0.06, a.x + a.vx * dt));
        if (a.x <= 0.06 && a.vx < 0) a.vx = Math.abs(a.vx);
        if (a.x >= 0.94 && a.vx > 0) a.vx = -Math.abs(a.vx);
        const moving = a.vx !== 0, step = moving ? Math.abs(Math.sin(now / 110)) * 5 : 0;
        const col = moving ? (a.vx > 0 ? COL.right : COL.left) : COL.front;
        a.sprite.style.backgroundPosition = `${-col * size}px 0`;
        a.el.style.transform = `translate(${a.x * width - size / 2}px, ${-step}px)`;
        a.el.style.bottom = `${10 + a.y * 34}px`;
        a.el.style.zIndex = String(10 - Math.round(a.y * 4));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [people]);

  const pokePerson = (name: string, mine: boolean) => {
    const a = agents.current.find((item) => item.name === name), root = stage.current;
    if (!a || !root) return;
    const text = mine ? "這就是你！快去選個座位吧 💺" : name === myName ? LINES[0] : `${name}：${LINES[Math.floor(Math.random() * LINES.length)]}`;
    say(a.x * root.clientWidth, 150, text); countPoke();
    a.el.classList.remove("hop"); void a.el.offsetWidth; a.el.classList.add("hop");
    a.vx = 0; a.wait = 2.5;
  };
  const pokeObject = (kind: string, xPercent: number) => {
    const root = stage.current;
    if (!root) return;
    const lines = OBJECT_LINES[kind];
    say((xPercent / 100) * root.clientWidth, 120, lines[Math.floor(Math.random() * lines.length)]); countPoke();
    if (kind === "coffee" && agents.current.length) {   // 咖啡機：隨機一位同事走過去倒咖啡
      const a = agents.current[Math.floor(Math.random() * agents.current.length)];
      a.goal = Math.min(0.9, Math.max(0.1, xPercent / 100 + 0.07)); a.wait = 0;
    }
  };

  const mineIn = people.some((p) => p.name === myName);
  return <section className="hero" aria-label="多元宇宙辦公室">
    <div className="hero-copy">
      <span className="hero-eyebrow">PIXEL OFFICE · 多元宇宙</span>
      <h2>做一個你的分身，<br />搬進公司的像素辦公室</h2>
      <p>上傳一張照片，AI 幫你做出專屬像素角色。完成後你會出現在公司的多元宇宙裡，和同事一起上班、走動、打招呼 —— 一個辦公室的小樂趣。</p>
      <div className="hero-steps"><span><b>1</b>上傳一張照片</span><i>→</i><span><b>2</b>AI 生成並微調</span><i>→</i><span><b>3</b>選座位，進辦公室</span></div>
      <button type="button" className="hero-cta" onClick={onStart}>{mineIn ? "換一個新造型 →" : "做我的角色，加入他們 →"}</button>
      <small className="hero-note">{ready ? (total ? `已有 ${total} 位同事住在這裡，點點看辦公室裡的人和東西` : "你會是第一個住進來的人！") : "辦公室載入中…"}</small>
    </div>
    <div className="hero-scene" ref={stage} role="group" aria-label="迷你辦公室，可以點擊互動">
      <div className="hero-wall"><span className="hero-window" /><span className="hero-window" /><span className="hero-sign">EMC</span><span className="hero-window" /></div>
      <div className="hero-floor" />
      <button type="button" className="hero-obj coffee" style={{ left: "6%" }} onClick={() => pokeObject("coffee", 6)} aria-label="咖啡機"><span>☕</span><i className="steam">~</i></button>
      <button type="button" className="hero-obj printer" style={{ left: "24%" }} onClick={() => pokeObject("printer", 24)} aria-label="印表機"><span>🖨️</span></button>
      <button type="button" className="hero-obj plant" style={{ left: "92%" }} onClick={() => pokeObject("plant", 92)} aria-label="盆栽"><span>🪴</span></button>
      <button type="button" className="hero-obj cat" style={{ left: "70%" }} onClick={() => pokeObject("cat", 70)} aria-label="貓"><span>🐈</span></button>
      {people.map((p) => {
        const mine = p.name === myName;
        return <div key={p.name} className={`hero-agent${mine ? " mine" : ""}`} data-agent={p.name} data-mine={mine ? "1" : "0"}>
          <button type="button" className="hero-sprite" onClick={() => pokePerson(p.name, mine)} aria-label={`${p.name}（點一下打招呼）`}
            style={{ backgroundImage: `url(${p.src})`, backgroundSize: "calc(var(--s) * 12) var(--s)" }} />
          <span className="hero-tag">{mine ? `${p.name}（你）` : p.name}</span>
        </div>;
      })}
      {ready && !mineIn && myName && <button type="button" className="hero-slot" onClick={onStart}><span>?</span><em>你的位置</em></button>}
      {bubbles.map((b) => <div key={b.id} className="hero-bubble" style={{ left: Math.min(Math.max(b.x, 100), Math.max(100, (stage.current?.clientWidth || 600) - 100)), bottom: b.y }}>{b.text}</div>)}
      {poked >= 10 && <div className="hero-egg">🎉 你已經跟辦公室互動 {poked} 次，解鎖「社交達人」！</div>}
    </div>
  </section>;
}
