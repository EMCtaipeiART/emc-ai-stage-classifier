import { NextResponse, type NextRequest } from "next/server";
import { accessPassword, AUTH_COOKIE, sessionToken } from "@/lib/access";

const PUBLIC_PATHS = new Set(["/login", "/api/login", "/api/logout", "/favicon.svg"]);

export async function proxy(request: NextRequest) {
  const password = accessPassword();
  if (!password) return NextResponse.next();

  const { pathname, search } = request.nextUrl;
  if (PUBLIC_PATHS.has(pathname)) return NextResponse.next();

  if (request.cookies.get(AUTH_COOKIE)?.value === await sessionToken(password)) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "登入已失效，請重新整理頁面並輸入團隊密碼。" }, { status: 401 });
  }
  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", pathname + search);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/|assets/).*)"],
};
