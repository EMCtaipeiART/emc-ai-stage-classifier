"use client";

import { useEffect, useMemo, useRef, useState } from "react";

/**
 * 服裝頁開場：左邊是一句話說明＋大按鈕，右邊是「辦公室劇場」——嵌進來的 3D 辦公室（pixel-plaza ?cinema=1），
 * 由設計部的真實同事演《最後一版》。3D 載好之前、手機、沒有 WebGL、載不起來時，顯示同一間辦公室的劇照（office-poster.jpg）。
 * 純展示：只讀公開的已發佈角色清單，不寫入任何資料，也不影響下面的製作流程。
 */
export const DESIGN_FIRST = ["Machi", "Anna", "Amber", "Leona", "Noise"];   // 設計部五位用的是遊戲內建圖集，本來就在辦公室裡
const CINEMA_ORIGIN = "https://emc-art.com";
const CINEMA_VERSION = "20261116";   // 3D 辦公室劇場有改動時一起加一，瀏覽器才不會抓到舊檔

export default function OfficeTheater({ myName, characters, onStart }: { myName: string; characters: Record<string, number> | null; onStart: () => void }) {
  const [cine, setCine] = useState<"idle" | "loading" | "ready" | "off">("idle");
  const [ctaPulse, setCtaPulse] = useState(false);
  const [muted, setMuted] = useState(true);
  const frame = useRef<HTMLIFrameElement>(null);
  const hasMine = useMemo(() => Boolean(myName) && Boolean(characters) && (myName in (characters || {}) || DESIGN_FIRST.includes(myName)), [myName, characters]);

  useEffect(() => {
    if (!characters || cine !== "idle") return;
    const weak = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;
    let gl = false; try { const c = document.createElement("canvas"); gl = Boolean(c.getContext("webgl2") || c.getContext("webgl")); } catch { gl = false; }
    if (weak || !gl || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) { setCine("off"); return; }
    setCine("loading");
  }, [characters, cine]);
  useEffect(() => {
    if (cine !== "loading" && cine !== "ready") return;
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== CINEMA_ORIGIN || !e.data) return;
      if (e.data.type === "cinemaReady") setCine("ready");
      if (e.data.type === "cinemaCta") setCtaPulse(Boolean(e.data.on));
      if (e.data.type === "cinemaMuted") setMuted(Boolean(e.data.muted));   // 瀏覽器不讓有聲播放時，影片頁會回報「仍是靜音」
    };
    window.addEventListener("message", onMessage);
    const giveUp = window.setTimeout(() => setCine((v) => (v === "loading" ? "off" : v)), 90000);   // 一分半還沒載好就放棄，維持劇照
    return () => { window.removeEventListener("message", onMessage); window.clearTimeout(giveUp); };
  }, [cine]);

  return <section className="th" aria-label="多元宇宙辦公室劇場">
    <div className="th-copy">
      <span className="th-eyebrow">EMC PIXEL OFFICE</span>
      <h2>歡迎入職，<br />你的位置留好了</h2>
      <p>上傳一張照片，AI 幫你做出專屬的像素角色。完成後你會出現在公司的多元宇宙裡，和同事一起上班、走動、聊天，是辦公室裡的一點小樂趣。</p>
      <button type="button" className={`th-cta${ctaPulse ? " pulse" : ""}`} onClick={onStart}>{hasMine ? "換一個新造型" : "做我的角色，入座"}<span aria-hidden>→</span></button>
      <small className="th-note">{cine === "loading" ? "辦公室劇場載入中，稍等幾秒就開演" : cine === "ready" ? "正在上映：《最後一版》" : "設計部的日常，等你加入"}</small>
    </div>
    <div className="th-stage" role="group" aria-label="辦公室劇場">
      {(cine === "loading" || cine === "ready") && <iframe ref={frame} className={`th-cine${cine === "ready" ? " on" : ""}`} title="辦公室劇場" tabIndex={-1} aria-hidden src={`${CINEMA_ORIGIN}/pixel-plaza/cinema-video.html?embed=1&v=${CINEMA_VERSION}`} allow="autoplay" />}
      {cine === "ready" && <div className="th-ctls">
        <button type="button" className="th-skip" onClick={() => { const next = !muted; setMuted(next); frame.current?.contentWindow?.postMessage({ type: "cinemaMute", muted: next }, CINEMA_ORIGIN); }}>{muted ? "開聲音" : "關聲音"}</button>
        <button type="button" className="th-skip" onClick={() => frame.current?.contentWindow?.postMessage({ type: "cinemaSkip" }, CINEMA_ORIGIN)}>下一句<span aria-hidden> ▸▸</span></button>
      </div>}
      {cine === "loading" && <span className="th-loading" aria-hidden><i /></span>}
    </div>
  </section>;
}
