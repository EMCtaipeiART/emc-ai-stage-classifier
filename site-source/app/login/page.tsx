"use client";

import { FormEvent, useState } from "react";
import { LoaderCircle, LockKeyhole } from "lucide-react";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "登入失敗，請稍後再試。");
      const next = new URLSearchParams(window.location.search).get("next");
      window.location.href = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "登入失敗，請稍後再試。");
      setLoading(false);
    }
  }

  return <main className="login-shell">
    <form className="panel login-card" onSubmit={submit}>
      <span className="login-icon"><LockKeyhole size={24} /></span>
      <h1>EMC AI 階段判定器</h1>
      <p>請輸入團隊密碼後使用。</p>
      <input type="password" autoComplete="current-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} placeholder="團隊密碼" aria-label="團隊密碼" />
      {error && <p className="error" role="alert">{error}</p>}
      <button className="analyze" disabled={loading || !password}>{loading ? <><LoaderCircle className="spin" size={18} />登入中…</> : "登入"}</button>
    </form>
  </main>;
}
