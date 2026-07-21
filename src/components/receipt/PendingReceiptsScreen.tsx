"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { receivableSourceTypeLabel, paymentMethodTypeLabel } from "@/lib/labels";
import { useOperator } from "@/lib/operatorClient";
import { canReceipt } from "@/lib/permissions";
import ReasonDialog from "@/components/system/ReasonDialog";

type PendingRow = {
  allocationId: string;
  paymentTransactionId: string;
  transactionNo: string;
  paidOn: string;
  payerName: string;
  householdId: string | null;
  memberId: string | null;
  sourceType: string;
  sourceLabel: string;
  sourceYear: number | null;
  methodType: string;
  collectedByName: string | null;
  isAgentCollected: boolean;
  allocationAmount: number;
  receiptedAmount: number;
  remainingAmount: number;
  receiptStatus: string;
};

/**
 * 需求「六、待開立收據」畫面。比照 V11.0
 * src/components/collection/QuickPaymentScreen.tsx 的「購物籃」既有慣例：
 * 每一列可以勾選、輸入本次要開立的金額（預設＝尚可開立收據金額），選好
 * 之後選擇「合併開立」（同一筆收款交易的多筆項目開成一張收據）或
 * 「分項開立」（每一筆各自開一張收據）。
 */
export default function PendingReceiptsScreen({ initialRows }: { initialRows: PendingRow[] }) {
  const { operatorUserId, operatorUser } = useOperator();
  const [rows, setRows] = useState(initialRows);
  const [filters, setFilters] = useState({ payerName: "", transactionNo: "", sourceType: "", methodType: "" });
  const [selected, setSelected] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [noReceiptTarget, setNoReceiptTarget] = useState<PendingRow | null>(null);
  const issueIdempotencyKeyRef = useRef<string | null>(null);

  const role = operatorUser?.role ?? null;
  const canIssue = role ? canReceipt(role, "issue") : false;
  const canMarkNoReceiptRequired = role ? canReceipt(role, "markNoReceiptRequired") : false;

  async function applyFilters() {
    setLoading(true);
    setMessage(null);
    const params = new URLSearchParams();
    if (operatorUserId) params.set("operatorUserId", operatorUserId);
    if (filters.payerName) params.set("payerName", filters.payerName);
    if (filters.transactionNo) params.set("transactionNo", filters.transactionNo);
    if (filters.sourceType) params.set("sourceType", filters.sourceType);
    if (filters.methodType) params.set("methodType", filters.methodType);
    const res = await fetch(`/api/receipt-center/pending?${params.toString()}`);
    const data = await res.json();
    if (!res.ok) {
      setMessage(data.error ?? "查詢失敗");
      setLoading(false);
      return;
    }
    setRows(data.rows ?? []);
    setSelected({});
    setLoading(false);
  }

  function toggle(row: PendingRow) {
    setSelected((prev) => {
      const next = { ...prev };
      if (row.allocationId in next) {
        delete next[row.allocationId];
      } else {
        next[row.allocationId] = row.remainingAmount;
      }
      return next;
    });
    issueIdempotencyKeyRef.current = null;
  }

  function updateAmount(allocationId: string, amount: number) {
    setSelected((prev) => ({ ...prev, [allocationId]: amount }));
    issueIdempotencyKeyRef.current = null;
  }

  const selectedRows = useMemo(() => rows.filter((r) => r.allocationId in selected), [rows, selected]);
  const canMerge = selectedRows.length > 1 && new Set(selectedRows.map((r) => r.paymentTransactionId)).size === 1;
  const selectedTotal = useMemo(
    () => (Object.values(selected) as number[]).reduce((s: number, v: number) => s + (Number.isFinite(v) ? v : 0), 0),
    [selected]
  );

  function ensureIdempotencyKey() {
    if (!issueIdempotencyKeyRef.current) {
      issueIdempotencyKeyRef.current =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }
    return issueIdempotencyKeyRef.current;
  }

  async function issue(mode: "MERGED" | "SPLIT_ITEM") {
    if (!selectedRows.length) return;
    if (!operatorUserId) {
      setMessage("請先在上方選擇目前操作人員");
      return;
    }
    setSubmitting(true);
    setMessage(null);
    try {
      if (mode === "MERGED") {
        const res = await fetch("/api/receipt-center/issue", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            receiptType: "MERGED",
            operatorUserId,
            lines: selectedRows.map((r) => ({ allocationId: r.allocationId, amount: selected[r.allocationId], itemName: r.sourceLabel })),
            idempotencyKey: ensureIdempotencyKey(),
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "開立收據失敗");
        setMessage(`已開立收據 ${data.receiptNumber ?? ""}`);
      } else {
        const numbers: string[] = [];
        for (const r of selectedRows) {
          const res = await fetch("/api/receipt-center/issue", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              receiptType: "SPLIT_ITEM",
              operatorUserId,
              lines: [{ allocationId: r.allocationId, amount: selected[r.allocationId], itemName: r.sourceLabel }],
              idempotencyKey: `${ensureIdempotencyKey()}:${r.allocationId}`,
            }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error ?? "開立收據失敗");
          numbers.push(data.receiptNumber ?? "");
        }
        setMessage(`已分項開立 ${numbers.length} 張收據：${numbers.join("、")}`);
      }
      issueIdempotencyKeyRef.current = null;
      setSelected({});
      await applyFilters();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "開立收據時發生錯誤");
    } finally {
      setSubmitting(false);
    }
  }

  async function submitMarkNoReceiptRequired(reason: string) {
    if (!noReceiptTarget) return { ok: false, error: "請重新選擇項目" };
    if (!operatorUserId) return { ok: false, error: "請先在上方選擇目前操作人員" };
    const res = await fetch(`/api/receipt-center/allocations/${noReceiptTarget.allocationId}/mark-no-receipt-required`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: noReceiptTarget.remainingAmount, reason, operatorUserId }),
    });
    const data = await res.json();
    if (!res.ok) return { ok: false, error: data.error ?? "標記失敗" };
    setMessage("已標記為不需開立");
    setNoReceiptTarget(null);
    await applyFilters();
    return { ok: true };
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-white/70 p-4 shadow-soft">
        <input
          className="min-h-10 rounded-full border border-cream-200 px-3 text-sm"
          placeholder="付款人姓名"
          value={filters.payerName}
          onChange={(e) => setFilters((f) => ({ ...f, payerName: e.target.value }))}
        />
        <input
          className="min-h-10 rounded-full border border-cream-200 px-3 text-sm"
          placeholder="收款編號"
          value={filters.transactionNo}
          onChange={(e) => setFilters((f) => ({ ...f, transactionNo: e.target.value }))}
        />
        <select
          className="min-h-10 rounded-full border border-cream-200 px-3 text-sm"
          value={filters.sourceType}
          onChange={(e) => setFilters((f) => ({ ...f, sourceType: e.target.value }))}
        >
          <option value="">全部項目類型</option>
          <option value="OFFERING_CLAIM">供品認捐</option>
          <option value="UNIVERSAL_SALVATION_SPONSOR">普渡贊普</option>
          <option value="PURIFICATION_ENTRY">祭改</option>
          {/* V13.3B：寶袋（AdditionalPrintItem）已正式串接收款 */}
          <option value="ADDITIONAL_PRINT_ITEM">寶袋</option>
          <option value="MANUAL">其他臨時應收項目</option>
        </select>
        <select
          className="min-h-10 rounded-full border border-cream-200 px-3 text-sm"
          value={filters.methodType}
          onChange={(e) => setFilters((f) => ({ ...f, methodType: e.target.value }))}
        >
          <option value="">全部付款方式</option>
          <option value="CASH">現金</option>
          <option value="BANK_TRANSFER">銀行轉帳</option>
          <option value="MOBILE_PAYMENT">行動支付</option>
          <option value="CHECK">支票</option>
          <option value="OTHER">其他</option>
        </select>
        <button onClick={applyFilters} className="min-h-10 rounded-full bg-sage-100 px-4 text-sm text-ink-soft hover:bg-sage-200">
          搜尋
        </button>
      </div>

      {message && <p className="rounded-2xl bg-mist-100 px-4 py-3 text-sm text-ink">{message}</p>}
      {loading && <p className="text-sm text-ink-faint">載入中…</p>}

      <div className="overflow-x-auto rounded-2xl bg-white/70 shadow-card">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-cream-200 text-xs text-ink-faint">
              <th className="px-4 py-3">選取</th>
              <th className="px-4 py-3">收款編號</th>
              <th className="px-4 py-3">收款日期</th>
              <th className="px-4 py-3">付款人</th>
              <th className="px-4 py-3">項目</th>
              <th className="px-4 py-3">收款總額</th>
              <th className="px-4 py-3">已開收據</th>
              <th className="px-4 py-3">尚可開立</th>
              <th className="px-4 py-3">本次開立金額</th>
              <th className="px-4 py-3">付款方式</th>
              <th className="px-4 py-3">經手人</th>
              <th className="px-4 py-3">操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.allocationId} className="border-b border-cream-100">
                <td className="px-4 py-3">
                  <input type="checkbox" checked={r.allocationId in selected} onChange={() => toggle(r)} />
                </td>
                <td className="px-4 py-3">
                  <Link href={`/collection-center/payments/${r.paymentTransactionId}`} className="hover:underline">
                    {r.transactionNo}
                  </Link>
                  {r.isAgentCollected && <p className="text-xs text-ink-faint">代收</p>}
                </td>
                <td className="px-4 py-3">{new Date(r.paidOn).toLocaleDateString("zh-Hant")}</td>
                <td className="px-4 py-3">{r.payerName}</td>
                <td className="px-4 py-3">
                  <p>{r.sourceLabel}</p>
                  <p className="text-xs text-ink-faint">{receivableSourceTypeLabel[r.sourceType] ?? r.sourceType}</p>
                </td>
                <td className="px-4 py-3">{r.allocationAmount.toLocaleString("zh-Hant")}</td>
                <td className="px-4 py-3">{r.receiptedAmount.toLocaleString("zh-Hant")}</td>
                <td className="px-4 py-3">{r.remainingAmount.toLocaleString("zh-Hant")}</td>
                <td className="px-4 py-3">
                  <input
                    type="number"
                    className="w-24 rounded-full border border-cream-200 px-2 py-1 text-sm"
                    disabled={!(r.allocationId in selected)}
                    value={selected[r.allocationId] ?? r.remainingAmount}
                    max={r.remainingAmount}
                    min={0}
                    onChange={(e) => updateAmount(r.allocationId, Number(e.target.value))}
                  />
                </td>
                <td className="px-4 py-3">{paymentMethodTypeLabel[r.methodType] ?? r.methodType}</td>
                <td className="px-4 py-3">{r.collectedByName ?? "－"}</td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => setNoReceiptTarget(r)}
                    disabled={!canMarkNoReceiptRequired}
                    title={!canMarkNoReceiptRequired ? "目前操作人員沒有標記「不需開立」的權限" : undefined}
                    className="text-xs text-ink-faint underline-offset-4 hover:underline disabled:opacity-40 disabled:no-underline"
                  >
                    標記不需開立
                  </button>
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={12} className="px-4 py-6 text-center text-ink-faint">
                  目前沒有待開立收據
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {selectedRows.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-yolk-100 p-4 shadow-soft">
          <p className="text-sm text-ink">
            已選 {selectedRows.length} 筆，本次開立總額 {selectedTotal.toLocaleString("zh-Hant")} 元
          </p>
          <div className="flex gap-2">
            <button
              disabled={!canMerge || submitting || !canIssue}
              onClick={() => issue("MERGED")}
              className="min-h-10 rounded-full bg-sage-200 px-4 text-sm text-ink disabled:opacity-40"
              title={!canIssue ? "目前操作人員沒有開立收據的權限" : !canMerge ? "合併開立僅適用於同一筆收款交易的多筆項目" : undefined}
            >
              合併開立一張收據
            </button>
            <button
              disabled={submitting || !canIssue}
              onClick={() => issue("SPLIT_ITEM")}
              title={!canIssue ? "目前操作人員沒有開立收據的權限" : undefined}
              className="min-h-10 rounded-full bg-blossom-200 px-4 text-sm text-ink disabled:opacity-40"
            >
              分項開立（各自一張）
            </button>
          </div>
        </div>
      )}

      {noReceiptTarget && (
        <ReasonDialog
          title="標記不需開立"
          label={`標記「${noReceiptTarget.sourceLabel}」尚可開立金額 ${noReceiptTarget.remainingAmount.toLocaleString("zh-Hant")} 元為不需開立，請輸入原因（必填）`}
          confirmLabel="確認標記"
          onCancel={() => setNoReceiptTarget(null)}
          onSubmit={submitMarkNoReceiptRequired}
        />
      )}
    </div>
  );
}
