import { whoami } from "@/lib/coins-client";
import { deleteItem, getItem, itemPublic, updateItem } from "@/lib/outfit-items";

const clamp = (value: unknown, min: number, max: number, fallback = 0) => { const n = Number(value); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback; };

function cleanHead(input: unknown) {
  const head = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const triple = (value: unknown) => (Array.isArray(value) ? value : []).concat([0, 0, 0]).slice(0, 3).map((n) => clamp(n, -200, 200)) as [number, number, number];
  return { headIndex: Math.round(clamp(head.headIndex, 0, 4)), scale: clamp(head.scale, 0.6, 1.5, 1), dx: triple(head.dx), dy: triple(head.dy) };
}
function cleanViews(input: unknown) {
  if (!Array.isArray(input) || input.length !== 3) return null;
  const views = input.map((value) => { const v = (value || {}) as Record<string, unknown>; return { x0: clamp(v.x0, 0, 20000), y0: clamp(v.y0, 0, 20000), x1: clamp(v.x1, 0, 20000), y1: clamp(v.y1, 0, 20000), neckX: clamp(v.neckX, 0, 20000), neckY: clamp(v.neckY, 0, 20000) }; });
  return views.every((v) => v.x1 > v.x0 && v.y1 > v.y0) ? views : null;
}
function pngBytes(dataUrl: unknown, maxBase64 = 9_000_000): Uint8Array | null {
  const match = String(dataUrl || "").match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/);
  if (!match || match[1].length > maxBase64) return null;
  const binary = atob(match[1]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** 儲存調整／完成／設為預設：{ name, isDefault, head, views, cover, complete }。 */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const who = await whoami(request);
  if (!who) return Response.json({ error: "請從設計需求系統登入後進入這個頁面。" }, { status: 401 });
  const { id } = await context.params;
  const row = await getItem(id);
  if (!row || row.owner_account !== who.account || row.status === "deleted") return Response.json({ error: "找不到這件服裝" }, { status: 404 });
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const update: Parameters<typeof updateItem>[1] = {};
  if (body.name !== undefined) {
    const name = String(body.name).replace(/\s+/g, " ").trim().slice(0, 30);
    if (!name) return Response.json({ error: "請幫這件服裝取個名字" }, { status: 400 });
    update.name = name;
  }
  if (body.head !== undefined) update.head = cleanHead(body.head);
  if (body.views !== undefined) { const views = cleanViews(body.views); if (!views) return Response.json({ error: "三個角度的位置資料不正確" }, { status: 400 }); update.views = views; }
  if (body.cover !== undefined) { const cover = pngBytes(body.cover); if (!cover) return Response.json({ error: "預覽圖不正確或太大" }, { status: 400 }); update.cover = cover; }
  if (body.game !== undefined || body.viewImages !== undefined) {
    // 發佈給遊戲：三個角度裁好的身體圖（高 336、透明）＋各角度尺寸與頸頂位置＋頭的設定
    const game = (body.game || {}) as { views?: unknown[]; head?: unknown };
    const images = Array.isArray(body.viewImages) ? body.viewImages.map((image) => pngBytes(image, 2_500_000)) : [];
    const views = Array.isArray(game.views) ? game.views.map((value) => { const v = (value || {}) as Record<string, unknown>; return { w: clamp(v.w, 1, 3000), h: clamp(v.h, 1, 3000), n: clamp(v.n, 0, 3000) }; }) : [];
    if (images.length !== 3 || images.some((image) => !image) || views.length !== 3) return Response.json({ error: "發佈給遊戲的圖片或位置資料不正確" }, { status: 400 });
    update.game = { scale: 2, refHeight: 168, views, head: cleanHead(game.head) };
    update.viewImages = images as Uint8Array[];
  }
  if (body.isDefault !== undefined) update.isDefault = Boolean(body.isDefault);
  if (body.complete === true) {
    if (row.status !== "draft" && row.status !== "completed") return Response.json({ error: "這件服裝無法完成" }, { status: 400 });
    if (!(update.name || row.name) || !(update.head || row.head_json) || !(update.views || row.views_json) || !(update.cover || row.cover_key)) return Response.json({ error: "要先套上大頭、取名字並產生預覽圖，才能完成" }, { status: 400 });
    update.complete = true;
  }
  if (update.isDefault && row.status !== "completed" && !update.complete) return Response.json({ error: "完成服裝製作後才能設為預設" }, { status: 400 });
  await updateItem(row, update);
  const fresh = await getItem(id);
  return Response.json({ ok: true, item: fresh ? itemPublic(fresh) : null });
}

/** 刪除（軟刪除：從清單移除，紀錄與圖片仍保留）。 */
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const who = await whoami(request);
  if (!who) return Response.json({ error: "請從設計需求系統登入後進入這個頁面。" }, { status: 401 });
  const { id } = await context.params;
  const row = await getItem(id);
  if (!row || row.owner_account !== who.account || row.status === "deleted") return Response.json({ error: "找不到這件服裝" }, { status: 404 });
  await deleteItem(row);
  return Response.json({ ok: true });
}
