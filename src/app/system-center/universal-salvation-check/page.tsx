"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { OperatorProvider } from "@/lib/operatorClient";
import OperatorBar from "@/components/system/OperatorBar";
import { fetchRegistration, toFriendlyError } from "@/lib/registrationFetch";

/**
 * V30.6：系統管理 → 普渡上線檢查（唯讀）。年度選擇／重新檢查／分類篩選／家戶·姓名搜尋／匯出 Excel／
 * 前往查看。頁面唯讀，不提供「全部修復」。權限由 API（view）把關。
 */

type Finding = {
  category: string; household: string; subject: string;
  recordId: string | null; entryId: string | null; itemId: string | null;
  createdAt: string | null; reason: string; action: string; memberId: string | null;
};

export default function PreLaunchCheckPage() {
  return (
    <OperatorProvider>
      <div className="min-h-screen">
        <OperatorBar />
        <Inner />
      </div>
    </OperatorProvider>
  );
}

function Inner() {
  const currentYear = new Date().getFullYear() - 1911;
  const [year, setYear] = useState(currentYear === 0 ? 115 : currentYear);
  const [findings, setFindings] = useState<Finding[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cat, setCat] = useState("");
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    setFindings(null);
    try {
      const res = await fetchRegistration(`/api/universal-salvation/${year}/pre-launch-check`);
      const data = await res.json();
      if (!res.ok) { setError(toFriendlyError(res.status, data?.error)); return; }
      setFindings(data.findings ?? []);
      setError(null);
    } catch {
      setError("讀取上線前檢查時發生連線問題。");
    }
  }, [year]);

  useEffect(() => { void load(); }, [load]);

  const categories = useMemo(() => [...new Set((findings ?? []).map((f) => f.category))], [findings]);
  const filtered = useMemo(() => {
    const nq = q.trim();
    return (findings ?? []).filter((f) =>
      (!cat || f.category === cat) &&
      (!nq || f.household.includes(nq) || f.subject.includes(nq))
    );
  }, [findings, cat, q]);

  const summary = useMemo(() => {
    const m = new Map<string, number>();
    for (const f of findings ?? []) m.set(f.category, (m.get(f.category) ?? 0) + 1);
    return [...m.entries()];
  }, [findings]);

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg text-ink">系統管理・普渡上線檢查（唯讀）</h1>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <label className="flex items-center gap-1 text-ink-soft">年度
            <input type="number" value={year} onChange={(e) => setYear(Number(e.target.value) || currentYear)} className="w-24 rounded-xl border border-cream-300 px-3 py-1.5" />
          </label>
          <button type="button" onClick={() => void load()} className="rounded-full bg-sage-100 px-4 py-1.5 text-ink hover:bg-sage-200">重新檢查</button>
          <a href={`/api/universal-salvation/${year}/pre-launch-check?format=xlsx`} className="rounded-full bg-yolk-200 px-4 py-1.5 text-ink hover:bg-yolk-300">匯出 Excel</a>
        </div>
      </div>

      {error && <p className="mb-3 text-sm text-blossom-500">{error}</p>}

      {findings !== null && (
        <div className="mb-4 flex flex-wrap gap-2">
          <button type="button" onClick={() => setCat("")} className={`rounded-full px-3 py-1 text-xs ${cat === "" ? "bg-ink-soft text-cream-50" : "bg-cream-100 text-ink-soft"}`}>全部（{findings.length}）</button>
          {summary.map(([c, n]) => (
            <button key={c} type="button" onClick={() => setCat(c)} className={`rounded-full px-3 py-1 text-xs ${cat === c ? "bg-ink-soft text-cream-50" : "bg-cream-100 text-ink-soft"}`}>{c}（{n}）</button>
          ))}
        </div>
      )}

      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜尋家戶／姓名" className="mb-3 w-full rounded-xl border border-cream-300 px-3 py-2 text-sm sm:w-72" />

      {findings === null ? (
        <p className="text-sm text-ink-faint">檢查中…</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-ink-faint">沒有符合條件的待處理項目。</p>
      ) : (
        <div className="overflow-x-auto rounded-3xl bg-white/70 p-3 shadow-card">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="text-ink-faint">
                <th className="px-2 py-1">問題類型</th><th className="px-2 py-1">家戶</th><th className="px-2 py-1">對象</th>
                <th className="px-2 py-1">id</th><th className="px-2 py-1">建立時間</th><th className="px-2 py-1">原因</th>
                <th className="px-2 py-1">建議處理</th><th className="px-2 py-1">前往</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((f, i) => (
                <tr key={i} className="border-t border-cream-200">
                  <td className="px-2 py-1 text-ink">{f.category}</td>
                  <td className="px-2 py-1 text-ink-soft">{f.household}</td>
                  <td className="px-2 py-1 text-ink-soft">{f.subject}</td>
                  <td className="px-2 py-1 text-ink-faint">{f.recordId ? `r:${f.recordId.slice(-6)}` : f.entryId ? `e:${f.entryId.slice(-6)}` : f.itemId ? `i:${f.itemId.slice(-6)}` : "—"}</td>
                  <td className="px-2 py-1 text-ink-faint">{f.createdAt ? f.createdAt.slice(0, 10) : "—"}</td>
                  <td className="px-2 py-1 text-ink-soft">{f.reason}</td>
                  <td className="px-2 py-1 text-ink-faint">{f.action}</td>
                  <td className="px-2 py-1">
                    {f.memberId ? (
                      <Link href={`/devotee-center/${f.memberId}`} className="text-yolk-700 underline">信眾</Link>
                    ) : f.recordId ? (
                      <Link href={`/registration/${f.recordId}`} className="text-yolk-700 underline">報名</Link>
                    ) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
