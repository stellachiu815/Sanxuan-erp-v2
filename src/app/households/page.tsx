"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import SearchBar from "@/components/SearchBar";
import { OperatorProvider, useOperator } from "@/lib/operatorClient";
import OperatorBar from "@/components/system/OperatorBar";
import { canDevotee } from "@/lib/permissions";
import CreateHouseholdModal from "@/components/household/CreateHouseholdModal";

type HouseholdRow = {
  id: string;
  name: string;
  headMemberId: string | null;
  headName: string | null;
  contactName: string | null;
  phone: string | null;
  mobile: string | null;
  address: string | null;
  memberCount: number;
  ancestorCount: number;
  individualCount: number;
  updatedAt: string;
};

type ListResponse = { items: HouseholdRow[]; total: number; page: number; pageSize: number };

/**
 * V12.1「家戶管理中心」指令「六、家戶列表」「七、家戶搜尋」入口頁。
 *
 * 沿用既有 GET /api/households（src/lib/householdManagement.ts
 * searchHouseholds()），不另外做一套搜尋邏輯。合併／拆分／轉移成員／
 * 封存這幾個會實際修改資料的操作，統一留在各家戶自己的詳細頁
 * （QuickActionsPanel）進行，這裡的「操作」欄只提供「查看家戶」連結，
 * 避免同一套邏輯在列表頁與詳細頁各維護一份。
 */
function HouseholdListInner() {
  const { operatorUser } = useOperator();
  const canCreate = operatorUser?.role ? canDevotee(operatorUser.role, "updateProfile") : false;

  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [data, setData] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 350);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    setPage(1);
  }, [debouncedQ, pageSize, includeArchived]);

  useEffect(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (debouncedQ) params.set("query", debouncedQ);
    if (includeArchived) params.set("includeArchived", "true");

    setLoading(true);
    fetch(`/api/households?${params.toString()}`)
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok || !body.success) throw new Error(body.error ?? "載入失敗");
        return body.data as ListResponse;
      })
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [debouncedQ, page, pageSize, includeArchived]);

  const totalPages = useMemo(() => (data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1), [data]);

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-3xl bg-white/70 p-5 shadow-card">
        <div className="flex flex-wrap items-center gap-3">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜尋家戶編號/戶名/主要聯絡人/地址/電話/成員姓名/歷代祖先或乙位正魂姓名"
            className="min-w-0 flex-1 rounded-full border border-cream-200 bg-cream-50 px-4 py-2 text-sm text-ink"
          />
          {canCreate && (
            <button
              type="button"
              onClick={() => setShowCreate(true)}
              className="whitespace-nowrap rounded-full bg-ink-soft px-5 py-2 text-sm text-cream-50 transition hover:bg-ink"
            >
              ➕ 新增家戶
            </button>
          )}
        </div>
        <label className="mt-3 flex items-center gap-2 text-xs text-ink-soft">
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(e) => setIncludeArchived(e.target.checked)}
          />
          同時顯示已封存的家戶
        </label>
      </div>

      {error && <div className="rounded-3xl bg-blossom-100 p-4 text-sm text-ink">{error}</div>}

      {loading && !data && <p className="px-2 text-sm text-ink-faint">載入中…</p>}

      {data && data.items.length === 0 && !loading && (
        <div className="rounded-3xl bg-white/70 p-8 text-center text-sm text-ink-faint shadow-card">
          {debouncedQ ? "沒有符合搜尋條件的家戶" : "目前沒有家戶資料"}
        </div>
      )}

      {data && data.items.length > 0 && (
        <div className="overflow-x-auto rounded-3xl bg-white/70 p-4 shadow-card">
          <table className="w-full min-w-[980px] text-left text-sm">
            <thead>
              <tr className="text-xs text-ink-faint">
                <th className="px-3 py-2">家戶編號</th>
                <th className="px-3 py-2">戶名</th>
                <th className="px-3 py-2">戶長</th>
                <th className="px-3 py-2">主要聯絡人</th>
                <th className="px-3 py-2">聯絡電話</th>
                <th className="px-3 py-2">地址</th>
                <th className="px-3 py-2">成員數</th>
                <th className="px-3 py-2">歷代祖先</th>
                <th className="px-3 py-2">乙位正魂</th>
                <th className="px-3 py-2">最後更新</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((h) => (
                <tr key={h.id} className="border-t border-cream-200">
                  <td className="px-3 py-2 text-ink">{h.id}</td>
                  <td className="px-3 py-2 text-ink-soft">{h.name || "（未命名）"}</td>
                  <td className="px-3 py-2 text-ink-soft">{h.headName || "（未指定）"}</td>
                  <td className="px-3 py-2 text-ink-soft">{h.contactName || "—"}</td>
                  <td className="px-3 py-2 text-ink-soft">{h.mobile || h.phone || "—"}</td>
                  <td className="px-3 py-2 text-ink-soft">{h.address || "—"}</td>
                  <td className="px-3 py-2 text-ink-soft">{h.memberCount}</td>
                  <td className="px-3 py-2 text-ink-soft">{h.ancestorCount}</td>
                  <td className="px-3 py-2 text-ink-soft">{h.individualCount}</td>
                  <td className="px-3 py-2 text-xs text-ink-faint">
                    {new Date(h.updatedAt).toLocaleDateString("zh-TW")}
                  </td>
                  <td className="px-3 py-2">
                    <Link
                      href={`/household/${h.id}`}
                      className="text-xs text-ink-faint underline-offset-4 hover:underline"
                    >
                      查看家戶 →
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
                className="min-h-9 rounded-full bg-cream-100 px-3 py-1 disabled:opacity-40"
              >
                上一頁
              </button>
              <span className="text-ink-soft">
                第 {data.page} / {totalPages} 頁
              </span>
              <button
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="min-h-9 rounded-full bg-cream-100 px-3 py-1 disabled:opacity-40"
              >
                下一頁
              </button>
              <select
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value))}
                className="min-h-9 rounded-full border border-cream-200 bg-cream-50 px-2 py-1"
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

      {showCreate && <CreateHouseholdModal onClose={() => setShowCreate(false)} />}
    </div>
  );
}

export default function HouseholdsPage() {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-cream-200 bg-cream-50/90 px-6 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-4">
          <span className="whitespace-nowrap text-sm text-ink-soft">三玄宮行政系統</span>
          <SearchBar variant="compact" />
        </div>
      </header>

      <main className="mx-auto flex max-w-6xl flex-col gap-8 px-6 py-10">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-lg font-medium text-ink">🏠 家戶管理中心</h1>
        </div>

        <OperatorProvider>
          <OperatorBar />
          <HouseholdListInner />
        </OperatorProvider>
      </main>
    </div>
  );
}
