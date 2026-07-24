"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  paymentMethodTypeLabel,
  paymentTransactionStatusLabel,
  agentRemittanceStatusLabel,
  paymentAdjustmentTypeLabel,
} from "@/lib/labels";
import { useCurrentUser } from "@/lib/permissionClient";
import { canCollection } from "@/lib/permissions";

type Allocation = {
  id: string;
  sourceType: string;
  sourceId: string;
  sourceLabel: string;
  sourceYear: number | null;
  amount: number;
};

type Adjustment = { id: string; adjustmentType: string; amount: number; reason: string; createdAt: string };

type TransactionView = {
  id: string;
  transactionNo: string;
  paidOn: string;
  totalAmount: number;
  methodType: string;
  payerNameSnapshot: string;
  isAgentCollected: boolean;
  agentName: string | null;
  agentRemittanceStatus: string | null;
  status: string;
  voidReason: string | null;
  note: string | null;
  allocations: Allocation[];
  adjustments: Adjustment[];
};

/**
 * V11.0 需求「退款/轉款」四選項：這裡提供分配層級的「退款／轉款到其他
 * 應收項目／保留為溢收」，以及整筆交易層級的「作廢」。已完成的收款
 * 不提供直接編輯／刪除，只能透過這裡的調整流程處理。
 */
