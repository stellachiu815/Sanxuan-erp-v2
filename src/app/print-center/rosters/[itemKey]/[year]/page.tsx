"use client";

import { use as usePromise, useCallback, useEffect, useState } from "react";
import { OperatorProvider } from "@/lib/operatorClient";
import OperatorBar from "@/components/system/OperatorBar";
import { fetchRegistration, toFriendlyError } from "@/lib/registrationFetch";

/**
 * V14：列印管理－報名項目「總名單」檢視／列印／補印（指令一.6、五）。
 *
 * 網址：/print-center/rosters/[itemKey]/[year]
 * 只列已確認（CONFIRMED）的報名（草稿不列印，沿用 V13.4 指令七）。
 * 版面用 print:* 類別，瀏覽器列印即可；補印 = 再列印一次同一份。
 */

type RosterRow = {
  registrationItemId: string;
  householdName: string;
  memberName: string | null;
  itemName: string;
  quantity: number;
  amountDue: number;
  amountPaid: number;
  amountUnpaid: number;
  status: string;
};
type Roster = {
  itemName: string;
  activityGroupName: string;
  year: number;
  printDocumentKeys: string[];
  rows: RosterRow[];
  totalQuantity: number;
  totalAmountDue: number;
};

export default function RosterPrintPage({
  params,
}: {
  params: Promise<{ itemKey: string; year: string }>;
}) {
  const { itemKey, year } = usePromise(params);
  return (
    <OperatorProvider>
      <div className="min-h-screen">
        <div className="print:hidden">
          <OperatorBar />
        </div>
        <RosterInner itemKey={itemKey} year={year} />
      </div>
    </OperatorProvider>
  );
}

function RosterInner({ itemKey, year }: { itemKey: string; year: string }) {
  const [roster, setRoster] = useState<Roster | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetchRegistration(`/api/print-center/rosters/${itemKey}/${year}`);
      const data = await res.json();
      if (!res.ok) {
        setError(toFriendlyError(res.status, data?.error));
        return;
      }
      setRoster(data.roster);
    } catch {
      setError("讀取名單時發生連線問題。");
    }
  }, [itemKey, year]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <p className="p-6 text-sm text-blossom-500">{error}</p>;
  if (!roster) return <p className="p-6 text-sm text-ink-faint">讀取中…</p>;

  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <div className="mb-4 flex items-center justify-between print:hidden">
        <h1 className="text-lg text-ink">
          {roster.activityGroupName}・{roster.itemName} 報名總名單（民國 {roster.year} 年）
        </h1>
        <button
          type="button"
          onClick={async () => {
            // 先記錄已列印（補印只增加次數、不改收款），再叫瀏覽器列印。
            try {
              await fetchRegistration(
                `/api/print-center/rosters/${itemKey}/${year}/mark-printed`,
                { method: "POST", body: "{}" }
              );
            } catch {
              /* 記錄失敗不阻擋列印 */
            }
            window.print();
          }}
          className="min-h-11 rounded-full bg-yolk-200 px-5 py-2 text-sm font-medium text-ink hover:bg-yolk-300"
        >
          列印／補印
        </button>
      </div>

      <h1 className="mb-2 hidden text-center text-lg print:block">
        {roster.activityGroupName}・{roster.itemName} 報名總名單（民國 {roster.year} 年）
      </h1>

      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-ink/20 text-xs text-ink-faint">
            <th className="px-2 py-1.5">#</th>
            <th className="px-2 py-1.5">家戶</th>
            <th className="px-2 py-1.5">姓名</th>
            <th className="px-2 py-1.5">項目</th>
            <th className="px-2 py-1.5">數量</th>
            <th className="px-2 py-1.5">應收</th>
            <th className="px-2 py-1.5">未收</th>
          </tr>
        </thead>
        <tbody>
          {roster.rows.map((r, i) => (
            <tr key={r.registrationItemId} className="border-b border-ink/10">
              <td className="px-2 py-1.5 text-ink-faint">{i + 1}</td>
              <td className="px-2 py-1.5 text-ink">{r.householdName}</td>
              <td className="px-2 py-1.5 text-ink-soft">{r.memberName ?? "—"}</td>
              <td className="px-2 py-1.5 text-ink-soft">{r.itemName}</td>
              <td className="px-2 py-1.5 text-ink-soft">{r.quantity}</td>
              <td className="px-2 py-1.5 text-ink-soft">{r.amountDue}</td>
              <td className="px-2 py-1.5 text-ink-soft">{r.amountUnpaid}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-ink/20 text-sm text-ink">
            <td className="px-2 py-1.5" colSpan={4}>合計</td>
            <td className="px-2 py-1.5">{roster.totalQuantity}</td>
            <td className="px-2 py-1.5">{roster.totalAmountDue}</td>
            <td className="px-2 py-1.5" />
          </tr>
        </tfoot>
      </table>

      {roster.rows.length === 0 && (
        <p className="mt-4 text-sm text-ink-faint">目前沒有已確認的報名。</p>
      )}
    </main>
  );
}
