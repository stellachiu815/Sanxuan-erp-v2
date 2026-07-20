"use client";

import { useRef, useState } from "react";
import { paymentMethodTypeOptions, receivableSourceTypeLabel } from "@/lib/labels";
import type { UniversalReceivableViewJSON } from "./types";
import { useStoredOperatorUserId } from "@/lib/operatorClient";

type MemberSearchResult = { memberId: string; name: string; householdId: string };
type BasketItem = { sourceType: string; sourceId: string; label: string; amount: number };

/**
 * V11.0 需求「快速收款」：搜尋信眾 → 勾選其名下多筆未收款項（可跨來源）
 * → 放進「收款購物籃」→ 一次結帳，建立一筆 PaymentTransaction 底下多筆
 * PaymentAllocation。也支援直接建立「其他臨時應收項目」後立刻加入購物籃。
 */
export default function QuickPaymentScreen({ currentYear }: { currentYear: number }) {
  // V12.2 指令「五」：GET /api/search 這次補上了信眾 view 權限檢查，這裡
  // 沿用**同一個**既有身分來源把 operatorUserId 帶上（見
  // src/lib/operatorClient.tsx 的說明），不是另一套登入或角色機制。
  const operatorUserId = useStoredOperatorUserId();

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MemberSearchResult[]>([]);
  const [selected, setSelected] = useState<MemberSearchResult | null>(null);
  const [receivables, setReceivables] = useState<UniversalReceivableViewJSON[]>([]);
  const [basket, setBasket] = useState<BasketItem[]>([]);

  const [manualTitle, setManualTitle] = useState("");
  const [manualAmount, setManualAmount] = useState("");
  const [showManualForm, setShowManualForm] = useState(false);

  const [methodType, setMethodType] = useState("CASH");
  const [methodNote, setMethodNote] = useState("");
  const [bankName, setBankName] = useState("");
  const [bankAccountLast5, setBankAccountLast5] = useState("");
  const [checkNumber, setCheckNumber] = useState("");
  const [isAgentCollected, setIsAgentCollected] = useState(false);
  const [agentName, setAgentName] = useState("");
  const [collectedByName, setCollectedByName] = useState("");
  const [operatorName, setOperatorName] = useState("");
  const [note, setNote] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successNo, setSuccessNo] = useState<string | null>(null);

  // 需求「九、重複送出防護」：這一次「確認收款」動作固定使用同一組
  // idempotencyKey，就算 disabled={submitting} 沒有及時擋下第二次點擊
  // （例如快速連點兩下），兩次送出的請求也會帶同一組值，讓伺服器端可以
  // 判斷這是「同一次收款」而不是兩筆。收款成功或改變購物籃內容後才清空，
  // 讓「下一筆全新的收款」會拿到新的識別碼。
  const idempotencyKeyRef = useRef<string | null>(null);

  async function search(q: string) {
    setQuery(q);
    if (!q.trim()) {
      setResults([]);
      return;
    }
    const res = await fetch(`/api/search?q=${encodeURIComponent(q)}${operatorUserId ? `&operatorUserId=${encodeURIComponent(operatorUserId)}` : ""}`);
    const data = await res.json();
    setResults(data.results ?? []);
  }

  async function selectMember(m: MemberSearchResult) {
    setSelected(m);
    setResults([]);
    setQuery(m.name);
    const res = await fetch(`/api/collection-center/pending?sponsorMemberId=${encodeURIComponent(m.memberId)}`);
    const data = await res.json();
    setReceivables(data.rows ?? []);
  }

  function addToBasket(r: UniversalReceivableViewJSON) {
    if (!r.canCollect) return;
    if (basket.some((b) => b.sourceType === r.sourceType && b.sourceId === r.sourceId)) return;
    const label = r.activityName ? `${r.itemName}（${r.activityName}）` : r.itemName;
    setBasket((prev) => [
      ...prev,
      { sourceType: r.sourceType, sourceId: r.sourceId, label, amount: r.unpaidAmount },
    ]);
    // 購物籃內容真正改變了，這已經不是原本那次送出失敗的收款，之後重新
    // 送出要視為全新的一次收款，改用新的 idempotencyKey。
    idempotencyKeyRef.current = null;
  }

  function removeFromBasket(sourceId: string) {
    setBasket((prev) => prev.filter((b) => b.sourceId !== sourceId));
    idempotencyKeyRef.current = null;
  }

  function updateBasketAmount(sourceId: string, amount: number) {
    setBasket((prev) => prev.map((b) => (b.sourceId === sourceId ? { ...b, amount } : b)));
    idempotencyKeyRef.current = null;
  }

  async function createManualAndAdd() {
    if (!selected || !manualTitle.trim() || !manualAmount) return;
    const res = await fetch(`/api/collection-center/manual-receivables`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: manualTitle,
        year: currentYear,
        payerMemberId: selected.memberId,
        payerHouseholdId: selected.householdId,
        payerNameSnapshot: selected.name,
        amountDue: Number(manualAmount),
        createdByName: operatorName || null,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "建立臨時應收項目失敗");
      return;
    }
    setBasket((prev) => [
      ...prev,
      { sourceType: "MANUAL", sourceId: data.id, label: `${manualTitle}（${currentYear}年度・臨時應收）`, amount: Number(manualAmount) },
    ]);
    setManualTitle("");
    setManualAmount("");
    setShowManualForm(false);
  }

  const totalAmount = basket.reduce((s, b) => s + (Number.isFinite(b.amount) ? b.amount : 0), 0);

  async function submit() {
    setError(null);
    if (!selected) {
      setError("請先搜尋並選取付款人");
      return;
    }
    if (!basket.length) {
      setError("購物籃是空的，請至少加入一筆項目");
      return;
    }
    if (isAgentCollected && !agentName.trim()) {
      setError("代收請填寫代收人姓名");
      return;
    }
    if (!idempotencyKeyRef.current) {
      idempotencyKeyRef.current =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/collection-center/payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          totalAmount,
          methodType,
          methodNote: methodType === "OTHER" ? methodNote : null,
          bankName: methodType === "BANK_TRANSFER" ? bankName : null,
          bankAccountLast5: methodType === "BANK_TRANSFER" ? bankAccountLast5 : null,
          checkNumber: methodType === "CHECK" ? checkNumber : null,
          payerMemberId: selected.memberId,
          payerHouseholdId: selected.householdId,
          payerNameSnapshot: selected.name,
          collectedByName: collectedByName || null,
          isAgentCollected,
          agentName: isAgentCollected ? agentName : null,
          note: note || null,
          operatorName: operatorName || null,
          idempotencyKey: idempotencyKeyRef.current,
          allocations: basket.map((b) => ({ sourceType: b.sourceType, sourceId: b.sourceId, amount: b.amount })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "建立收款失敗");
        return;
      }
      setSuccessNo(data.transactionNo);
      idempotencyKeyRef.current = null;
      setBasket([]);
      setReceivables([]);
      setSelected(null);
      setQuery("");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {successNo && (
        <div className="rounded-2xl bg-sage-100 p-4 text-sm text-ink">
          ✅ 收款完成，收款序號：{successNo}
        </div>
      )}
      {error && <div className="rounded-2xl bg-blossom-100 p-4 text-sm text-ink">{error}</div>}

      <section className="rounded-3xl bg-white/70 p-6 shadow-card">
        <h2 className="text-sm text-ink-soft">① 搜尋付款信眾</h2>
        <input
          value={query}
          onChange={(e) => search(e.target.value)}
          placeholder="輸入姓名/電話/地址/家戶編號搜尋"
          className="mt-2 w-full rounded-xl border border-cream-200 px-4 py-2 text-sm"
        />
        {!!results.length && (
          <ul className="mt-2 divide-y divide-cream-100 rounded-xl border border-cream-200">
            {results.map((r) => (
              <li key={r.memberId} className="cursor-pointer px-4 py-2 text-sm hover:bg-cream-100" onClick={() => selectMember(r)}>
                {r.name}（{r.householdId}）
              </li>
            ))}
          </ul>
        )}
        {selected && <p className="mt-2 text-sm text-ink">已選取：{selected.name}（{selected.householdId}）</p>}
      </section>

      {selected && (
        <section className="rounded-3xl bg-white/70 p-6 shadow-card">
          <h2 className="text-sm text-ink-soft">② 選擇未收款項加入購物籃</h2>
          <div className="mt-3 flex flex-col gap-2">
            {receivables.map((r) => {
              const inBasket = basket.some((b) => b.sourceId === r.sourceId);
              return (
                <div key={`${r.sourceType}-${r.sourceId}`} className="flex items-center justify-between rounded-xl bg-cream-50 px-4 py-3">
                  <div>
                    <p className="text-sm text-ink">{receivableSourceTypeLabel[r.sourceType] ?? r.sourceType}・{r.itemName}</p>
                    <p className="text-xs text-ink-faint">
                      {r.activityName ? `${r.activityName}・` : ""}未收 {r.unpaidAmount.toLocaleString("zh-Hant")} 元
                      {!r.canCollect && `・${r.cannotCollectReason ?? "目前無法收款"}`}
                    </p>
                  </div>
                  <button
                    disabled={inBasket || !r.canCollect}
                    onClick={() => addToBasket(r)}
                    className="rounded-full bg-sage-100 px-3 py-1 text-xs text-ink-soft hover:bg-sage-200 disabled:opacity-40"
                  >
                    {inBasket ? "已加入" : "加入購物籃"}
                  </button>
                </div>
              );
            })}
            {!receivables.length && <p className="text-sm text-ink-faint">這位信眾目前沒有已串接來源的未收款項</p>}
          </div>

          <div className="mt-4">
            {!showManualForm ? (
              <button onClick={() => setShowManualForm(true)} className="text-xs text-ink-faint underline-offset-4 hover:underline">
                ＋ 建立其他臨時應收項目
              </button>
            ) : (
              <div className="flex flex-wrap items-end gap-2 rounded-xl bg-cream-50 p-4">
                <div>
                  <label className="block text-xs text-ink-faint">項目名稱</label>
                  <input value={manualTitle} onChange={(e) => setManualTitle(e.target.value)} className="rounded-lg border border-cream-200 px-2 py-1 text-sm" />
                </div>
                <div>
                  <label className="block text-xs text-ink-faint">金額</label>
                  <input
                    type="number"
                    value={manualAmount}
                    onChange={(e) => setManualAmount(e.target.value)}
                    className="w-28 rounded-lg border border-cream-200 px-2 py-1 text-sm"
                  />
                </div>
                <button onClick={createManualAndAdd} className="rounded-full bg-sage-100 px-3 py-2 text-xs text-ink-soft hover:bg-sage-200">
                  建立並加入
                </button>
              </div>
            )}
          </div>
        </section>
      )}

      {!!basket.length && (
        <section className="rounded-3xl bg-white/70 p-6 shadow-card">
          <h2 className="text-sm text-ink-soft">③ 收款購物籃（合併結帳）</h2>
          <div className="mt-3 flex flex-col gap-2">
            {basket.map((b) => (
              <div key={b.sourceId} className="flex items-center justify-between gap-3 rounded-xl bg-cream-50 px-4 py-3">
                <p className="flex-1 text-sm text-ink">{b.label}</p>
                <input
                  type="number"
                  value={b.amount}
                  onChange={(e) => updateBasketAmount(b.sourceId, Number(e.target.value))}
                  className="w-28 rounded-lg border border-cream-200 px-2 py-1 text-sm text-right"
                />
                <button onClick={() => removeFromBasket(b.sourceId)} className="text-xs text-ink-faint hover:underline">
                  移除
                </button>
              </div>
            ))}
          </div>
          <p className="mt-3 text-right text-base text-ink">合計：{totalAmount.toLocaleString("zh-Hant")} 元</p>

          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs text-ink-faint">收款方式</label>
              <select value={methodType} onChange={(e) => setMethodType(e.target.value)} className="w-full rounded-lg border border-cream-200 px-2 py-2 text-sm">
                {paymentMethodTypeOptions.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            {methodType === "BANK_TRANSFER" && (
              <>
                <div>
                  <label className="block text-xs text-ink-faint">銀行名稱</label>
                  <input value={bankName} onChange={(e) => setBankName(e.target.value)} className="w-full rounded-lg border border-cream-200 px-2 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-xs text-ink-faint">帳號末五碼</label>
                  <input value={bankAccountLast5} onChange={(e) => setBankAccountLast5(e.target.value)} className="w-full rounded-lg border border-cream-200 px-2 py-2 text-sm" />
                </div>
              </>
            )}
            {methodType === "CHECK" && (
              <div>
                <label className="block text-xs text-ink-faint">支票號碼</label>
                <input value={checkNumber} onChange={(e) => setCheckNumber(e.target.value)} className="w-full rounded-lg border border-cream-200 px-2 py-2 text-sm" />
              </div>
            )}
            {methodType === "OTHER" && (
              <div>
                <label className="block text-xs text-ink-faint">說明</label>
                <input value={methodNote} onChange={(e) => setMethodNote(e.target.value)} className="w-full rounded-lg border border-cream-200 px-2 py-2 text-sm" />
              </div>
            )}
            <div>
              <label className="block text-xs text-ink-faint">收款經手人</label>
              <input value={collectedByName} onChange={(e) => setCollectedByName(e.target.value)} className="w-full rounded-lg border border-cream-200 px-2 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-ink-faint">操作人（登入機制完成前暫由此欄記錄）</label>
              <input value={operatorName} onChange={(e) => setOperatorName(e.target.value)} className="w-full rounded-lg border border-cream-200 px-2 py-2 text-sm" />
            </div>
            <div className="sm:col-span-2">
              <label className="flex items-center gap-2 text-sm text-ink">
                <input type="checkbox" checked={isAgentCollected} onChange={(e) => setIsAgentCollected(e.target.checked)} />
                此筆為代收（他人代為收款，之後需繳回宮方）
              </label>
              {isAgentCollected && (
                <input
                  value={agentName}
                  onChange={(e) => setAgentName(e.target.value)}
                  placeholder="代收人姓名"
                  className="mt-2 w-full rounded-lg border border-cream-200 px-2 py-2 text-sm"
                />
              )}
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs text-ink-faint">備註</label>
              <input value={note} onChange={(e) => setNote(e.target.value)} className="w-full rounded-lg border border-cream-200 px-2 py-2 text-sm" />
            </div>
          </div>

          <button
            disabled={submitting}
            onClick={submit}
            className="mt-4 w-full rounded-xl bg-sage-200 px-4 py-3 text-sm text-ink hover:bg-sage-300 disabled:opacity-50"
          >
            {submitting ? "處理中…" : `確認收款 ${totalAmount.toLocaleString("zh-Hant")} 元`}
          </button>
        </section>
      )}
    </div>
  );
}
