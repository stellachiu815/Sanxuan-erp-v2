"use client";

import { useEffect, useState } from "react";
import { receivableSourceTypeLabel, paymentMethodTypeLabel } from "@/lib/labels";

type ReportData = {
  year: number;
  month: number;
  transactionCount: number;
  totalAmount: number;
  bySourceType: { sourceType: string; count: number; amount: number }[];
  byMethodType: { methodType: string; count: number; amount: number }[];
  cashAmount: number;
  bankTransferAmount: number;
  chequeAmount: number;
  directCollectedTotal: number;
  agentCollectedTotal: number;
  agentUncollectedRemittedTotal: number;
  agentRemittedTotal: number;
  voidedCount: number;
  voidedAmount: number;
  refundAmount: number;
  transferAmount: number;
  crossYearReceivedAmount: number;
  transactions: { transactionNo: string; paidOn: string; totalAmount: string; payerNameSnapshot: string }[];
};

/**
 * V11.0 需求「月結收款報表」：所有數字直接來自真實收款資料彙總，不做人工
 * 輸入。畫面提供預覽/列印（瀏覽器列印）與 CSV 匯出（可直接用 Excel 開啟）；
 * 正式 PDF 樣版留待之後有需要時再開發，見交付報告「暫緩事項」。
 */
