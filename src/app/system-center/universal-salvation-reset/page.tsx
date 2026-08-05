"use client";

import { useState } from "react";
import { OperatorProvider } from "@/lib/operatorClient";
import OperatorBar from "@/components/system/OperatorBar";
import { fetchRegistration, toFriendlyError } from "@/lib/registrationFetch";

/**
 * V36.13 中元普渡「範圍化重置」管理頁（瀏覽器操作，不需終端機）。
 * 先「預覽」看各表預計刪除筆數（Dry-Run，不寫入）；確認後輸入確認字串才「正式清空」（硬刪、財務保護）。
 */

type Report = {
  year: number;
  templeEventId: string | null;
  targets: number;
  buckets: { draft: number; unpaid: number; collected: number; confirmed: number };
  deletable: number;
  counts: Record<string, number>;
  skippedHouseholds: { recordId: string; householdId: string; reason: string }[];
  outOfScope: number;
};

export default function UniversalSalvationResetPage() {
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
  const [year, setYear] = useState(currentYear);
  const [report, setReport] = useState<Report | null>(null);
  const [committed, setCommitted] = useState(false);
  const [confirmChecked, setConfirmChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function run(commit: boolean) {
    setBusy(true); setError(null); setMsg(null);
    try {
      const res = await fetchRegistration(`/api/admin/universal-salvation/reset`, {
        method: "POST",
        body: JSON.stringify({ year, commit, confirm: confirmChecked }),
      });
      const data = await res.json();
      if (!res.ok) { setError(toFriendlyError(res.status, data?.error)); return; }
      setReport(data.report);
      if (commit) { setCommitted(true); setMsg(`已完成清空 ${year} 普渡報名（實際刪除見下表）。現在可以重新匯入 Excel。`); }
      else { setCommitted(false); setMsg("以下為「預計刪除」數字（尚未寫入）。確認無誤後，在下方輸入確認字串再按『正式清空』。"); }
    } catch { setError("連線問題，請稍後再試。"); } finally { setBusy(false); }
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="text-lg text-ink">中元普渡・範圍化重置（重匯前清空）</h1>
      <p className="mt-2 text-sm text-ink-soft">
        只清「該年度普渡報名」，<b>不動</b>家戶／信眾／永久牌位／收款。<b>已收款</b>的報名一律自動跳過、保留。
        清空後重新匯入 Excel 即可乾淨重建。
      </p>

      <div className="mt-4 flex flex-wrap items-end gap-3 rounded-2xl bg-white/70 p-4 shadow-card">
        <label className="text-xs text-ink-soft">年度
          <input type="number" value={year} onChange={(e) => { setYear(Number(e.target.value) || currentYear); setReport(null); setCommitted(false); }}
            className="mt-1 block w-24 rounded-lg border border-cream-200 px-2 py-1.5 text-sm" />
        </label>
        <button type="button" onClick={() => run(false)} disabled={busy}
          className="rounded-full bg-mist-200 px-4 py-1.5 text-sm text-ink disabled:opacity-40">
          {busy ? "計算中…" : "1) 預覽（不寫入）"}
        </button>
      </div>

      {error && <p className="mt-3 text-sm text-blossom-500">⚠️ {error}</p>}
      {msg && <p className="mt-3 rounded-2xl bg-sage-100 px-4 py-2 text-sm text-ink">{msg}</p>}

      {report && (
        <div className="mt-4 rounded-2xl bg-white/70 p-4 text-sm shadow-card">
          <p className="text-ink">普渡活動：{report.templeEventId ?? "（找不到，已中止）"}｜報名總數 {report.targets} 筆</p>
          <p className="mt-1 text-ink-soft">
            草稿 {report.buckets.draft}｜未收款 {report.buckets.unpaid}｜
            <span className="text-blossom-500">已收款（保留）{report.buckets.collected}</span>｜
            <span className="text-blossom-500">已確認收款（保留）{report.buckets.confirmed}</span>
          </p>
          <p className="mt-1 font-medium text-ink">{committed ? "實際刪除" : "預計刪除"}：{report.deletable} 筆報名</p>
          <ul className="mt-2 grid grid-cols-2 gap-x-6 gap-y-0.5 text-xs text-ink-soft">
            {Object.entries(report.counts).map(([t, n]) => <li key={t}>{t}：{n}</li>)}
          </ul>
          {report.skippedHouseholds.length > 0 && (
            <div className="mt-2 text-xs text-ink-faint">
              保留（有收款）：{report.skippedHouseholds.map((s) => `${s.householdId}(${s.reason})`).join("、")}
            </div>
          )}
        </div>
      )}

      {report && !committed && report.deletable > 0 && (
        <div className="mt-4 rounded-2xl bg-blossom-50 p-4 text-sm shadow-card">
          <p className="text-blossom-500">確認要清空？此動作為硬刪除、無法還原（已收款者已自動保留）。</p>
          <label className="mt-3 flex items-center gap-2 text-ink">
            <input type="checkbox" checked={confirmChecked} onChange={(e) => setConfirmChecked(e.target.checked)} className="h-5 w-5" />
            我確認清空 {year} 普渡報名（共 {report.deletable} 筆），了解無法還原。
          </label>
          <div className="mt-3">
            <button type="button" onClick={() => run(true)} disabled={busy || !confirmChecked}
              className="rounded-full bg-blossom-400 px-5 py-2 text-sm font-medium text-white disabled:opacity-40">
              {busy ? "清空中…" : "2) 正式清空"}
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
