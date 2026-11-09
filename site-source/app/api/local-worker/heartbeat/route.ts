import { beat, keyOk } from "@/lib/local-worker";
export async function POST(request: Request) {
  if (!keyOk(request)) return Response.json({ error: "forbidden" }, { status: 403 });
  await beat(); return Response.json({ ok: true });
}
