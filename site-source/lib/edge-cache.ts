/**
 * Cloudflare 邊緣快取（Cache API）：像素辦公室第一次進站（尤其是無痕視窗、瀏覽器沒有快取）要抓十幾張服裝圖與清單，
 * 每個請求都經過 Worker 與資料庫約 1.7 秒，造成人物遲遲不出現。同一個邊緣節點第二次起直接回快取。
 * 讀不到或不支援（本機開發）時就直接走原本的流程，不影響結果。
 */
export async function edgeCached(request: Request, ttlSeconds: number, build: () => Promise<Response>): Promise<Response> {
  const store = (globalThis as unknown as { caches?: { default?: Cache } }).caches?.default;
  if (!store) return build();
  const key = new Request(new URL(request.url).toString(), { method: "GET" });
  try {
    const hit = await store.match(key);
    if (hit) return hit;
  } catch { /* 快取讀取失敗就當沒有 */ }
  const fresh = await build();
  if (fresh.status === 200) {
    const copy = new Response(fresh.clone().body, fresh);
    copy.headers.set("Cache-Control", `public, max-age=${ttlSeconds}`);
    try { await store.put(key, copy); } catch { /* 寫不進去也沒關係 */ }
  }
  return fresh;
}
