"use client";

import { use as usePromise, useCallback, useEffect, useState } from "react";
import { OperatorProvider } from "@/lib/operatorClient";
import OperatorBar from "@/components/system/OperatorBar";
import { fetchRegistration, toFriendlyError } from "@/lib/registrationFetch";
import RosterPrintButton from "@/components/print/RosterPrintButton";

/**
 * V14：列印管理－報名項目「總名單」檢視／列印／補印（指令一.6、五）。
 *
 * 網址：/print-center/rosters/[itemKey]/[year]
 * 只列已確認（CONFIRMED）的報名（草稿不列印，沿用 V13.4 指令七）。
 * 版面用 print:* 類別，瀏覽器列印即可；補印 = 再列印一次同一份。
 */

type RosterRow = {
  registrationItemId: string;
  /** V30.3 普渡報名順序（各項目各自 1 起；未補號 null → 顯示「—」）。名單「順序」欄用此值，不用流水 index。 */
  registrationOrder: number | null;
  householdName: string;
  memberName: string | null;
  itemName: string;
  quantity: number;
  /** V36.7B：金額讀既有 RRI；無對應 RRI 時為 null → 顯示「—」（不以 0 冒充）。 */
  amountDue: number | null;
  amountPaid: number | null;
  amountUnpaid: number | null;
  status: string;
  printedAt: string | null;
  lastPrintedAt: string | null;
  printCount: number;
  printedByName: string | null;
};

function rocTime(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("zh-Hant");
  } catch {
    return "—";
  }
}
type Roster = {
  itemName: string;
  activityGroupName: string;
  year: number;
  printDocumentKeys: string[];
  rows: RosterRow[];
  totalQuantity: number;
  totalAmountDue: number;
};
type PreflightIssue = { registrationItemId: string; label: string; reasons: string[] };

