"use client";

import { useEffect, useMemo, useRef, useState } from "react";

/**
 * 服裝頁開場：左邊是一句話說明＋大按鈕，右邊是「辦公室劇場」——嵌進來的 3D 辦公室（pixel-plaza ?cinema=1），
 * 由設計部的真實同事演《最後一版》。3D 載好之前、手機、沒有 WebGL、載不起來時，顯示同一間辦公室的劇照（office-poster.jpg）。
 * 純展示：只讀公開的已發佈角色清單，不寫入任何資料，也不影響下面的製作流程。
 */
export const DESIGN_FIRST = ["Machi", "Anna", "Amber", "Leona", "Noise"];   // 設計部五位用的是遊戲內建圖集，本來就在辦公室裡
const CINEMA_ORIGIN = "https://emc-art.com";
const CINEMA_VERSION = "20261123";   // 3D 辦公室劇場有改動時一起加一，瀏覽器才不會抓到舊檔

export default function OfficeTheater({ myName, characters, onStart }: { myName: string; characters: Record<string, number> | null; onStart: () => void }) {
  const [cine, setCine] = useState<"idle" | "tap" | "loading" | "ready" | "off">("idle");
  const [ctaPulse, setCtaPulse] = useState(false);
  const [ended, setEnded] = useState(false);
  const [muted, setMuted] = useState(false);   // 預設有聲；瀏覽器擋下來時影片頁會回報 cinemaMuted
  const frame = useRef<HTMLIFrameElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [ctlOn, setCtlOn] = useState(true);   // 右下角的按鈕幾秒後自動收起，滑鼠移動／觸碰再出現，才不會擋到字幕
  const hideTimer = useRef(0);
  const tapHidden = useRef(false);
  const wake = () => { setCtlOn(true); window.clearTimeout(hideTimer.current); hideTimer.current = window.setTimeout(() => setCtlOn(false), 3000); };
  useEffect(() => { if (cine === "ready") wake(); return () => window.clearTimeout(hideTimer.current); }, [cine]);   // eslint-disable-line react-hooks/exhaustive-deps
  const [full, setFull] = useState(false);
  const pseudoFull = useRef(false);
  // 全螢幕：先用瀏覽器的全螢幕（Android／電腦）；iPhone 不支援就請外層主站把這個頁面撐滿整個視窗（假全螢幕）
  const enterFull = () => {
    const el = stage.current as (HTMLDivElement & { webkitRequestFullscreen?: () => void }) | null; if (!el) return;
    const pseudo = () => { pseudoFull.current = true; setFull(true); window.parent.postMessage({ type: "emcOutfitFullscreen", on: true }, "*"); };
    try {
      if (el.requestFullscreen) el.requestFullscreen().then(() => { setFull(true); try { void (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.("landscape")?.catch(() => {}); } catch { /* 部分瀏覽器不能鎖方向 */ } }).catch(pseudo);
      else if (el.webkitRequestFullscreen) { el.webkitRequestFullscreen(); setFull(true); }
      else pseudo();
    } catch { pseudo(); }
  };
  const exitFull = () => {
    if (document.fullscreenElement) void document.exitFullscreen?.();
    if (pseudoFull.current) { pseudoFull.current = false; window.parent.postMessage({ type: "emcOutfitFullscreen", on: false }, "*"); }
    setFull(false);
  };
  useEffect(() => {
    const h = () => { if (!document.fullscreenElement && !pseudoFull.current) setFull(false); };
    document.addEventListener("fullscreenchange", h);
    return () => document.removeEventListener("fullscreenchange", h);
  }, []);
  const hasMine = useMemo(() => Boolean(myName) && Boolean(characters) && (myName in (characters || {}) || DESIGN_FIRST.includes(myName)), [myName, characters]);

  useEffect(() => {
    if (!characters || cine !== "idle") return;
    const weak = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;
    // 手機、省流量、系統設定減少動態：先只放劇照＋播放鈕，點了才開始載影片（省流量、也保證有使用者手勢，iOS 才放得出來）
    if (window.innerWidth < 720 || weak || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) { setCine("tap"); return; }
    setCine("loading");
  }, [characters, cine]);
  useEffect(() => {   // 被瀏覽器擋成靜音時，使用者在頁面上第一次點擊就順便打開聲音
    if (cine !== "ready" || !muted) return;
    const on = (ev: Event) => { if ((ev.target as HTMLElement | null)?.closest?.(".th-ctls")) return; setMuted(false); frame.current?.contentWindow?.postMessage({ type: "cinemaMute", muted: false }, CINEMA_ORIGIN); };
    window.addEventListener("pointerdown", on, { once: true });
    return () => window.removeEventListener("pointerdown", on);
  }, [cine, muted]);
  useEffect(() => {
    if (cine !== "loading" && cine !== "ready") return;
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== CINEMA_ORIGIN || !e.data) return;
      if (e.data.type === "cinemaReady") setCine("ready");
      if (e.data.type === "cinemaCta") setCtaPulse(Boolean(e.data.on));
      if (e.data.type === "cinemaFail") setCine("off");   // 這個瀏覽器放不了或載太久：維持劇照
      if (e.data.type === "cinemaEnded") setEnded(Boolean(e.data.on));
      if (e.data.type === "cinemaMuted") setMuted(Boolean(e.data.muted));   // 瀏覽器不讓有聲播放時，影片頁會回報「仍是靜音」
    };
    window.addEventListener("message", onMessage);
    const giveUp = window.setTimeout(() => setCine((v) => (v === "loading" ? "off" : v)), 30000);   // 半分鐘還沒載好就放棄，維持劇照
    return () => { window.removeEventListener("message", onMessage); window.clearTimeout(giveUp); };
  }, [cine]);

  return <section className="th" aria-label="多元宇宙辦公室劇場">
    <div className="th-copy">
      <span className="th-eyebrow">EMC PIXEL OFFICE</span>
      <h2>歡迎入職，<br />你的位置留好了</h2>
      <p>上傳一張照片，AI 幫你做出專屬的像素角色。完成後你會出現在公司的多元宇宙裡，和同事一起上班、走動、聊天，是辦公室裡的一點小樂趣。</p>
      <button type="button" className={`th-cta${ctaPulse ? " pulse" : ""}`} onClick={onStart}>{hasMine ? "換一個新造型" : "做我的角色，入座"}<span aria-hidden>→</span></button>
      <small className="th-note">{cine === "tap" ? "點畫面上的播放鈕，看設計部的小短劇" : cine === "loading" ? "辦公室劇場載入中，稍等幾秒就開演" : cine === "ready" ? "正在上映：《最後一版》" : "設計部的日常，等你加入"}</small>
    </div>
    <div ref={stage} className={`th-stage${full ? " is-full" : ""}`} role="group" aria-label="辦公室劇場" style={cine === "ready" ? { cursor: "pointer" } : undefined} onPointerMove={() => { if (cine === "ready") wake(); }} onPointerDown={(e) => { tapHidden.current = !ctlOn && e.pointerType !== "mouse"; if (cine === "ready") wake(); }} onClick={(e) => { if (tapHidden.current) { tapHidden.current = false; return; } if (cine !== "ready" || (e.target as HTMLElement).closest(".th-ctls, .th-exit")) return; frame.current?.contentWindow?.postMessage({ type: "cinemaToggle" }, CINEMA_ORIGIN); }}>   {/* 點畫面暫停／繼續 */}
      {(cine === "loading" || cine === "ready") && <iframe ref={frame} className={`th-cine${cine === "ready" ? " on" : ""}`} title="辦公室劇場" tabIndex={-1} aria-hidden src={`${CINEMA_ORIGIN}/pixel-plaza/cinema-video.html?embed=1&v=${CINEMA_VERSION}`} allow="autoplay; fullscreen" />}
      {full && <button type="button" className={`th-exit${ctlOn || ended ? "" : " hide"}`} onClick={exitFull}>✕ 退出全螢幕</button>}
      {cine === "ready" && <div className={`th-ctls${ctlOn || ended ? "" : " hide"}`}>
        <button type="button" className="th-skip" onClick={() => (full ? exitFull() : enterFull())}>{full ? "縮小" : "全螢幕"}</button>
        <button type="button" className="th-skip" onClick={() => { const next = !muted; setMuted(next); frame.current?.contentWindow?.postMessage({ type: "cinemaMute", muted: next }, CINEMA_ORIGIN); }}>{muted ? "開聲音" : "關聲音"}</button>
        <button type="button" className="th-skip" onClick={() => frame.current?.contentWindow?.postMessage({ type: "cinemaPrev" }, CINEMA_ORIGIN)}><span aria-hidden>◂◂ </span>上一句</button>
        {ended ? <button type="button" className="th-skip" onClick={() => { setEnded(false); frame.current?.contentWindow?.postMessage({ type: "cinemaReplay" }, CINEMA_ORIGIN); }}>再看一次</button>
          : <button type="button" className="th-skip" onClick={() => frame.current?.contentWindow?.postMessage({ type: "cinemaSkip" }, CINEMA_ORIGIN)}>下一句<span aria-hidden> ▸▸</span></button>}
      </div>}
      {cine === "tap" && <button type="button" className="th-play" onClick={() => { setCine("loading"); enterFull(); }} aria-label="播放辦公室小短劇（全螢幕）"><svg viewBox="0 0 24 24" aria-hidden><path d="M8 5v14l11-7z" /></svg><span>點一下全螢幕播放</span></button>}
      {cine === "loading" && <span className="th-loading" aria-hidden><i /></span>}
    </div>
  </section>;
}
