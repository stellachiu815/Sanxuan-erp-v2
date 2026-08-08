"use client";

import { useCallback, useEffect, useState } from "react";
import { OperatorProvider, useOperator } from "@/lib/operatorClient";
import OperatorBar from "@/components/system/OperatorBar";
import BackButton from "@/components/navigation/BackButton";
import { fetchRegistration, toFriendlyError } from "@/lib/registrationFetch";
import { canFinance } from "@/lib/permissions";

/** V22 流水帳：全部收支明細（FinanceRecord + 活動收款）。不可刪除，更正採作廢＋新增。 */

type Entry = {
  id: string;
  source: "FINANCE" | "PAYMENT";
  date: string;
  entryKind: string;
  account: "BANK" | "CASH";
  direction: "IN" | "OUT";
  amount: number;
  category: string;
  description: string | null;
  activityLabel: string | null;
  operator: string | null;
  status: string;
  isHistorical: boolean;
  ref: string | null;
};

const KIND_LABEL: Record<string, string> = { OPENING: "期初", INCOME: "收入", EXPENSE: "支出", TRANSFER_IN: "轉入", TRANSFER_OUT: "轉出", ADJUSTMENT: "調整" };

export default function LedgerPage() {
  return (
    <OperatorProvider>
      <div className="min-h-screen">
        <OperatorBar />
        <LedgerInner />
      </div>
    </OperatorProvider>
  );
}