export default function PaymentTransactionDetailScreen({ transaction }: { transaction: TransactionView }) {
  const router = useRouter();
  // V14.3：退款／轉款屬 refund、作廢屬 voidPayment（皆 SUPER_ADMIN／ADMIN）。
  // STAFF 可查看收款明細但不顯示退款／作廢入口；READONLY 亦然。API 為最終防線。
  const { role } = useCurrentUser();
  const canRefund = role ? canCollection(role, "refund") : false;
  const canVoid = role ? canCollection(role, "voidPayment") : false;
  const [activeAllocationId, setActiveAllocationId] = useState<string | null>(null);
  const [adjustmentType, setAdjustmentType] = useState<"REFUND" | "TRANSFER_TO_OTHER" | "RETAIN_AS_OVERPAYMENT">("REFUND");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [approvedByName, setApprovedByName] = useState("");
  const [operatorName, setOperatorName] = useState("");
  const [targetSourceType, setTargetSourceType] = useState("OFFERING_CLAIM");
  const [targetSourceId, setTargetSourceId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [showVoid, setShowVoid] = useState(false);
  const [voidReason, setVoidReason] = useState("");
  const [voidApprovedBy, setVoidApprovedBy] = useState("");

  async function submitAdjustment() {
    if (!activeAllocationId) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/collection-center/allocations/${activeAllocationId}/adjustments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          adjustmentType,
          amount: Number(amount),
          reason,
          operatorName: operatorName || null,
          approvedByName: approvedByName || null,
          targetSourceType: adjustmentType === "TRANSFER_TO_OTHER" ? targetSourceType : undefined,
          targetSourceId: adjustmentType === "TRANSFER_TO_OTHER" ? targetSourceId : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "處理失敗");
        return;
      }
      setActiveAllocationId(null);
      setAmount("");
      setReason("");
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  async function submitVoid() {
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/collection-center/payments/${transaction.id}/void`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: voidReason, approvedByName: voidApprovedBy }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "作廢失敗");
        return;
      }
      setShowVoid(false);
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {error && <div className="rounded-2xl bg-blossom-100 p-4 text-sm text-ink">{error}</div>}

      <section className="rounded-3xl bg-white/70 p-6 shadow-card">
        <div className="flex items-center justify-between">
          <p className="text-base text-ink">{transaction.transactionNo}</p>
          <span className="rounded-full bg-cream-200 px-3 py-1 text-xs text-ink-soft">
            {paymentTransactionStatusLabel[transaction.status] ?? transaction.status}
          </span>
        </div>
        <p className="mt-2 text-sm text-ink-soft">
          {transaction.paidOn}・{transaction.payerNameSnapshot}・{paymentMethodTypeLabel[transaction.methodType] ?? transaction.methodType}
        </p>
        <p className="mt-1 text-lg text-ink">{transaction.totalAmount.toLocaleString("zh-Hant")} 元</p>
        {transaction.isAgentCollected && (
          <p className="mt-1 text-xs text-ink-faint">
            代收人：{transaction.agentName}・{agentRemittanceStatusLabel[transaction.agentRemittanceStatus ?? ""] ?? ""}
          </p>
        )}
        {transaction.status === "VOIDED" && <p className="mt-2 text-xs text-blossom-300">已作廢：{transaction.voidReason}</p>}
      </section>

      <section className="rounded-3xl bg-white/70 p-6 shadow-card">
        <h2 className="text-sm text-ink-soft">分配明細</h2>
        <div className="mt-3 flex flex-col gap-2">
          {transaction.allocations.map((a) => (
            <div key={a.id} className="rounded-xl bg-cream-50 px-4 py-3">
              <div className="flex items-center justify-between">
                <p className="text-sm text-ink">{a.sourceLabel}</p>
                <p className="text-sm text-ink">{a.amount.toLocaleString("zh-Hant")} 元</p>
              </div>
              {transaction.status === "COMPLETED" && canRefund && (
                <button
                  onClick={() => {
                    setActiveAllocationId(a.id);
                    setAmount(String(a.amount));
                  }}
                  className="mt-2 text-xs text-ink-faint underline-offset-4 hover:underline"
                >
                  退款／轉款／保留溢收 →
                </button>
              )}
              {activeAllocationId === a.id && (
                <div className="mt-3 flex flex-col gap-2 rounded-lg bg-white/80 p-3">
                  <select value={adjustmentType} onChange={(e) => setAdjustmentType(e.target.value as never)} className="rounded-lg border border-cream-200 px-2 py-1 text-sm">
                    <option value="REFUND">{paymentAdjustmentTypeLabel.REFUND}</option>
                    <option value="TRANSFER_TO_OTHER">{paymentAdjustmentTypeLabel.TRANSFER_TO_OTHER}</option>
                    <option value="RETAIN_AS_OVERPAYMENT">{paymentAdjustmentTypeLabel.RETAIN_AS_OVERPAYMENT}</option>
                  </select>
                  <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="金額" className="rounded-lg border border-cream-200 px-2 py-1 text-sm" />
                  <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="原因（必填）" className="rounded-lg border border-cream-200 px-2 py-1 text-sm" />
                  {adjustmentType === "TRANSFER_TO_OTHER" && (
                    <input value={targetSourceId} onChange={(e) => setTargetSourceId(e.target.value)} placeholder="目標供品認捐 id" className="rounded-lg border border-cream-200 px-2 py-1 text-sm" />
                  )}
                  {adjustmentType !== "RETAIN_AS_OVERPAYMENT" && (
                    <input value={approvedByName} onChange={(e) => setApprovedByName(e.target.value)} placeholder="核准人（必填）" className="rounded-lg border border-cream-200 px-2 py-1 text-sm" />
                  )}
                  <input value={operatorName} onChange={(e) => setOperatorName(e.target.value)} placeholder="操作人" className="rounded-lg border border-cream-200 px-2 py-1 text-sm" />
                  <div className="flex gap-2">
                    <button disabled={submitting} onClick={submitAdjustment} className="rounded-full bg-sage-200 px-4 py-2 text-xs text-ink hover:bg-sage-300">
                      送出
                    </button>
                    <button onClick={() => setActiveAllocationId(null)} className="rounded-full bg-cream-200 px-4 py-2 text-xs text-ink-soft">
                      取消
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {!!transaction.adjustments.length && (
        <section className="rounded-3xl bg-white/70 p-6 shadow-card">
          <h2 className="text-sm text-ink-soft">調整紀錄</h2>
          <div className="mt-3 flex flex-col gap-2 text-sm">
            {transaction.adjustments.map((a) => (
              <p key={a.id} className="text-ink-soft">
                {paymentAdjustmentTypeLabel[a.adjustmentType] ?? a.adjustmentType}：{a.amount.toLocaleString("zh-Hant")} 元・{a.reason}
              </p>
            ))}
          </div>
        </section>
      )}

      {transaction.status === "COMPLETED" && canVoid && (
        <section className="rounded-3xl bg-white/70 p-6 shadow-card">
          {!showVoid ? (
            <button onClick={() => setShowVoid(true)} className="text-xs text-ink-faint underline-offset-4 hover:underline">
              整筆收款登錄錯誤？作廢整筆收款 →
            </button>
          ) : (
            <div className="flex flex-col gap-2">
              <input value={voidReason} onChange={(e) => setVoidReason(e.target.value)} placeholder="作廢原因（必填）" className="rounded-lg border border-cream-200 px-2 py-1 text-sm" />
              <input value={voidApprovedBy} onChange={(e) => setVoidApprovedBy(e.target.value)} placeholder="核准人（必填）" className="rounded-lg border border-cream-200 px-2 py-1 text-sm" />
              <div className="flex gap-2">
                <button disabled={submitting} onClick={submitVoid} className="rounded-full bg-blossom-200 px-4 py-2 text-xs text-ink hover:bg-blossom-300">
                  確認作廢
                </button>
                <button onClick={() => setShowVoid(false)} className="rounded-full bg-cream-200 px-4 py-2 text-xs text-ink-soft">
                  取消
                </button>
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
