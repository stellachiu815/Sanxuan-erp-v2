"use client";

import { useState } from "react";

type AgentSummary = { agentName: string; count: number; totalAmount: number };
type AgentTransaction = { id: string; transactionNo: string; totalAmount: number; paidOn: string };

/**
 * V11.0 需求「代收管理」＋「代收對帳」合併成一個分頁的兩個區塊：
 * 上半是代收人待繳回彙總（首頁提醒卡也會顯示同一份資料），下半是針對
 * 選定代收人進行實際對帳（需求明確要求：實際≠預期繳回金額時必須填寫
 * 差異原因）。
 */
export default function AgentCollectionScreen({ initialSummary }: { initialSummary: AgentSummary[] }) {
  const [summary] = useState(initialSummary);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [transactions, setTransactions] = useState<AgentTransaction[]>([]);
  const [periodLabel, setPeriodLabel] = useState("");
  const [actualAmount, setActualAmount] = useState("");
  const [differenceReason, setDifferenceReason] = useState("");
  const [reconciledByName, setReconciledByName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const expected = transactions.reduce((s, t) => s + t.totalAmount, 0);
  const difference = actualAmount ? Number(actualAmount) - expected : 0;

  async function selectAgent(agentName: string) {
    setSelectedAgent(agentName);
    setSuccess(null);
    const res = await fetch(`/api/collection-center/agent-collection/pending?agentName=${encodeURIComponent(agentName)}`);
    const data = await res.json();
    setTransactions(
      (data.rows ?? []).map((t: { id: string; transactionNo: string; totalAmount: string; paidOn: string }) => ({
        id: t.id,
        transactionNo: t.transactionNo,
        totalAmount: Number(t.totalAmount),
        paidOn: t.paidOn,
      }))
    );
  }

  async function submit() {
    if (!selectedAgent) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/collection-center/agent-collection/reconcile`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentName: selectedAgent,
          periodLabel,
          actualAmount: Number(actualAmount),
          differenceReason: differenceReason || null,
          reconciledByName: reconciledByName || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "對帳失敗");
        return;
      }
      setSuccess("對帳完成");
      setTransactions([]);
      setSelectedAgent(null);
      setActualAmount("");
      setDifferenceReason("");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-3xl bg-white/70 p-6 shadow-card">
        <h2 className="text-sm text-ink-soft">代收人待繳回彙總</h2>
        <div className="mt-3 flex flex-col gap-2">
          {summary.map((a) => (
            <button
              key={a.agentName}
              onClick={() => selectAgent(a.agentName)}
              className={`flex items-center justify-between rounded-xl px-4 py-3 text-left ${selectedAgent === a.agentName ? "bg-yolk-100" : "bg-cream-50 hover:bg-cream-100"}`}
            >
              <span className="text-sm text-ink">{a.agentName}</span>
              <span className="text-sm text-ink-soft">{a.count} 筆・{a.totalAmount.toLocaleString("zh-Hant")} 元</span>
            </button>
          ))}
          {!summary.length && <p className="text-sm text-ink-faint">目前沒有代收待繳回的收款</p>}
        </div>
      </section>

      {selectedAgent && (
        <section className="rounded-3xl bg-white/70 p-6 shadow-card">
          <h2 className="text-sm text-ink-soft">對帳：{selectedAgent}</h2>
          <div className="mt-3 flex flex-col gap-1 text-sm text-ink-soft">
            {transactions.map((t) => (
              <p key={t.id}>{t.transactionNo}・{t.paidOn}・{t.totalAmount.toLocaleString("zh-Hant")} 元</p>
            ))}
          </div>
          <p className="mt-2 text-sm text-ink">應繳回：{expected.toLocaleString("zh-Hant")} 元</p>

          {error && <p className="mt-2 text-sm text-blossom-300">{error}</p>}
          {success && <p className="mt-2 text-sm text-sage-300">{success}</p>}

          <div className="mt-4 flex flex-col gap-2">
            <input value={periodLabel} onChange={(e) => setPeriodLabel(e.target.value)} placeholder="對帳期間，例如「115年7月」" className="rounded-lg border border-cream-200 px-2 py-2 text-sm" />
            <input type="number" value={actualAmount} onChange={(e) => setActualAmount(e.target.value)} placeholder="實際繳回金額" className="rounded-lg border border-cream-200 px-2 py-2 text-sm" />
            {actualAmount && difference !== 0 && (
              <>
                <p className="text-xs text-blossom-300">差異金額：{difference.toLocaleString("zh-Hant")} 元，請填寫差異原因</p>
                <input value={differenceReason} onChange={(e) => setDifferenceReason(e.target.value)} placeholder="差異原因（必填）" className="rounded-lg border border-cream-200 px-2 py-2 text-sm" />
              </>
            )}
            <input value={reconciledByName} onChange={(e) => setReconciledByName(e.target.value)} placeholder="對帳經手人" className="rounded-lg border border-cream-200 px-2 py-2 text-sm" />
            <button disabled={submitting} onClick={submit} className="rounded-full bg-yolk-200 px-4 py-2 text-sm text-ink hover:bg-yolk-300">
              確認對帳
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
