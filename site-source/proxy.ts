import { NextResponse, type NextRequest } from "next/server";
import { allowedOrigin, authorize, AUTH_COOKIE, corsHeaders } from "@/lib/access";

const PUBLIC_PATHS = new Set(["/login", "/api/login", "/api/logout", "/favicon.svg"]);

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const origin = allowedOrigin(request.headers.get("origin"));
  const cors = origin && pathname.startsWith("/api/") ? corsHeaders(origin) : null;

  if (request.method === "OPTIONS" && cors) return new NextResponse(null, { status: 204, headers: cors });

  if (!PUBLIC_PATHS.has(pathname) && !await authorize(request, request.cookies.get(AUTH_COOKIE)?.value)) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "需要登入：請輸入團隊密碼。", reason: "AUTH_REQUIRED" }, { status: 401, headers: cors ?? undefined });
    }
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname + search);
    return NextResponse.redirect(loginUrl);
  }

  const response = NextResponse.next();
  if (cors) Object.entries(cors).forEach(([key, value]) => response.headers.set(key, value));
  return response;
}

export const config = {
  matcher: ["/((?!_next/|assets/).*)"],
};
