import { getTask, keyOk, putTask, type TaskKind } from "@/lib/local-worker";
export async function POST(request: Request) {
  if (!keyOk(request)) return Response.json({ error: "forbidden" }, { status: 403 });
  const b = await request.json().catch(() => ({})) as { kind?: TaskKind; id?: string; step?: string; pct?: number; note?: string; error?: string; failed?: boolean };
  if (!b.id || (b.kind !== "grid" && b.kind !== "walk")) return Response.json({ error: "bad" }, { status: 400 });
  const t = await getTask(b.kind, b.id); if (!t) return Response.json({ error: "no task" }, { status: 404 });
  if (typeof b.step === "string") t.step = b.step.slice(0, 80);
  if (typeof b.pct === "number") t.pct = Math.max(0, Math.min(99, Math.round(b.pct)));
  if (typeof b.note === "string") t.note = b.note.slice(0, 160);
  if (b.failed) { t.status = "failed"; t.error = String(b.error || "失敗").slice(0, 160); t.finishedAt = Date.now(); }
  t.updatedAt = Date.now(); await putTask(t); return Response.json({ ok: true });
}