export default function MonthlyReportScreen({ defaultYear, defaultMonth }: { defaultYear: number; defaultMonth: number }) {
  const [year, setYear] = useState(defaultYear);
  const [month, setMonth] = useState(defaultMonth);
  const [report, setReport] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    const res = await fetch(`/api/collection-center/monthly-report?year=${year}&month=${month}`);
    const data = await res.json();
    setReport(data);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function downloadCsv() {
    if (!report) return;
    const lines = [
      `月結收款報表,${report.year}年${report.month}月`,
      `收款筆數,${report.transactionCount}`,
      `收款總額,${report.totalAmount}`,
      `宮內直接收款,${report.directCollectedTotal}`,
      `代收合計,${report.agentCollectedTotal}`,
      `代收尚未繳回,${report.agentUncollectedRemittedTotal}`,
      `代收已繳回,${report.agentRemittedTotal}`,
      `退款合計,${report.refundAmount}`,
      `轉款合計,${report.transferAmount}`,
      `跨年度收款金額,${report.crossYearReceivedAmount}`,
      `作廢筆數,${report.voidedCount}`,
      `作廢金額,${report.voidedAmount}`,
      `現金,${report.cashAmount}`,
      `銀行轉帳,${report.bankTransferAmount}`,
      `支票,${report.chequeAmount}`,
      "",
      "來源別,筆數,金額",
      ...report.bySourceType.map((s) => `${receivableSourceTypeLabel[s.sourceType] ?? s.sourceType},${s.count},${s.amount}`),
      "",
      "收款方式,筆數,金額",
      ...report.byMethodType.map((m) => `${paymentMethodTypeLabel[m.methodType] ?? m.methodType},${m.count},${m.amount}`),
      "",
      "收款序號,收款日,付款人,金額",
      ...report.transactions.map((t) => `${t.transactionNo},${t.paidOn},${t.payerNameSnapshot},${t.totalAmount}`),
    ];
    const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `收款月結報表_${report.year}年${report.month}月.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col gap-6 print:gap-2">
      <div className="flex flex-wrap items-end gap-3 print:hidden">
        <div>
          <label className="block text-xs text-ink-faint">年度（民國年）</label>
          <input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} className="w-24 rounded-lg border border-cream-200 px-2 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs text-ink-faint">月份</label>
          <input type="number" min={1} max={12} value={month} onChange={(e) => setMonth(Number(e.target.value))} className="w-20 rounded-lg border border-cream-200 px-2 py-2 text-sm" />
        </div>
        <button onClick={load} className="rounded-full bg-mist-100 px-4 py-2 text-sm text-ink-soft hover:bg-mist-200">查詢</button>
        {report && (
          <>
            <button onClick={() => window.print()} className="rounded-full bg-cream-200 px-4 py-2 text-sm text-ink-soft hover:bg-cream-300">🖨 列印預覽</button>
            <button onClick={downloadCsv} className="rounded-full bg-sage-100 px-4 py-2 text-sm text-ink-soft hover:bg-sage-200">⬇ 下載 CSV（可用 Excel 開啟）</button>
          </>
        )}
      </div>

      {loading && <p className="text-sm text-ink-faint">載入中…</p>}

      {report && (
        <>
          <section className="rounded-3xl bg-white/70 p-6 shadow-card">
            <h2 className="text-base text-ink">{report.year} 年 {report.month} 月 收款彙總</h2>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="收款筆數" value={`${report.transactionCount} 筆`} />
              <Stat label="收款總額" value={`${report.totalAmount.toLocaleString("zh-Hant")} 元`} />
              <Stat label="宮內直接收款" value={`${report.directCollectedTotal.toLocaleString("zh-Hant")} 元`} />
              <Stat label="代收合計" value={`${report.agentCollectedTotal.toLocaleString("zh-Hant")} 元`} />
              <Stat label="代收尚未繳回" value={`${report.agentUncollectedRemittedTotal.toLocaleString("zh-Hant")} 元`} />
              <Stat label="代收已繳回" value={`${report.agentRemittedTotal.toLocaleString("zh-Hant")} 元`} />
              <Stat label="跨年度收款" value={`${report.crossYearReceivedAmount.toLocaleString("zh-Hant")} 元`} />
              <Stat label="退款合計" value={`${report.refundAmount.toLocaleString("zh-Hant")} 元`} />
              <Stat label="轉款合計" value={`${report.transferAmount.toLocaleString("zh-Hant")} 元`} />
              <Stat label="作廢筆數" value={`${report.voidedCount} 筆`} />
              <Stat label="作廢金額" value={`${report.voidedAmount.toLocaleString("zh-Hant")} 元`} />
              <Stat label="現金" value={`${report.cashAmount.toLocaleString("zh-Hant")} 元`} />
              <Stat label="銀行轉帳" value={`${report.bankTransferAmount.toLocaleString("zh-Hant")} 元`} />
              <Stat label="支票" value={`${report.chequeAmount.toLocaleString("zh-Hant")} 元`} />
            </div>
          </section>

          <section className="rounded-3xl bg-white/70 p-6 shadow-card">
            <h2 className="text-sm text-ink-soft">依來源別</h2>
            <table className="mt-3 w-full text-left text-sm">
              <thead><tr className="text-xs text-ink-faint"><th className="py-1">來源</th><th className="py-1">筆數</th><th className="py-1">金額</th></tr></thead>
              <tbody>
                {report.bySourceType.map((s) => (
                  <tr key={s.sourceType}><td className="py-1">{receivableSourceTypeLabel[s.sourceType] ?? s.sourceType}</td><td className="py-1">{s.count}</td><td className="py-1">{s.amount.toLocaleString("zh-Hant")}</td></tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="rounded-3xl bg-white/70 p-6 shadow-card">
            <h2 className="text-sm text-ink-soft">依收款方式</h2>
            <table className="mt-3 w-full text-left text-sm">
              <thead><tr className="text-xs text-ink-faint"><th className="py-1">方式</th><th className="py-1">筆數</th><th className="py-1">金額</th></tr></thead>
              <tbody>
                {report.byMethodType.map((m) => (
                  <tr key={m.methodType}><td className="py-1">{paymentMethodTypeLabel[m.methodType] ?? m.methodType}</td><td className="py-1">{m.count}</td><td className="py-1">{m.amount.toLocaleString("zh-Hant")}</td></tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-cream-50 p-3">
      <p className="text-xs text-ink-faint">{label}</p>
      <p className="mt-1 text-sm text-ink">{value}</p>
    </div>
  );
}