/** V21 列印預檢提示：有缺漏時列出原因，並在下方擋下列印。 */
function PreflightNotice({ issues }: { issues: PreflightIssue[] }) {
  if (issues.length === 0) return null;
  return (
    <div className="mb-4 rounded-2xl bg-blossom-100 p-4 text-sm text-ink print:hidden">
      <p className="font-medium text-blossom-500">⚠️ 列印預檢未通過（{issues.length} 筆資料不完整，請補齊後再列印）</p>
      <ul className="mt-2 flex flex-col gap-1 text-xs text-ink-soft">
        {issues.slice(0, 20).map((it) => (
          <li key={it.registrationItemId}>・{it.label}：{it.reasons.join("、")}</li>
        ))}
        {issues.length > 20 && <li>…等共 {issues.length} 筆</li>}
      </ul>
    </div>
  );
}

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
  const [preflight, setPreflight] = useState<PreflightIssue[]>([]);
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
      setPreflight(Array.isArray(data.preflight) ? data.preflight : []);
    } catch {
      setError("讀取名單時發生連線問題。");
    }
  }, [itemKey, year]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <p className="p-6 text-sm text-blossom-500">{error}</p>;
  if (!roster) return <p className="p-6 text-sm text-ink-faint">讀取中…</p>;

  // V16：白米列印只需「姓名＋斤數」（沿用 US_RICE_ROSTER + 同一列印中心，不建第二套列印）。
  // V21：列印預檢未通過（有缺漏欄位）時，不得直接列印。
  const blocked = preflight.length > 0;
  const isRice = itemKey === "US_RICE";
  if (isRice) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-8">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
          <h1 className="text-lg text-ink">白米認購名單（民國 {roster.year} 年）</h1>
          <div className="flex items-center gap-2">
            {blocked && <span className="text-sm text-blossom-500">預檢未通過</span>}
            <RosterPrintButton itemKey={itemKey} year={year} disabled={blocked} count={roster.rows.length} onPrinted={load} />
          </div>
        </div>
        {roster.printDocumentKeys.length > 0 && (
          <p className="mb-3 text-xs text-ink-faint print:hidden">使用模板：{roster.printDocumentKeys.join("、")}</p>
        )}
        <PreflightNotice issues={preflight} />
        <h1 className="mb-2 hidden text-center text-lg print:block">白米認購名單（民國 {roster.year} 年）</h1>
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-ink/20 text-xs text-ink-faint">
              <th className="px-2 py-1.5">順序</th>
              <th className="px-2 py-1.5">姓名</th>
              <th className="px-2 py-1.5">斤數</th>
            </tr>
          </thead>
          <tbody>
            {roster.rows.map((r) => (
              <tr key={r.registrationItemId} className="border-b border-ink/10">
                <td className="px-2 py-1.5 tabular-nums text-ink-faint">{r.registrationOrder ?? "—"}</td>
                <td className="px-2 py-1.5 text-ink">{r.memberName ?? r.householdName}</td>
                <td className="px-2 py-1.5 text-ink-soft">{r.quantity} 斤</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-ink/20 text-sm text-ink">
              <td className="px-2 py-1.5" colSpan={2}>合計</td>
              <td className="px-2 py-1.5">{roster.totalQuantity} 斤</td>
            </tr>
          </tfoot>
        </table>
        {roster.rows.length === 0 && <p className="mt-4 text-sm text-ink-faint">目前沒有已確認的白米認購。</p>}
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <h1 className="text-lg text-ink">
          {roster.activityGroupName}・{roster.itemName} 報名總名單（民國 {roster.year} 年）
        </h1>
        <div className="flex items-center gap-2">
          {blocked && <span className="text-sm text-blossom-500">預檢未通過</span>}
          <RosterPrintButton itemKey={itemKey} year={year} disabled={blocked} count={roster.rows.length} onPrinted={load} />
        </div>
      </div>

      {roster.printDocumentKeys.length > 0 && (
        <p className="mb-3 text-xs text-ink-faint print:hidden">使用模板：{roster.printDocumentKeys.join("、")}</p>
      )}

      <PreflightNotice issues={preflight} />

      <h1 className="mb-2 hidden text-center text-lg print:block">
        {roster.activityGroupName}・{roster.itemName} 報名總名單（民國 {roster.year} 年）
      </h1>

      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-ink/20 text-xs text-ink-faint">
            <th className="px-2 py-1.5">順序</th>
            <th className="px-2 py-1.5">家戶</th>
            <th className="px-2 py-1.5">姓名</th>
            <th className="px-2 py-1.5">項目</th>
            <th className="px-2 py-1.5">數量</th>
            <th className="px-2 py-1.5">應收</th>
            <th className="px-2 py-1.5">未收</th>
            {/* V21 列印紀錄：首次／最後列印時間、次數、列印人員（列印時隱藏，只在管理畫面看）。 */}
            <th className="px-2 py-1.5 print:hidden">列印紀錄</th>
          </tr>
        </thead>
        <tbody>
          {roster.rows.map((r) => (
            <tr key={r.registrationItemId} className="border-b border-ink/10">
              <td className="px-2 py-1.5 tabular-nums text-ink-faint">{r.registrationOrder ?? "—"}</td>
              <td className="px-2 py-1.5 text-ink">{r.householdName}</td>
              <td className="px-2 py-1.5 text-ink-soft">{r.memberName ?? "—"}</td>
              <td className="px-2 py-1.5 text-ink-soft">{r.itemName}</td>
              <td className="px-2 py-1.5 text-ink-soft">{r.quantity}</td>
              <td className="px-2 py-1.5 text-ink-soft">{r.amountDue == null ? "—" : r.amountDue}</td>
              <td className="px-2 py-1.5 text-ink-soft">{r.amountUnpaid == null ? "—" : r.amountUnpaid}</td>
              <td className="px-2 py-1.5 text-xs text-ink-faint print:hidden">
                {r.printCount > 0
                  ? `已列印 ${r.printCount} 次｜首印 ${rocTime(r.printedAt)}｜最後 ${rocTime(r.lastPrintedAt ?? r.printedAt)}${r.printedByName ? `｜${r.printedByName}` : ""}`
                  : "未列印"}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-ink/20 text-sm text-ink">
            <td className="px-2 py-1.5" colSpan={4}>合計</td>
            <td className="px-2 py-1.5">{roster.totalQuantity}</td>
            <td className="px-2 py-1.5">{roster.totalAmountDue}</td>
            <td className="px-2 py-1.5" />
            <td className="px-2 py-1.5 print:hidden" />
          </tr>
        </tfoot>
      </table>

      {roster.rows.length === 0 && (
        <p className="mt-4 text-sm text-ink-faint">目前沒有已確認的報名。</p>
      )}
    </main>
  );
}
