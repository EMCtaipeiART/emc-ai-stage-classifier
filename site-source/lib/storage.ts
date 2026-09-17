import { env } from "cloudflare:workers";

// 附件優先存 R2（OpenAI Sites 預設），沒有 R2 時改存 KV（單檔上限 25MB）
export function assetStorageReady() {
  return Boolean(env.BUCKET || env.ASSETS_KV);
}

export async function putAsset(key: string, data: Uint8Array | ArrayBuffer, contentType: string) {
  if (env.BUCKET) {
    await env.BUCKET.put(key, data, { httpMetadata: { contentType } });
  } else if (env.ASSETS_KV) {
    await env.ASSETS_KV.put(key, data);
  } else {
    throw new Error("檔案儲存空間尚未啟用。");
  }
}

export async function getAsset(key: string): Promise<ReadableStream | null> {
  if (env.BUCKET) return (await env.BUCKET.get(key))?.body ?? null;
  if (env.ASSETS_KV) return env.ASSETS_KV.get(key, "stream");
  return null;
}
