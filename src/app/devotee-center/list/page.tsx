"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
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

// V12「信眾資料中心正式建置」指令「六、信眾列表快速篩選」：全部／缺出生
// 年月日／缺地址／缺電話／資料完整，獨立放在搜尋框正下方最顯眼的位置，
// 跟上面既有的細部篩選（FILTER_OPTIONS）分開——這是「待補資料」工作流程
// 最常用到的幾個按鈕，不希望被埋在 14 個選項中間。「缺地址」「缺電話」
// 沿用既有的 NO_ADDRESS／NO_PHONE，不重複定義。
const QUICK_FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: "NO_BIRTHDAY", label: "缺出生年月日" },
  { value: "NO_ADDRESS", label: "缺地址" },
  { value: "NO_PHONE", label: "缺電話" },
  { value: "DATA_COMPLETE", label: "資料完整" },
];

function DevoteeListInner() {
  const { operatorUserId } = useOperator();
  // 對應指令「五、待補資料」：從首頁統計數字點進來時，網址會帶
  // ?filters=NO_BIRTHDAY 這類參數，這裡讀出來當作篩選的初始值，讓「點擊
  // 數字直接看到對應名單」真的成立，不是只有停在空白的名單頁。
  const urlParams = useSearchParams();
  const [q, setQ] = useState(() => urlParams.get("q") ?? "");
  const [debouncedQ, setDebouncedQ] = useState(() => urlParams.get("q") ?? "");
  const [filters, setFilters] = useState<string[]>(() => {
    const raw = urlParams.get("filters");
    return raw ? raw.split(",").map((f) => f.trim()).filter(Boolean) : [];
  });
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

  // 對應指令「七、上一位／下一位」：把目前的搜尋字／篩選條件一起帶到
  // 信眾完整資料編輯頁，讓上一位/下一位可以在同一個篩選範圍內移動
  // （見 src/lib/devoteeList.ts getAdjacentDevoteeIds() 說明）。
  const detailQueryString = useMemo(() => {
    const params = new URLSearchParams();
    if (debouncedQ) params.set("q", debouncedQ);
    if (filters.length) params.set("filters", filters.join(","));
    const s = params.toString();
    return s ? `?${s}` : "";
  }, [debouncedQ, filters]);

  function toggleFilter(value: string) {
    setFilters((prev) => (prev.includes(value) ? prev.filter((f) => f !== value) : [...prev, value]));
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-3xl bg-white/70 p-5 shadow-card">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="搜尋姓名/戶名/電話/地址/家戶編號/主要聯絡人/公司名稱/Email/LINE ID/標籤"
          className="w-full rounded-full border border-cream-200 bg-cream-50 px-4 py-2 text-sm text-ink"
        />

        {/* 對應指令「六」：全部／缺出生年月日／缺地址／缺電話／資料完整，
            放在搜尋框正下方最顯眼的位置。 */}
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            onClick={() => setFilters([])}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
              filters.length === 0 ? "bg-yolk-200 text-ink" : "bg-cream-100 text-ink-soft hover:bg-cream-200"
            }`}
          >
            全部
          </button>
          {QUICK_FILTER_OPTIONS.map((f) => (
            <button
              key={f.value}
              onClick={() => toggleFilter(f.value)}
              className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                filters.includes(f.value) ? "bg-yolk-200 text-ink" : "bg-cream-100 text-ink-soft hover:bg-cream-200"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap gap-2 border-t border-cream-200 pt-3">
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
          <table className="w-full min-w-[1050px] text-left text-sm">
            <thead>
              <tr className="text-xs text-ink-faint">
                <th className="px-3 py-2">姓名</th>
                <th className="px-3 py-2">家戶編號</th>
                <th className="px-3 py-2">戶名</th>
                <th className="px-3 py-2">出生年月日</th>
                <th className="px-3 py-2">地址</th>
                <th className="px-3 py-2">電話</th>
                <th className="px-3 py-2">標籤</th>
                <th className="px-3 py-2">最近參加活動</th>
                <th className="px-3 py-2">最近收款</th>
                <th className="px-3 py-2">狀態</th>
                {/* 對應指令「二」：列表至少需顯示「資料狀態」——這裡指資料
                    完整度（定義同指令「五」：姓名＋生日其中一種＋家戶地址），
                    跟左邊既有的「狀態」欄（在用／停用／已往生）是不同的兩件事，
                    分開各自一欄，不合併也不覆蓋既有欄位。 */}
                <th className="px-3 py-2">資料狀態</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => {
                const hasBirthday = Boolean(r.solarBirthDate || r.lunarBirthDisplay);
                const hasAddress = Boolean(r.householdAddress);
                const isDataComplete = hasBirthday && hasAddress; // 姓名恆為必填，不需另外檢查
                return (
                  <tr key={r.memberId} className="border-t border-cream-200">
                    <td className="px-3 py-2 text-ink">{r.name}</td>
                    <td className="px-3 py-2 text-ink-soft">{r.householdId}</td>
                    <td className="px-3 py-2 text-ink-soft">{r.householdName}</td>
                    <td className="px-3 py-2 text-ink-soft">
                      {r.solarBirthDate || r.lunarBirthDisplay || "—"}
                      {r.zodiac && <span className="ml-1 text-xs text-ink-faint">（{r.zodiac}）</span>}
                    </td>
                    <td className="px-3 py-2 text-ink-soft">{r.householdAddress || "—"}</td>
                    <td className="px-3 py-2 text-ink-soft">{r.mobile || r.householdPhone || "—"}</td>
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
                    <td className="px-3 py-2 text-xs">
                      {isDataComplete ? (
                        <span className="rounded-full bg-sage-100 px-2 py-0.5 text-ink-soft">資料完整</span>
                      ) : (
                        <span className="rounded-full bg-blossom-100 px-2 py-0.5 text-ink-soft">待補資料</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <Link
                        href={`/devotee-center/${r.memberId}${detailQueryString}`}
                        className="text-xs text-ink-faint underline-offset-4 hover:underline"
                      >
                        查看／編輯 →
                      </Link>
                    </td>
                  </tr>
                );
              })}
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
            {/* DevoteeListInner 用了 useSearchParams()，Next.js 要求外面要有
                Suspense 邊界，否則 npm run build 靜態分析階段會報錯。 */}
            <Suspense fallback={<p className="text-sm text-ink-faint">載入中…</p>}>
              <DevoteeListInner />
            </Suspense>
          </DevoteeCenterGate>
        </OperatorProvider>
      </main>
    </div>
  );
}
