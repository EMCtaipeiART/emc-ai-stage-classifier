/** 回到服裝頁最上方。內嵌在設計需求系統時，iframe 自己不會捲（高度跟內容一樣），要請外層捲到 iframe 頂端。 */
export function scrollStudioTop() {
  try { window.scrollTo({ top: 0, behavior: "smooth" }); } catch { /* 略過 */ }
  try { if (window.parent !== window) window.parent.postMessage({ type: "emcOutfitScroll", y: 0 }, "*"); } catch { /* 外層不收就算了 */ }
}
