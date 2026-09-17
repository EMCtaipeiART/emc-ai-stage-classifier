import { accessPassword, AUTH_COOKIE, SESSION_MAX_AGE, sessionToken } from "@/lib/access";

export async function POST(request: Request) {
  const password = accessPassword();
  if (!password) return Response.json({ ok: true });

  const body = await request.json().catch(() => ({})) as { password?: unknown };
  const input = typeof body.password === "string" ? body.password : "";
  const [expected, actual] = await Promise.all([sessionToken(password), sessionToken(input)]);
  if (expected !== actual) {
    // 放慢猜密碼的速度
    await new Promise((resolve) => setTimeout(resolve, 800));
    return Response.json({ error: "密碼不正確。" }, { status: 401 });
  }

  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return Response.json({ ok: true }, {
    headers: { "Set-Cookie": `${AUTH_COOKIE}=${expected}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE}${secure}` },
  });
}
