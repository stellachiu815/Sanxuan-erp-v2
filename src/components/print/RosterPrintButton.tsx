"use client";

import { useState } from "react";
import { fetchRegistration } from "@/lib/registrationFetch";

/**
 * V21.1 正式列印流程：列印／補印一律「先預覽 → 確認 → 開始列印 → 完成後才更新列印紀錄」。
 *
 * 名冊頁面本身即為正式版型的列印預覽（下方名單就是實際會列印的內容），因此：
 *  - 按「🖨 列印／補印」→ 只展開確認列（不記錄）。
 *  - 按「開始列印」→ 先 window.print()（正式列印），列印流程結束後才 POST mark-printed
 *    （更新 printCount／lastPrintedAt／printedBy）。
 *  - 按「取消」或只是瀏覽／關閉 → 完全不更新任何列印紀錄。
 *
 * 補印與批次「全部列印」都走同一條流程（不得一按即增加次數）。
 * 只做導覽與列印時機控制，不改任何付款／收據／交易／帳本／金額欄位。
 */
export default function RosterPrintButton({
  itemKey,
  year,
  disabled = false,
  count,
  onPrinted,
}: {
  itemKey: string;
  year: string | number;
  disabled?: boolean;
  /** 這次會列印的筆數（供確認提示）。 */
  count?: number;
  /** 完成列印並更新紀錄後的回呼（供重新載入計數）。 */
  onPrinted?: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function startPrint() {
    setBusy(true);
    try {
      // 1) 正式列印（瀏覽器列印對話框）。
      window.print();
      // 2) 列印流程結束後，才更新列印紀錄（補印只加次數、不改收款金額）。
      await fetchRegistration(`/api/print-center/rosters/${itemKey}/${year}/mark-printed`, { method: "POST", body: "{}" });
      setDone(true);
      onPrinted?.();
    } catch {
      /* 記錄失敗不影響已完成的實體列印；使用者可再操作一次。 */
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  if (done) {
    return (
      <span className="text-xs text-sage-500 print:hidden">
        ✓ 已完成列印並更新列印紀錄
        <button type="button" onClick={() => setDone(false)} className="ml-2 underline-offset-4 hover:underline">
          再列印／補印
        </button>
      </span>
    );
  }

  if (!confirming) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => setConfirming(true)}
        className="min-h-11 rounded-full bg-yolk-200 px-5 py-2 text-sm font-medium text-ink transition hover:bg-yolk-300 disabled:cursor-not-allowed disabled:opacity-40 print:hidden"
      >
        🖨 列印／補印
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 print:hidden">
      <span className="text-xs text-ink-soft">
        下方即為正式列印內容{typeof count === "number" ? `（共 ${count} 筆）` : ""}，確認無誤後開始列印；列印完成後才會更新列印次數。
      </span>
      <button
        type="button"
        onClick={startPrint}
        disabled={busy}
        className="min-h-9 rounded-full bg-sage-200 px-4 py-1.5 text-sm font-medium text-ink transition hover:bg-sage-300 disabled:opacity-40"
      >
        {busy ? "列印中…" : "開始列印"}
      </button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        className="min-h-9 rounded-full bg-cream-200 px-4 py-1.5 text-sm text-ink-soft transition hover:bg-cream-300"
      >
        取消
      </button>
    </div>
  );
}
