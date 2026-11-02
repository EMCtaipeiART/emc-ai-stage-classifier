import { NextResponse, type NextRequest } from "next/server";
import { allowedOrigin, authorize, AUTH_COOKIE, corsHeaders } from "@/lib/access";

// /outfit 只是頁面外殼（沒有任何資料）：設計需求系統的 token 在網址 # 後面，瀏覽器導覽時帶不了標頭，所以頁面本身不擋，資料與生成的 API 一律要驗證。
const PUBLIC_PATHS = new Set(["/favicon.svg", "/outfit"]);

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const origin = allowedOrigin(request.headers.get("origin"));
  const cors = origin && pathname.startsWith("/api/") ? corsHeaders(origin) : null;

  if (request.method === "OPTIONS" && cors) return new NextResponse(null, { status: 204, headers: cors });

  // /api/public/ 是給 Pixel Office 遊戲讀的公開資料（已發佈的服裝），不需要登入
  if (!PUBLIC_PATHS.has(pathname) && !pathname.startsWith("/api/public/") && !await authorize(request, request.cookies.get(AUTH_COOKIE)?.value)) {
    if (pathname.startsWith("/api/")) {
      const had = request.headers.get("x-emc-editor-token");
      return NextResponse.json({ error: had ? "登入已失效：請回設計需求系統重新整理頁面（或重新登入）後再操作。" : "沒有收到登入資訊：請從設計需求系統左側選單的「服裝」進入，不要直接開這個網址。", reason: had ? "TOKEN_INVALID" : "NO_TOKEN", path: pathname }, { status: 401, headers: cors ?? undefined });
    }
    return NextResponse.redirect("https://emc-art.com/");   // 沒有登入帳號：回設計需求系統登入後再進來
  }

  const response = NextResponse.next();
  if (cors) Object.entries(cors).forEach(([key, value]) => response.headers.set(key, value));
  return response;
}

export const config = {
  matcher: ["/((?!_next/|assets/).*)"],
};
