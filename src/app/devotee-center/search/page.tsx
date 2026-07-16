"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { OperatorProvider, useOperator } from "@/lib/operatorClient";
import OperatorBar from "@/components/system/OperatorBar";
import DevoteeCenterGate from "@/components/devotee/DevoteeCenterGate";

type SearchResult = { category: string; id: string; title: string; subtitle: string; href: string };
type SearchResponse = { query: string; groups: { category: string; label: string; results: SearchResult[] }[]; total: number };

function GlobalSearchInner() {
  const { operatorUserId } = useOperator();
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [data, setData] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 350);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    if (!operatorUserId || !debouncedQ.trim()) {
      setData(null);
      return;
    }
    setLoading(true);
    fetch(`/api/devotee-center/search?operatorUserId=${encodeURIComponent(operatorUserId)}&q=${encodeURIComponent(debouncedQ)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((d) => setData(d))
      .finally(() => setLoading(false));
  }, [operatorUserId, debouncedQ]);

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-3xl bg-white/70 p-5 shadow-card">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="搜尋信眾姓名/家戶/電話/地址/活動/祭祀姓名/祖先名稱/乙位正魂/冤親債主/供品認捐人/收款人/收據抬頭/收據號碼"
          className="w-full rounded-full border border-cream-200 bg-cream-50 px-4 py-2 text-sm text-ink"
        />
      </div>

      {loading && <p className="text-sm text-ink-faint">搜尋中…</p>}

      {data && data.groups.length === 0 && !loading && <p className="text-sm text-ink-faint">找不到符合的結果。</p>}

      {data && (
        <div className="flex flex-col gap-4">
          {data.groups.map((g) => (
            <section key={g.category} className="rounded-3xl bg-white/70 p-5 shadow-card">
              <h2 className="text-sm font-medium text-ink">
                {g.label}（{g.results.length}）
              </h2>
              <ul className="mt-3 flex flex-col gap-1">
                {g.results.map((r) => (
                  <li key={r.id}>
                    <Link href={r.href} className="flex items-center justify-between rounded-xl px-3 py-2 text-sm hover:bg-cream-100">
                      <span className="text-ink">{r.title}</span>
                      <span className="text-xs text-ink-faint">{r.subtitle}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

export default function DevoteeSearchPage() {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-cream-200 bg-cream-50/90 px-6 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4">
          <Link href="/devotee-center" className="text-sm text-ink-soft hover:underline">
            ← 信眾關係中心
          </Link>
          <h1 className="text-sm text-ink-soft">🔎 全宮整合搜尋</h1>
        </div>
      </header>

      <main className="mx-auto flex max-w-4xl flex-col gap-8 px-6 py-10">
        <OperatorProvider>
          <OperatorBar />
          <DevoteeCenterGate>
            <GlobalSearchInner />
          </DevoteeCenterGate>
        </OperatorProvider>
      </main>
    </div>
  );
}
