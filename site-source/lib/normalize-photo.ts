/** 上傳前把任何照片轉成真正的 JPEG（最長邊 1600）：副檔名是 .jpg 但內容其實是 HEIC、或檔案毀損時，
 *  OpenAI 會回「The image data you provided does not represent a valid image」。Safari 能解 HEIC；解不開就明講。 */
export async function normalizePhoto(file: File, maxSide = 1600): Promise<File> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no canvas");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);   // 透明底補白，JPEG 不支援透明
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
    if (!blob) throw new Error("no blob");
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    throw new Error("這張照片無法讀取（可能是 iPhone 的 HEIC 格式或檔案損毀），請改用 JPG／PNG，或用截圖再上傳。");
  }
}
