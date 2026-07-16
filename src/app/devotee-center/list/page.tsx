"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { OperatorProvider, useOperator } from "@/lib/operatorClient";
import OperatorBar from "@/components/system/OperatorBar";
import DevoteeCenterGate from "@/components/devotee/DevoteeCenterGate";

type DevoteeRow = {
  memberId: string;
  name: string;
  householdId: string;
  householdName: string;
  householdContactName: string | null;
  mobile: string | null;
  householdPhone: string | null;
  householdAddress: string | null;
  solarBirthDate: string | null;
  lunarBirthDisplay: string | null;
  zodiac: string | null;
  isDeceased: boolean;
  isDisabled: boolean;
  tags: string[];
  lastActivityAt: string | null;
  lastPaymentAt: string | null;
};

type ListResponse = { rows: DevoteeRow[]; total: number; page: number; pageSize: number };

const FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: "ACTIVE", label: "在用" },
  { value: "DISABLED", label: "停用" },
  { value: "DECEASED", label: "已往生" },
  { value: "HAS_PHONE", label: "有電話" },
  { value: "NO_PHONE", label: "無電話" },
  { value: "HAS_ADDRESS", label: "有地址" },
  { value: "NO_ADDRESS", label: "無地址" },
  { value: "BIRTHDAY_THIS_MONTH", label: "本月生日" },
  { value: "ACTIVE_THIS_YEAR", label: "本年度參加活動" },
  { value: "INACTIVE_OVER_1YEAR", label: "一年以上未參加活動" },
  { value: "NEEDS_CARE", label: "需要關懷" },
  { value: "TAG_VIP", label: "VIP" },
  { value: "TAG_VOLUNTEER", label: "義工" },
  { value: "TAG_COMMITTEE", label: "宮委" },
];

function DevoteeListInner() {
  const { operatorUserId } = useOperator();
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [filters, setFilters] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [data, setData] = useState<ListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 對應指令「十八」：搜尋輸入需要 debounce，不是每個按鍵都打一次 API。
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 350);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    setPage(1);
  }, [debouncedQ, filters, pageSize]);

  useEffect(() => {
    if (!operatorUserId) return;
    const params = new URLSearchParams({
      operatorUserId,
      page: String(page),
      pageSize: String(pageSize),
    });
    if (debouncedQ) params.set("q", debouncedQ);
    if (filters.length) params.set("filters", filters.join(","));

    fetch(`/api/devotee-center/list?${params.toString()}`)
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "載入失敗");
        return res.json();
      })
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e) => setError(e.message));
  }, [operatorUserId, debouncedQ, filters, page, pageSize]);

  const totalPages = useMemo(() => (data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1), [data]);

  function toggleFilter(value: string) {
    setFilters((prev) => (prev.includes(value) ? prev.filter((f) => f !== value) : [...prev, value]));
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-3xl bg-white/70 p-5 shadow-card">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="搜尋姓名/電話/地址/家戶編號/主要聯絡人/公司名稱/Email/LINE ID/標籤"
          className="w-full rounded-full border border-cream-200 bg-cream-50 px-4 py-2 text-sm text-ink"
        />
        <div className="mt-3 flex flex-wrap gap-2">
          {FILTER_OPTIONS.map((f) => (
            <button
              key={f.value}
              onClick={() => toggleFilter(f.value)}
              className={`rounded-full px-3 py-1 text-xs transition ${
                filters.includes(f.value) ? "bg-sage-200 text-ink" : "bg-cream-100 text-ink-soft hover:bg-cream-200"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="rounded-3xl bg-blossom-100 p-4 text-sm text-ink">{error}</div>}

      {data && (
        <div className="overflow-x-auto rounded-3xl bg-white/70 p-4 shadow-card">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead>
              <tr className="text-xs text-ink-faint">
                <th className="px-3 py-2">姓名</th>
                <th className="px-3 py-2">所屬家戶</th>
                <th className="px-3 py-2">手機/電話</th>
                <th className="px-3 py-2">地址</th>
                <th className="px-3 py-2">生日</th>
                <th className="px-3 py-2">生肖</th>
                <th className="px-3 py-2">標籤</th>
                <th className="px-3 py-2">最近參加活動</th>
                <th className="px-3 py-2">最近收款</th>
                <th className="px-3 py-2">狀態</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.memberId} className="border-t border-cream-200">
                  <td className="px-3 py-2 text-ink">{r.name}</td>
                  <td className="px-3 py-2 text-ink-soft">{r.householdName}（{r.householdId}）</td>
                  <td className="px-3 py-2 text-ink-soft">{r.mobile || r.householdPhone || "—"}</td>
                  <td className="px-3 py-2 text-ink-soft">{r.householdAddress || "—"}</td>
                  <td className="px-3 py-2 text-ink-soft">{r.solarBirthDate || r.lunarBirthDisplay || "—"}</td>
                  <td className="px-3 py-2 text-ink-soft">{r.zodiac || "—"}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {r.tags.map((t) => (
                        <span key={t} className="rounded-full bg-yolk-100 px-2 py-0.5 text-xs text-ink-soft">
                          {t}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-ink-soft">{r.lastActivityAt || "—"}</td>
                  <td className="px-3 py-2 text-ink-soft">{r.lastPaymentAt || "—"}</td>
                  <td className="px-3 py-2 text-xs text-ink-soft">
                    {r.isDeceased && <span className="mr-1 rounded-full bg-cream-300 px-2 py-0.5">已往生</span>}
                    {r.isDisabled && <span className="rounded-full bg-blossom-200 px-2 py-0.5">停用</span>}
                    {!r.isDeceased && !r.isDisabled && "在用"}
                  </td>
                  <td className="px-3 py-2">
                    <Link href={`/devotee-center/${r.memberId}`} className="text-xs text-ink-faint underline-offset-4 hover:underline">
                      查看完整資料 →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
            <span className="text-ink-faint">共 {data.total} 筆</span>
            <div className="flex items-center gap-2">
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="rounded-full bg-cream-100 px-3 py-1 disabled:opacity-40"
              >
                上一頁
              </button>
              <span className="text-ink-soft">
                第 {data.page} / {totalPages} 頁
              </span>
              <button
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="rounded-full bg-cream-100 px-3 py-1 disabled:opacity-40"
              >
                下一頁
              </button>
              <select
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value))}
                className="rounded-full border border-cream-200 bg-cream-50 px-2 py-1"
              >
                {[10, 20, 50, 100].map((n) => (
                  <option key={n} value={n}>
                    每頁 {n} 筆
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function DevoteeListPage() {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-cream-200 bg-cream-50/90 px-6 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
          <Link href="/devotee-center" className="text-sm text-ink-soft hover:underline">
            ← 信眾關係中心
          </Link>
          <h1 className="text-sm text-ink-soft">📋 信眾名單</h1>
        </div>
      </header>

      <main className="mx-auto flex max-w-6xl flex-col gap-8 px-6 py-10">
        <OperatorProvider>
          <OperatorBar />
          <DevoteeCenterGate>
            <DevoteeListInner />
          </DevoteeCenterGate>
        </OperatorProvider>
      </main>
    </div>
  );
}
