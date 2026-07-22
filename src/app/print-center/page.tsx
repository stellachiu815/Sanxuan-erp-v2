"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { OperatorProvider } from "@/lib/operatorClient";
import OperatorBar from "@/components/system/OperatorBar";
import { fetchRegistration, toFriendlyError } from "@/lib/registrationFetch";

/**
 * V14：列印管理首頁「活動報名項目」區塊（指令五）。
 *
 * 依年度、主活動、報名項目分組，每個項目顯示已確認人數／未列印／已列印，
 * 並提供「進入總名單」與「列印／補印」入口。所有需要列印的活動都能從這裡進入，
 * 不只靠直達網址。
 */

type SummaryRow = {
  itemKey: string;
  itemName: string;
  activityGroup: string;
  activityGroupName: string;
  year: number;
  confirmedCount: number;
  printedCount: number;
  unprintedCount: number;
  printDocumentKeys: string[];
};

export default function PrintCenterPage() {
  return (
    <OperatorProvider>
      <div className="min-h-screen">
        <OperatorBar />
        <PrintCenterInner />
      </div>
    </OperatorProvider>
  );
}

function PrintCenterInner() {
  const currentYear = new Date().getFullYear() - 1911;
  const [year, setYear] = useState<number>(currentYear);
  const [rows, setRows] = useState<SummaryRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setRows(null);
    try {
      const res = await fetchRegistration(`/api/print-center/activity-items?year=${year}`);
      const data = await res.json();
      if (!res.ok) {
        setError(toFriendlyError(res.status, data?.error));
        return;
      }
      setRows(data.summary);
      setError(null);
    } catch {
      setError("讀取列印彙總時發生連線問題。");
    }
  }, [year]);

  useEffect(() => {
    void load();
  }, [load]);

  const groups = new Map<string, SummaryRow[]>();
  for (const r of rows ?? []) {
    (groups.get(r.activityGroupName) ?? groups.set(r.activityGroupName, []).get(r.activityGroupName)!).push(r);
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg text-ink">列印管理・活動報名項目</h1>
        <label className="flex items-center gap-2 text-sm text-ink-soft">
          年度
          <input
            type="number"
            value={year}
            onChange={(e) => setYear(Number(e.target.value) || currentYear)}
            className="w-24 rounded-xl border border-cream-300 px-3 py-1.5 text-sm"
          />
        </label>
      </div>

      {error && <p className="text-sm text-blossom-500">{error}</p>}
      {rows === null ? (
        <p className="text-sm text-ink-faint">讀取中…</p>
      ) : (
        Array.from(groups.entries()).map(([groupName, items]) => (
          <section key={groupName} className="mb-6 rounded-3xl bg-white/70 p-5 shadow-card">
            <h2 className="mb-3 text-sm text-ink">{groupName}</h2>
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-xs text-ink-faint">
                  <th className="px-2 py-1.5">項目</th>
                  <th className="px-2 py-1.5">已確認</th>
                  <th className="px-2 py-1.5">未列印</th>
                  <th className="px-2 py-1.5">已列印</th>
                  <th className="px-2 py-1.5">總名單</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.itemKey} className="border-t border-cream-200">
                    <td className="px-2 py-1.5 text-ink">{it.itemName}</td>
                    <td className="px-2 py-1.5 text-ink-soft">{it.confirmedCount}</td>
                    <td className="px-2 py-1.5 text-ink-soft">{it.unprintedCount}</td>
                    <td className="px-2 py-1.5 text-ink-soft">{it.printedCount}</td>
                    <td className="px-2 py-1.5">
                      <Link
                        href={`/print-center/rosters/${it.itemKey}/${it.year}`}
                        className="rounded-full bg-sage-100 px-3 py-1 text-xs text-ink hover:bg-sage-200"
                      >
                        進入總名單／列印／補印
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))
      )}
    </main>
  );
}
