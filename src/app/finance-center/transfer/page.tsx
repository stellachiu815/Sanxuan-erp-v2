"use client";

import { useState } from "react";
import { OperatorProvider } from "@/lib/operatorClient";
import OperatorBar from "@/components/system/OperatorBar";
import BackButton from "@/components/navigation/BackButton";
import { fetchRegistration, toFriendlyError } from "@/lib/registrationFetch";

/** V22 資金轉移：現金↔銀行。不計收入/支出，只改帳戶餘額。 */
function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function TransferPage() {
  return (
    <OperatorProvider>
      <div className="min-h-screen">
        <OperatorBar />
        <TransferInner />
      </div>
    </OperatorProvider>
  );
}

function TransferInner() {
  const [fromAccount, setFrom] = useState<"CASH" | "BANK">("CASH");
  const [amount, setAmount] = useState("");
  const [occurredOn, setOccurredOn] = useState(todayISO());
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const toAccount = fromAccount === "CASH" ? "BANK" : "CASH";
  const inputCls = "min-h-11 w-full rounded-xl border border-cream-300 px-3 py-2 text-sm";

  async function submit() {
    setError(null);
    setOk(null);
    const amt = Number(amount);
    if (!(amt > 0)) return setError("金額必須大於 0");
    setBusy(true);
    try {
      const res = await fetchRegistration("/api/finance-center/transfers", {
        method: "POST",
        body: JSON.stringify({ fromAccount, toAccount, amount: amt, occurredOn, description: description.trim() || null }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(toFriendlyError(res.status, data?.error));
        return;
      }
      setOk(`已轉移 ${amt.toLocaleString("zh-Hant")} 元（${fromAccount === "CASH" ? "現金" : "銀行"} → ${toAccount === "CASH" ? "現金" : "銀行"}）。不計收支。`);
      setAmount("");
      setDescription("");
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
        <h1 className="text-lg text-ink">資金轉移</h1>
      </div>
      <div className="flex flex-col gap-4 rounded-3xl bg-white/70 p-5 shadow-card">
        <label className="text-sm text-ink-soft">
          轉出帳戶
          <div className="mt-1 flex gap-2">
            {(["CASH", "BANK"] as const).map((a) => (
              <button key={a} type="button" onClick={() => setFrom(a)} className={`min-h-10 flex-1 rounded-xl px-3 text-sm ${fromAccount === a ? "bg-sage-200 text-ink" : "bg-cream-100 text-ink-soft"}`}>
                {a === "CASH" ? "現金" : "銀行"}
              </button>
            ))}
          </div>
        </label>
        <p className="rounded-xl bg-mist-100 px-3 py-2 text-sm text-ink-soft">
          {fromAccount === "CASH" ? "現金" : "銀行"} → <span className="font-medium text-ink">{toAccount === "CASH" ? "現金" : "銀行"}</span>
        </p>
        <label className="text-sm text-ink-soft">
          金額
          <input type="number" inputMode="numeric" className={`mt-1 ${inputCls}`} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" />
        </label>
        <label className="text-sm text-ink-soft">
          日期
          <input type="date" className={`mt-1 ${inputCls}`} value={occurredOn} onChange={(e) => setOccurredOn(e.target.value)} />
        </label>
        <label className="text-sm text-ink-soft">
          說明（選填）
          <input className={`mt-1 ${inputCls}`} value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        {error && <p className="text-sm text-blossom-500">⚠️ {error}</p>}
        {ok && <p className="text-sm text-sage-500">✓ {ok}</p>}
        <button type="button" onClick={() => void submit()} disabled={busy} className="min-h-11 rounded-full bg-yolk-200 px-5 text-sm font-medium text-ink hover:bg-yolk-300 disabled:opacity-40">
          {busy ? "送出中…" : "確認轉移"}
        </button>
      </div>
    </main>
  );
}