function LedgerInner() {
  const { operatorUser } = useOperator();
  const canVoid = operatorUser ? canFinance(operatorUser.role, "void") : false;
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [account, setAccount] = useState("");
  const [entryKind, setEntryKind] = useState("");
  const [includeVoid, setIncludeVoid] = useState(false);
  const [rows, setRows] = useState<Entry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [balance, setBalance] = useState<number | null>(null); // 目前結餘（全部，不受篩選影響）

  useEffect(() => {
    (async () => {
      try {
        const res = await fetchRegistration("/api/finance-center/summary");
        const d = await res.json();
        if (res.ok) setBalance(d.summary?.totalBalance ?? null);
      } catch { /* 結餘讀取失敗不影響流水帳 */ }
    })();
  }, []);

  const load = useCallback(async () => {
    setRows(null);
    try {
      const p = new URLSearchParams();
      if (from) p.set("from", from);
      if (to) p.set("to", to);
      if (account) p.set("account", account);
      if (entryKind) p.set("entryKind", entryKind);
      if (includeVoid) p.set("includeVoid", "1");
      const res = await fetchRegistration(`/api/finance-center/ledger?${p.toString()}`);
      const data = await res.json();
      if (!res.ok) {
        setError(toFriendlyError(res.status, data?.error));
        return;
      }
      setRows(data.entries);
      setError(null);
    } catch {
      setError("讀取流水帳時發生連線問題。");
    }
  }, [from, to, account, entryKind, includeVoid]);

  useEffect(() => {
    void load();
  }, [load]);

  async function voidRow(e: Entry) {
    if (e.source !== "FINANCE") return;
    const reason = window.prompt("作廢原因（必填）：");
    if (!reason || !reason.trim()) return;
    const res = await fetchRegistration("/api/finance-center/records/void", { method: "POST", body: JSON.stringify({ id: e.id, reason: reason.trim() }) });
    if (res.ok) void load();
    else {
      const d = await res.json().catch(() => null);
      setError(toFriendlyError(res.status, d?.error));
    }
  }

  const active = (rows ?? []).filter((e) => e.status !== "VOID");
  const incomeSum = active.filter((e) => e.entryKind === "INCOME").reduce((s, e) => s + e.amount, 0);
  const expenseSum = active.filter((e) => e.entryKind === "EXPENSE").reduce((s, e) => s + e.amount, 0);
  const nf = (n: number) => n.toLocaleString("zh-Hant");

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <div className="mb-4 flex items-center gap-3">
        <BackButton fallbackHref="/finance-center" />
        <h1 className="text-lg text-ink">流水帳</h1>
      </div>

      {/* V38：隨時看得到「目前結餘（還有多少錢）」＋本頁收支小計。 */}
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-2xl bg-yolk-100 p-4 shadow-card">
          <p className="text-xs text-ink-soft">目前結餘（銀行＋現金）</p>
          <p className="mt-0.5 text-xl font-medium text-ink">{balance === null ? "…" : nf(balance)} 元</p>
        </div>
        <div className="rounded-2xl bg-sage-100 p-4 shadow-card">
          <p className="text-xs text-ink-soft">本頁收入小計</p>
          <p className="mt-0.5 text-xl font-medium text-ink">{nf(incomeSum)} 元</p>
        </div>
        <div className="rounded-2xl bg-blossom-100 p-4 shadow-card">
          <p className="text-xs text-ink-soft">本頁支出小計</p>
          <p className="mt-0.5 text-xl font-medium text-ink">{nf(expenseSum)} 元</p>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-end gap-2 rounded-2xl bg-white/70 p-4 shadow-card text-xs text-ink-soft">
        <label>起<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="ml-1 rounded-lg border border-cream-300 px-2 py-1" /></label>
        <label>迄<input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="ml-1 rounded-lg border border-cream-300 px-2 py-1" /></label>
        <label>帳戶
          <select value={account} onChange={(e) => setAccount(e.target.value)} className="ml-1 rounded-lg border border-cream-300 px-2 py-1">
            <option value="">全部</option><option value="BANK">銀行</option><option value="CASH">現金</option>
          </select>
        </label>
        <label>類別
          <select value={entryKind} onChange={(e) => setEntryKind(e.target.value)} className="ml-1 rounded-lg border border-cream-300 px-2 py-1">
            <option value="">全部</option>
            {Object.entries(KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1"><input type="checkbox" checked={includeVoid} onChange={(e) => setIncludeVoid(e.target.checked)} />含作廢</label>
      </div>

      {error && <p className="mb-3 text-sm text-blossom-500">{error}</p>}
      {rows === null ? (
        <p className="text-sm text-ink-faint">讀取中…</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl bg-white/70 shadow-card">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-cream-200 text-xs text-ink-faint">
                <th className="px-2 py-2">日期</th><th className="px-2 py-2">類別</th><th className="px-2 py-2">帳戶</th>
                <th className="px-2 py-2">項目</th><th className="px-2 py-2">品項／說明</th><th className="px-2 py-2 text-right">收入</th><th className="px-2 py-2 text-right">支出</th>
                <th className="px-2 py-2">活動</th><th className="px-2 py-2">操作人</th><th className="px-2 py-2">狀態</th><th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={`${e.source}-${e.id}`} className={`border-b border-cream-100 ${e.status === "VOID" ? "text-ink-faint line-through" : "text-ink"}`}>
                  <td className="px-2 py-1.5">{e.date}</td>
                  <td className="px-2 py-1.5">{KIND_LABEL[e.entryKind] ?? e.entryKind}{e.isHistorical ? "・歷史" : ""}</td>
                  <td className="px-2 py-1.5">{e.account === "BANK" ? "銀行" : "現金"}</td>
                  <td className="px-2 py-1.5">{e.category}{e.ref ? `（${e.ref}）` : ""}</td>
                  <td className="px-2 py-1.5 text-ink-soft">{e.description ?? ""}</td>
                  <td className="px-2 py-1.5 text-right text-sage-600">{e.direction === "IN" ? e.amount.toLocaleString("zh-Hant") : ""}</td>
                  <td className="px-2 py-1.5 text-right text-blossom-500">{e.direction === "OUT" ? e.amount.toLocaleString("zh-Hant") : ""}</td>
                  <td className="px-2 py-1.5 text-xs text-ink-soft">{e.activityLabel ?? ""}</td>
                  <td className="px-2 py-1.5 text-xs text-ink-soft">{e.operator ?? ""}</td>
                  <td className="px-2 py-1.5 text-xs">{e.status === "COMPLETED" ? "活動收款" : e.status === "VOID" ? "已作廢" : e.status === "DRAFT" ? "草稿" : "已確認"}</td>
                  <td className="px-2 py-1.5">
                    {canVoid && e.source === "FINANCE" && e.status !== "VOID" && e.entryKind !== "OPENING" && (
                      <button type="button" onClick={() => void voidRow(e)} className="rounded-full bg-cream-100 px-2 py-0.5 text-xs text-ink-soft hover:bg-blossom-100">作廢</button>
                    )}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={11} className="px-2 py-6 text-center text-sm text-ink-faint">沒有符合條件的紀錄。</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
