"use client";

import { useState } from "react";
import { OperatorProvider } from "@/lib/operatorClient";
import OperatorBar from "@/components/system/OperatorBar";
import BackButton from "@/components/navigation/BackButton";
import { fetchRegistration, toFriendlyError } from "@/lib/registrationFetch";

/** V22 現金盤點／銀行對帳：差額建立調整紀錄，不可直接改餘額。 */
function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

type Result = { systemAmount: number; countedAmount: number; difference: number; adjustmentRecordId: string | null };

export default function ReconcilePage() {
  return (
    <OperatorProvider>
      <div className="min-h-screen">
        <OperatorBar />
        <ReconcileInner />
      </div>
    </OperatorProvider>
  );
}

function ReconcileInner() {
  const [account, setAccount] = useState<"CASH" | "BANK">("CASH");
  const [countedAmount, setCounted] = useState("");
  const [occurredOn, setOccurredOn] = useState(todayISO());
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const inputCls = "min-h-11 w-full rounded-xl border border-cream-300 px-3 py-2 text-sm";

  async function submit() {
    setError(null);
    setResult(null);
    const amt = Number(countedAmount);
    if (!Number.isFinite(amt)) return setError("請輸入盤點金額");
    setBusy(true);
    try {
      const res = await fetchRegistration("/api/finance-center/reconciliations", {
        method: "POST",
        body: JSON.stringify({ account, countedAmount: amt, occurredOn, note: note.trim() || null }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(toFriendlyError(res.status, data?.error));
        return;
      }
      setResult({ systemAmount: data.systemAmount, countedAmount: data.countedAmount, difference: data.difference, adjustmentRecordId: data.adjustmentRecordId });
    } catch {
      setError("送出時發生連線問題。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-lg px-6 py-8">
      <div className="mb-4 flex items-center gap-3">
        <BackButton fallbackHref="/finance-center" />
        <h1 className="text-lg text-ink">盤點 / 對帳</h1>
      </div>
      <div className="flex flex-col gap-4 rounded-3xl bg-white/70 p-5 shadow-card">
        <label className="text-sm text-ink-soft">
          盤點帳戶
          <div className="mt-1 flex gap-2">
            {(["CASH", "BANK"] as const).map((a) => (
              <button key={a} type="button" onClick={() => setAccount(a)} className={`min-h-10 flex-1 rounded-xl px-3 text-sm ${account === a ? "bg-sage-200 text-ink" : "bg-cream-100 text-ink-soft"}`}>
                {a === "CASH" ? "現金盤點" : "銀行對帳"}
              </button>
            ))}
          </div>
        </label>
        <label className="text-sm text-ink-soft">
          實際盤點金額
          <input type="number" inputMode="numeric" className={`mt-1 ${inputCls}`} value={countedAmount} onChange={(e) => setCounted(e.target.value)} placeholder="0" />
        </label>
        <label className="text-sm text-ink-soft">
          日期
          <input type="date" className={`mt-1 ${inputCls}`} value={occurredOn} onChange={(e) => setOccurredOn(e.target.value)} />
        </label>
        <label className="text-sm text-ink-soft">
          備註（選填）
          <input className={`mt-1 ${inputCls}`} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        {error && <p className="text-sm text-blossom-500">⚠️ {error}</p>}
        {result && (
          <div className="rounded-2xl bg-cream-100 p-4 text-sm text-ink">
            <p>系統餘額：{result.systemAmount.toLocaleString("zh-Hant")} 元</p>
            <p>實際盤點：{result.countedAmount.toLocaleString("zh-Hant")} 元</p>
            <p className={result.difference === 0 ? "text-sage-500" : "text-blossom-500"}>
              差額：{result.difference.toLocaleString("zh-Hant")} 元
              {result.difference === 0 ? "（相符）" : result.adjustmentRecordId ? "（已建立調整紀錄）" : ""}
            </p>
          </div>
        )}
        <button type="button" onClick={() => void submit()} disabled={busy} className="min-h-11 rounded-full bg-yolk-200 px-5 text-sm font-medium text-ink hover:bg-yolk-300 disabled:opacity-40">
          {busy ? "處理中…" : "送出盤點"}
        </button>
        <p className="text-xs text-ink-faint">差額不會直接修改餘額，而是新增一筆「盤點調整」流水帳修正。</p>
      </div>
    </main>
  );
}
