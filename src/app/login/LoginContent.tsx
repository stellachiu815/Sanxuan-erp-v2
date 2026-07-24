"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

/**
 * V14.3：登入表單內容（Client Component）。
 *
 * useSearchParams() 需要在 Suspense 邊界內使用（Next.js 15 靜態預渲染要求），
 * 因此把「會讀 query（next、session）」的內容抽成這個元件，由 page.tsx 用
 * <Suspense> 包住。不改動登入流程本身、不動 session / middleware。
 */
export default function LoginContent() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/";
  // 被 401 兜底導回來時帶 ?session=expired，顯示「登入已失效」。
  const sessionExpired = params.get("session") === "expired";
  const [account, setAccount] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account: account.trim(), password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "登入失敗，請稍後再試。");
        return;
      }
      router.replace(next);
      router.refresh();
    } catch {
      setError("網路連線問題，請稍後再試。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="w-full max-w-sm rounded-3xl bg-white/70 p-8 shadow-card">
      <h1 className="text-center text-xl font-medium text-ink">台北三玄宮行政系統</h1>
      <p className="mt-1 text-center text-sm text-ink-faint">請登入</p>

      {sessionExpired && (
        <p className="mt-4 rounded-xl bg-butter-100 px-3 py-2 text-center text-sm text-ink-soft">
          登入已失效，請重新登入。
        </p>
      )}

      <label className="mt-6 block text-sm text-ink-soft">
        帳號
        <input
          className="mt-1 w-full rounded-xl border border-cream-300 px-3 py-2 text-sm"
          value={account}
          onChange={(e) => setAccount(e.target.value)}
          autoFocus
          autoComplete="username"
        />
      </label>
      <label className="mt-4 block text-sm text-ink-soft">
        密碼
        <input
          type="password"
          className="mt-1 w-full rounded-xl border border-cream-300 px-3 py-2 text-sm"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
        />
      </label>

      {error && <p className="mt-3 text-sm text-blossom-500">{error}</p>}

      <button
        type="submit"
        disabled={busy || !account.trim() || !password}
        className="mt-6 w-full rounded-full bg-sage-200 px-4 py-2.5 text-sm text-ink transition hover:bg-sage-300 disabled:opacity-50"
      >
        {busy ? "登入中…" : "登入"}
      </button>
    </form>
  );
}
