"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { OperatorProvider } from "@/lib/operatorClient";
import { fetchRegistration, toFriendlyError } from "@/lib/registrationFetch";

/** V22 財務報表 PDF 正式列印頁（print CSS，可直接列印給委員會）。與報表/Excel 共用同一查詢來源。 */

type Entry = { id: string; source: string; date: string; entryKind: string; account: "BANK" | "CASH"; direction: "IN" | "OUT"; amount: number; category: string; description: string | null; activityLabel: string | null; operator: string | null; status: string; isHistorical: boolean };
type Movement = { inflow: number; outflow: number; net: number };
type Balances = { bank: number; cash: number; total: number };
type Report = {
  range: { from: string; to: string; label: string };
  opening: Balances; closing: Balances; income: number; expense: number; net: number;
  bankMovement: Movement; cashMovement: Movement;
  incomeEntries: Entry[]; expenseEntries: Entry[];
  activityBreakdown: { activityId: string; activityLabel: string; income: number; expense: number; net: number }[];
  ledger: Entry[];
};

const KIND: Record<string, string> = { OPENING: "期初", INCOME: "收入", EXPENSE: "支出", TRANSFER_IN: "轉入", TRANSFER_OUT: "轉出", ADJUSTMENT: "調整" };
const m = (n: number) => n.toLocaleString("zh-Hant");

export default function ReportPrintPage() {
  return (
    <OperatorProvider>
      <Suspense fallback={<p className="p-6 text-sm">讀取中…</p>}>
        <PrintInner />
      </Suspense>
    </OperatorProvider>
  );
}

function PrintInner() {
  const params = useSearchParams();
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetchRegistration(`/api/finance-center/reports?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) { setError(toFriendlyError(res.status, data?.error)); return; }
      setReport(data.report);
    } catch {
      setError("讀取報表時發生連線問題。");
    }
  }, [params]);

  useEffect(() => { void load(); }, [load]);

  if (error) return <p className="p-6 text-sm text-blossom-500">{error}</p>;
  if (!report) return <p className="p-6 text-sm text-ink-faint">讀取中…</p>;

  // 分類小計：只算一般收入/支出（排除期初/轉帳/調整/歷史）。
  const flow = report.ledger.filter((e) => (e.entryKind === "INCOME" || e.entryKind === "EXPENSE") && !e.isHistorical);
  const catMap = new Map<string, { income: number; expense: number }>();
  for (const e of flow) {
    const c = catMap.get(e.category) ?? { income: 0, expense: 0 };
    if (e.direction === "IN") c.income += e.amount; else c.expense += e.amount;
    catMap.set(e.category, c);
  }
  const catRows = [...catMap.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([c, v]) => [c, m(v.income), m(v.expense)]);

  return (
    <main className="mx-auto max-w-4xl px-6 py-8 text-ink">
      <style>{`@page { size: A4; margin: 14mm; } @media print { .no-print { display:none !important; } }`}</style>
      <div className="no-print mb-4 flex justify-end">
        <button type="button" onClick={() => window.print()} className="rounded-full bg-yolk-200 px-5 py-2 text-sm text-ink hover:bg-yolk-300">列印 / 存成 PDF</button>
      </div>

      <h1 className="text-center text-xl font-medium">台北三玄宮 財務報表</h1>
      <p className="mb-4 text-center text-sm text-ink-soft">{report.range.label}（{report.range.from} ~ {report.range.to}）</p>

      <Section title="財務摘要">
        <table className="w-full text-sm">
          <tbody>
            <Row2 a="期初總結餘" av={m(report.opening.total)} b="期末總結餘" bv={m(report.closing.total)} />
            <Row2 a="期初銀行" av={m(report.opening.bank)} b="期末銀行" bv={m(report.closing.bank)} />
            <Row2 a="期初現金" av={m(report.opening.cash)} b="期末現金" bv={m(report.closing.cash)} />
            <Row2 a="收入合計" av={m(report.income)} b="支出合計" bv={m(report.expense)} />
            <Row2 a="淨額" av={m(report.net)} b="銀行/現金異動淨" bv={`${m(report.bankMovement.net)} / ${m(report.cashMovement.net)}`} />
          </tbody>
        </table>
      </Section>

      {report.activityBreakdown.length > 0 && (
        <Section title="活動收支">
          <SimpleTable head={["活動", "收入", "支出", "淨額"]} rows={report.activityBreakdown.map((a) => [a.activityLabel, m(a.income), m(a.expense), m(a.net)])} rightFrom={1} />
        </Section>
      )}

      <Section title="分類小計（收入／支出）">
        <SimpleTable head={["類別", "收入", "支出"]} rows={catRows} rightFrom={1} />
      </Section>

      <Section title="收支明細（可對帳）">
        <SimpleTable
          head={["日期", "類別", "品項／說明", "收入", "支出", "帳戶"]}
          rows={report.ledger.map((e) => {
            const kindLabel = KIND[e.entryKind] ?? e.entryKind;
            const cat = e.entryKind === "INCOME" || e.entryKind === "EXPENSE" ? e.category : kindLabel;
            return [e.date, cat + (e.isHistorical ? "・歷史" : ""), e.description ?? "", e.direction === "IN" ? m(e.amount) : "", e.direction === "OUT" ? m(e.amount) : "", e.account === "BANK" ? "銀行" : "現金"];
          })}
          rightFrom={3} rightTo={4}
        />
      </Section>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-5">
      <h2 className="mb-1 border-b border-ink/30 pb-1 text-base font-medium">{title}</h2>
      {children}
    </section>
  );
}
function Row2({ a, av, b, bv }: { a: string; av: string; b: string; bv: string }) {
  return (
    <tr className="border-b border-ink/10">
      <td className="py-1 text-ink-soft">{a}</td><td className="py-1 text-right">{av}</td>
      <td className="py-1 pl-6 text-ink-soft">{b}</td><td className="py-1 text-right">{bv}</td>
    </tr>
  );
}
function SimpleTable({ head, rows, rightFrom, rightTo }: { head: string[]; rows: string[][]; rightFrom?: number; rightTo?: number }) {
  const isRight = (i: number) => rightFrom !== undefined && i >= rightFrom && (rightTo === undefined || i <= rightTo);
  return (
    <table className="w-full border-collapse text-sm">
      <thead><tr className="border-b border-ink/30 text-xs text-ink-soft">{head.map((h, i) => <th key={i} className={`px-1 py-1 ${isRight(i) ? "text-right" : "text-left"}`}>{h}</th>)}</tr></thead>
      <tbody>
        {rows.map((r, ri) => (
          <tr key={ri} className="border-b border-ink/10">{r.map((c, ci) => <td key={ci} className={`px-1 py-0.5 ${isRight(ci) ? "text-right" : "text-left"}`}>{c}</td>)}</tr>
        ))}
        {rows.length === 0 && <tr><td colSpan={head.length} className="py-2 text-center text-ink-faint">（無資料）</td></tr>}
      </tbody>
    </table>
  );
}
