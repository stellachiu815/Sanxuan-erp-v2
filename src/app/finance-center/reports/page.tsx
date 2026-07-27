"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { OperatorProvider } from "@/lib/operatorClient";
import OperatorBar from "@/components/system/OperatorBar";
import BackButton from "@/components/navigation/BackButton";
import { fetchRegistration, toFriendlyError } from "@/lib/registrationFetch";

/** V22 財務報表：月／年／自訂＋PDF（列印）/Excel（查帳）匯出，共用同一查詢來源。 */

type Movement = { inflow: number; outflow: number; net: number };
type Balances = { bank: number; cash: number; total: number };
type Report = {
  range: { from: string; to: string; label: string };
  opening: Balances;
  closing: Balances;
  income: number;
  expense: number;
  net: number;
  bankMovement: Movement;
  cashMovement: Movement;
  activityBreakdown: { activityId: string; activityLabel: string; income: number; expense: number; net: number }[];
};

const money = (n: number) => n.toLocaleString("zh-Hant");
function rocNow() { return new Date().getFullYear() - 1911; }

export default function ReportsPage() {
  return (
    <OperatorProvider>
      <div className="min-h-screen">
        <OperatorBar />
        <ReportsInner />
      </div>
    </OperatorProvider>
  );
}

function ReportsInner() {
  const [mode, setMode] = useState<"month" | "year" | "custom">("month");
  const [rocYear, setRocYear] = useState(rocNow());
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);

  const query = useMemo(() => {
    const p = new URLSearchParams({ mode });
    if (mode === "month") { p.set("rocYear", String(rocYear)); p.set("month", String(month)); }
    else if (mode === "year") { p.set("rocYear", String(rocYear)); }
    else { p.set("from", from); p.set("to", to); }
    return p.toString();
  }, [mode, rocYear, month, from, to]);

  const load = useCallback(async () => {
    setReport(null);
    setError(null);
    if (mode === "custom" && (!from || !to)) return;
    try {
      const res = await fetchRegistration(`/api/finance-center/reports?${query}`);
      const data = await res.json();
      if (!res.ok) { setError(toFriendlyError(res.status, data?.error)); return; }
      setReport(data.report);
    } catch {
      setError("讀取報表時發生連線問題。");
    }
  }, [query, mode, from, to]);

  useEffect(() => { void load(); }, [load]);

  const inputCls = "rounded-lg border border-cream-300 px-2 py-1 text-sm";

  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <div className="mb-4 flex items-center gap-3">
        <BackButton fallbackHref="/finance-center" />
        <h1 className="text-lg text-ink">財務報表</h1>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl bg-white/70 p-4 shadow-card text-sm text-ink-soft">
        <div className="flex gap-1">
          {(["month", "year", "custom"] as const).map((m) => (
            <button key={m} type="button" onClick={() => setMode(m)} className={`rounded-full px-3 py-1 ${mode === m ? "bg-ink-soft text-cream-50" : "bg-cream-100 text-ink-soft"}`}>
              {m === "month" ? "每月" : m === "year" ? "每年" : "自訂"}
            </button>
          ))}
        </div>
        {mode !== "custom" && <label>民國<input type="number" value={rocYear} onChange={(e) => setRocYear(Number(e.target.value) || rocNow())} className={`ml-1 w-20 ${inputCls}`} /></label>}
        {mode === "month" && <label>月<input type="number" min={1} max={12} value={month} onChange={(e) => setMonth(Number(e.target.value) || 1)} className={`ml-1 w-16 ${inputCls}`} /></label>}
        {mode === "custom" && (
          <>
            <label>起<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={`ml-1 ${inputCls}`} /></label>
            <label>迄<input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={`ml-1 ${inputCls}`} /></label>
          </>
        )}
        <div className="ml-auto flex gap-2">
          <a href={`/finance-center/reports/print?${query}`} target="_blank" rel="noopener noreferrer" className="rounded-full bg-yolk-200 px-4 py-1.5 text-sm text-ink hover:bg-yolk-300">PDF 列印</a>
          <a href={`/api/finance-center/export?${query}`} className="rounded-full bg-sage-200 px-4 py-1.5 text-sm text-ink hover:bg-sage-300">Excel 匯出</a>
        </div>
      </div>

      {error && <p className="mb-3 text-sm text-blossom-500">{error}</p>}
      {!report ? (
        <p className="text-sm text-ink-faint">{mode === "custom" && (!from || !to) ? "請選擇自訂起迄日期。" : "讀取中…"}</p>
      ) : (
        <div className="flex flex-col gap-4">
          <section className="rounded-2xl bg-white/70 p-5 shadow-card">
            <h2 className="mb-3 text-base text-ink">財務摘要・{report.range.label}</h2>
            <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <Stat label="期初總結餘" value={money(report.opening.total)} />
              <Stat label="收入合計" value={money(report.income)} tone="sage" />
              <Stat label="支出合計" value={money(report.expense)} tone="blossom" />
              <Stat label="期末總結餘" value={money(report.closing.total)} tone="yolk" />
              <Stat label="期末銀行" value={money(report.closing.bank)} />
              <Stat label="期末現金" value={money(report.closing.cash)} />
              <Stat label="淨額" value={money(report.net)} />
              <Stat label="銀行/現金異動淨" value={`${money(report.bankMovement.net)} / ${money(report.cashMovement.net)}`} />
            </div>
          </section>

          {report.activityBreakdown.length > 0 && (
            <section className="rounded-2xl bg-white/70 p-5 shadow-card">
              <h2 className="mb-2 text-base text-ink">活動收支</h2>
              <table className="w-full text-left text-sm">
                <thead><tr className="text-xs text-ink-faint"><th className="px-2 py-1">活動</th><th className="px-2 py-1 text-right">收入</th><th className="px-2 py-1 text-right">支出</th><th className="px-2 py-1 text-right">淨額</th></tr></thead>
                <tbody>
                  {report.activityBreakdown.map((a) => (
                    <tr key={a.activityId} className="border-t border-cream-100 text-ink">
                      <td className="px-2 py-1">{a.activityLabel}</td>
                      <td className="px-2 py-1 text-right text-sage-600">{money(a.income)}</td>
                      <td className="px-2 py-1 text-right text-blossom-500">{money(a.expense)}</td>
                      <td className="px-2 py-1 text-right">{money(a.net)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
          <p className="text-xs text-ink-faint">完整收入/支出/流水帳/銀行現金異動明細，請用上方「PDF 列印」或「Excel 匯出」（兩者與本頁共用同一查詢來源）。</p>
        </div>
      )}
    </main>
  );
}

function Stat({ label, value, tone = "cream" }: { label: string; value: string; tone?: string }) {
  const t: Record<string, string> = { cream: "bg-cream-100", sage: "bg-sage-100", blossom: "bg-blossom-100", yolk: "bg-yolk-100" };
  return (
    <div className={`rounded-xl ${t[tone]} p-3`}>
      <p className="text-xs text-ink-soft">{label}</p>
      <p className="mt-0.5 text-base font-medium text-ink">{value} 元</p>
    </div>
  );
}
