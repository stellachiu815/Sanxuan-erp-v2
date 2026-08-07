"use client";

import { useEffect, useState, useCallback } from "react";
import { OperatorProvider } from "@/lib/operatorClient";
import OperatorBar from "@/components/system/OperatorBar";
import { fetchRegistration, toFriendlyError } from "@/lib/registrationFetch";

/**
 * V38 供師名單頁（普渡底下、**不進財務**）。
 *  - 新增：姓名＋金額（自填）。
 *  - 繳費：勾選（純手動狀態，不開收據）。
 *  - 列印：整份名單含金額、合計（列印時只留名單）。
 */

type Row = { id: string; name: string; amount: number; paid: boolean; householdId: string | null; createdByName: string | null };
const THIS_YEAR = new Date().getFullYear() - 1911;

export default function MasterOfferingsPage() {
  return (
    <OperatorProvider>
      <div className="min-h-screen">
        <div className="print:hidden"><OperatorBar /></div>
        <Inner />
      </div>
    </OperatorProvider>
  );
}

function Inner() {
  const [year, setYear] = useState(THIS_YEAR);
  const [rows, setRows] = useState<Row[]>([]);
  const [ready, setReady] = useState(true);
  const [total, setTotal] = useState(0);
  const [paidCount, setPaidCount] = useState(0);
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetchRegistration(`/api/master-offering?year=${year}`, { method: "GET" });
      const data = await res.json();
      if (!res.ok) { setError(toFriendlyError(res.status, data?.error)); return; }
      setReady(data.ready !== false);
      setRows(data.rows ?? []);
      setTotal(data.totalAmount ?? 0);
      setPaidCount(data.paidCount ?? 0);
    } catch { setError("連線問題，請稍後再試。"); }
  }, [year]);

  useEffect(() => { load(); }, [load]);

  async function add() {
    if (!name.trim()) { setError("請填供師姓名"); return; }
    setBusy(true); setError(null);
    try {
      const res = await fetchRegistration(`/api/master-offering`, {
        method: "POST", body: JSON.stringify({ year, name: name.trim(), amount: Number(amount) || 0 }),
      });
      const data = await res.json();
      if (!res.ok) { setError(toFriendlyError(res.status, data?.error)); return; }
      setName(""); setAmount(""); await load();
    } catch { setError("新增失敗，請稍後再試。"); } finally { setBusy(false); }
  }
  async function togglePaid(r: Row) {
    setRows((prev) => prev.map((x) => (x.id === r.id ? { ...x, paid: !x.paid } : x)));
    try {
      await fetchRegistration(`/api/master-offering`, { method: "PATCH", body: JSON.stringify({ id: r.id, paid: !r.paid }) });
      await load();
    } catch { await load(); }
  }
  async function remove(r: Row) {
    if (!window.confirm(`刪除供師「${r.name}」？`)) return;
    try {
      await fetchRegistration(`/api/master-offering`, { method: "DELETE", body: JSON.stringify({ id: r.id }) });
      await load();
    } catch { setError("刪除失敗，請稍後再試。"); }
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-8 flex flex-col gap-6">
      <div className="flex items-center justify-between print:hidden">
        <h1 className="text-lg text-ink">供師名單（民國 {year} 年）</h1>
        <div className="flex items-center gap-2">
          <input type="number" value={year} onChange={(e) => setYear(Number(e.target.value) || THIS_YEAR)}
            className="w-24 rounded-full border border-mist-200 bg-white px-3 py-1.5 text-sm text-ink" />
          <button type="button" onClick={() => window.print()} className="rounded-full bg-ink px-4 py-1.5 text-sm text-white">列印名單</button>
        </div>
      </div>

      {!ready && (
        <p className="rounded-xl bg-blossom-50 px-4 py-3 text-sm text-blossom-500 print:hidden">供師資料表尚未建立。請先到「系統管理 → 家戶資料整理 → 建立供師資料表」按一下。</p>
      )}
      {error && <p className="text-sm text-blossom-500 print:hidden">⚠️ {error}</p>}

      {ready && (
        <section className="rounded-2xl bg-white/70 p-4 shadow-card print:hidden">
          <h2 className="text-sm font-medium text-ink">新增供師</h2>
          <div className="mt-2 flex flex-wrap gap-2">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="姓名"
              onKeyDown={(e) => { if (e.key === "Enter") add(); }}
              className="rounded-full border border-mist-200 bg-white px-4 py-1.5 text-sm text-ink w-40" />
            <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="numeric" placeholder="金額（自填）"
              onKeyDown={(e) => { if (e.key === "Enter") add(); }}
              className="rounded-full border border-mist-200 bg-white px-4 py-1.5 text-sm text-ink w-32" />
            <button type="button" disabled={busy} onClick={add} className="rounded-full bg-mist-200 px-4 py-1.5 text-sm text-ink disabled:opacity-40">{busy ? "新增中…" : "新增"}</button>
          </div>
          <p className="mt-1 text-xs text-ink-faint">供師不進收款中心、不開收據；金額純記錄、繳費用打勾。</p>
        </section>
      )}

      <section className="rounded-2xl bg-white p-5 shadow-card">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-medium text-ink">供師名單</h2>
          <span className="text-sm text-ink-soft">共 {rows.length} 位｜合計 {total.toLocaleString()} 元｜已繳 {paidCount} 位</span>
        </div>
        <table className="mt-3 w-full text-sm">
          <thead>
            <tr className="border-b border-mist-200 text-left text-ink-soft">
              <th className="py-1.5 w-10">#</th>
              <th className="py-1.5">姓名</th>
              <th className="py-1.5 text-right">金額</th>
              <th className="py-1.5 text-center">繳費</th>
              <th className="py-1.5 text-right print:hidden">　</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id} className="border-b border-mist-100">
                <td className="py-1.5 text-ink-faint">{i + 1}</td>
                <td className="py-1.5 text-ink">{r.name}</td>
                <td className="py-1.5 text-right text-ink">{r.amount.toLocaleString()}</td>
                <td className="py-1.5 text-center">
                  <label className="inline-flex items-center gap-1">
                    <input type="checkbox" checked={r.paid} onChange={() => togglePaid(r)} className="h-4 w-4" />
                    <span className={`text-xs ${r.paid ? "text-emerald-700" : "text-ink-faint"}`}>{r.paid ? "已繳" : "未繳"}</span>
                  </label>
                </td>
                <td className="py-1.5 text-right print:hidden">
                  <button type="button" onClick={() => remove(r)} className="text-xs text-blossom-500 underline">刪除</button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={5} className="py-4 text-center text-ink-faint">尚無供師。</td></tr>}
          </tbody>
        </table>
      </section>
    </main>
  );
}
