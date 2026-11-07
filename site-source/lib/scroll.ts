/** 回到服裝頁最上方。內嵌在設計需求系統時，iframe 自己不會捲（高度跟內容一樣），要請外層捲到 iframe 頂端。 */
export function scrollStudioTop() {
  try { window.scrollTo({ top: 0, behavior: "smooth" }); } catch { /* 略過 */ }
  try { if (window.parent !== window) window.parent.postMessage({ type: "emcOutfitScroll", y: 0 }, "*"); } catch { /* 外層不收就算了 */ }
}

/** 捲到頁面裡某個區塊（id）。內嵌時 iframe 自己不會捲，把區塊的位置回報給外層捲。 */
export function scrollStudioTo(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  const y = Math.max(0, Math.round(el.getBoundingClientRect().top + window.scrollY - 8));
  try { window.scrollTo({ top: y, behavior: "smooth" }); } catch { /* 略過 */ }
  try { if (window.parent !== window) window.parent.postMessage({ type: "emcOutfitScroll", y }, "*"); } catch { /* 外層不收就算了 */ }
}
