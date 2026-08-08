"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { OperatorProvider } from "@/lib/operatorClient";
import OperatorBar from "@/components/system/OperatorBar";
import BackButton from "@/components/navigation/BackButton";
import { fetchRegistration, toFriendlyError } from "@/lib/registrationFetch";

/** V22 財務中心首頁：總結餘/銀行/現金/今日收入/支出/淨額/應收/已收 + 功能入口。 */

type Summary = {
  totalBalance: number;
  bank: number;
  cash: number;
  todayIncome: number;
  todayExpense: number;
  todayNet: number;
  totalReceivable: number;
  totalReceived: number;
};

const money = (n: number) => `${n.toLocaleString("zh-Hant")} 元`;

export default function FinanceCenterPage() {
  return (
    <OperatorProvider>
      <div className="min-h-screen">
        <OperatorBar />
        <FinanceHomeInner />
      </div>
    </OperatorProvider>
  );
}

function Card({ label, value, tone = "cream", sub }: { label: string; value: string; tone?: string; sub?: string }) {
  const toneClass: Record<string, string> = {
    cream: "bg-cream-100",
    yolk: "bg-yolk-100",
    sage: "bg-sage-100",
    blossom: "bg-blossom-100",
    mist: "bg-mist-100",
  };
  return (
    <div className={`rounded-2xl ${toneClass[tone] ?? "bg-cream-100"} p-4 shadow-card`}>
      <p className="text-xs text-ink-soft">{label}</p>
      <p className="mt-1 text-xl font-medium text-ink">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-ink-faint">{sub}</p>}
    </div>
  );
}

function FinanceHomeInner() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetchRegistration("/api/finance-center/summary");
      const data = await res.json();
      if (!res.ok) {
        setError(toFriendlyError(res.status, data?.error));
        return;
      }
      setSummary(data.summary);
      setError(null);
    } catch {
      setError("讀取財務摘要時發生連線問題。");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const entries: { href: string; label: string; desc: string }[] = [
    { href: "/finance-center/new?kind=INCOME", label: "＋ 新增收入", desc: "一般收入手動入帳" },
    { href: "/finance-center/new?kind=EXPENSE", label: "－ 新增支出", desc: "一般／指定活動，含快捷鍵" },
    { href: "/finance-center/transfer", label: "⇄ 資金轉移", desc: "現金↔銀行，不計收支" },
    { href: "/finance-center/reconcile", label: "✓ 盤點對帳", desc: "現金盤點／銀行對帳" },
    { href: "/finance-center/ledger", label: "☰ 流水帳", desc: "全部收支明細（不可刪除）" },
    { href: "/finance-center/reports", label: "▤ 財務報表", desc: "月／年／自訂＋PDF/Excel" },
  ];

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <BackButton fallbackHref="/" />
          <h1 className="text-lg text-ink">財務中心</h1>
        </div>
      </div>

      {error && <p className="mb-3 text-sm text-blossom-500">{error}</p>}
      {!summary ? (
        <p className="text-sm text-ink-faint">讀取中…</p>
      ) : (
        <>
          <section className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Card label="總結餘（銀行＋現金）" value={money(summary.totalBalance)} tone="yolk" />
            <Card label="銀行存款" value={money(summary.bank)} tone="mist" />
            <Card label="現金" value={money(summary.cash)} tone="sage" />
            <Card label="今日淨額" value={money(summary.todayNet)} tone="cream" sub={`收 ${money(summary.todayIncome)}／支 ${money(summary.todayExpense)}`} />
            <Card label="今日收入" value={money(summary.todayIncome)} tone="sage" />
            <Card label="今日支出" value={money(summary.todayExpense)} tone="blossom" />
            {/* V38：Stella 目前純手動流水帳、感謝狀手寫，先隱藏「活動應收／已收」卡片。
                （未來目標：感謝狀改由系統列印後，可再打開活動勾稽，帳更清楚。） */}
          </section>

          <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {entries.map((e) => (
              <Link key={e.href} href={e.href} className="rounded-2xl bg-white/70 p-4 shadow-card transition hover:bg-white">
                <p className="text-base font-medium text-ink">{e.label}</p>
                <p className="mt-1 text-xs text-ink-soft">{e.desc}</p>
              </Link>
            ))}
          </section>
        </>
      )}
    </main>
  );
}
