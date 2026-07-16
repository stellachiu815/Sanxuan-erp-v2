"use client";

import { useState } from "react";
import Link from "next/link";
import { receiptStatusLabel, receiptStatusColor, receiptPrintKindLabel, receiptTypeLabel } from "@/lib/labels";
import { useOperator } from "@/lib/operatorClient";
import { canReceipt } from "@/lib/permissions";
import ReceiptVoidReissueDialog, { type VoidReissueSubmitInput } from "@/components/receipt/ReceiptVoidReissueDialog";
import ReasonDialog from "@/components/system/ReasonDialog";

type ReceiptDetailView = {
  id: string;
  receiptNumber: string | null;
  receiptDate: string;
  receiptTime: string;
  payerName: string;
  totalAmount: number;
  receiptType: string;
  status: string;
  printCount: number;
  note: string | null;
  voidReason: string | null;
  voidedAt: string | null;
  voidedByName: string | null;
  approvedByName: string | null;
  createdByName: string | null;
  originalReceiptId: string | null;
  replacedByReceiptId: string | null;
  paymentTransactionId: string;
  transactionNo: string;
  lines: { id: string; itemName: string; amount: number; sourceType: string; sourceId: string }[];
  printLogs: { id: string; kind: string; printedAt: string; printedByName: string | null; reason: string | null; deviceInfo: string | null }[];
};

/**
 * 收據詳細頁：列印/補印/作廢/換開都在這個頁面操作（比照 V11.0
 * PaymentTransactionDetailScreen「退款/轉款/作廢都在收款詳細頁操作」的
 * 既有慣例，不獨立成分頁）。
 */
export default function ReceiptDetailScreen({ receipt }: { receipt: ReceiptDetailView }) {
  const { operatorUserId, operatorUser } = useOperator();
  const [current, setCurrent] = useState(receipt);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<"void" | "reissue" | "revoke" | null>(null);

  const [printLogs, setPrintLogs] = useState(receipt.printLogs);

  const role = operatorUser?.role ?? null;
  const canPrint = role ? canReceipt(role, current.printCount > 0 ? "reprint" : "print") : false;
  const canVoid = role ? canReceipt(role, "void") : false;
  const canReissue = role ? canReceipt(role, "reissue") : false;
  const canRevoke = role ? canReceipt(role, "markNoReceiptRequired") : false;

  async function refresh() {
    const res = await fetch(`/api/receipt-center/receipts/${receipt.id}?operatorUserId=${operatorUserId ?? ""}`);
    if (!res.ok) return;
    const data = await res.json();
    setCurrent((prev) => ({
      ...prev,
      status: data.status,
      printCount: data.printCount,
      note: data.note,
      voidReason: data.voidReason,
      voidedAt: data.voidedAt,
      voidedByName: data.voidedByName,
      approvedByName: data.approvedByName,
    }));
    setPrintLogs(
      (data.printLogs ?? []).map((p: { id: string; kind: string; printedAt: string; printedByName: string | null; reason: string | null; deviceInfo: string | null }) => ({
        id: p.id,
        kind: p.kind,
        printedAt: p.printedAt,
        printedByName: p.printedByName,
        reason: p.reason,
        deviceInfo: p.deviceInfo,
      }))
    );
  }

  async function print() {
    if (!operatorUserId) {
      setMessage("請先在上方選擇目前操作人員");
      return;
    }
    let reason: string | undefined;
    if (current.printCount > 0) {
      reason = window.prompt("這是補印，請輸入補印原因：") ?? "";
      if (!reason) {
        setMessage("補印必須填寫原因");
        return;
      }
    }
    setBusy(true);
    const res = await fetch(`/api/receipt-center/receipts/${receipt.id}/print`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operatorUserId, reason }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setMessage(data.error ?? "列印失敗");
      return;
    }
    setMessage(data.kind === "REPRINT" ? "已記錄補印，開啟列印預覽頁" : "已記錄正式列印，開啟列印預覽頁");
    window.open(`/receipt-center/receipts/${receipt.id}/print`, "_blank");
    await refresh();
  }

  async function submitVoid(input: VoidReissueSubmitInput) {
    if (!operatorUserId) return { ok: false, error: "請先在上方選擇目前操作人員" };
    setBusy(true);
    const res = await fetch(`/api/receipt-center/receipts/${receipt.id}/void`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reason: input.reason,
        operatorUserId,
        approverUserId: input.approverUserId,
        isEmergencyOverride: input.isEmergencyOverride,
        emergencyReason: input.emergencyReason,
      }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) return { ok: false, error: data.error ?? "作廢失敗" };
    setMessage("已作廢");
    setDialog(null);
    await refresh();
    return { ok: true };
  }

  async function submitReissue(input: VoidReissueSubmitInput) {
    if (!operatorUserId) return { ok: false, error: "請先在上方選擇目前操作人員" };
    setBusy(true);
    const res = await fetch(`/api/receipt-center/receipts/${receipt.id}/reissue`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reason: input.reason,
        operatorUserId,
        approverUserId: input.approverUserId,
        isEmergencyOverride: input.isEmergencyOverride,
        emergencyReason: input.emergencyReason,
        payerName: input.payerName,
      }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) return { ok: false, error: data.error ?? "換開失敗" };
    setDialog(null);
    window.location.href = `/receipt-center/receipts/${data.id}`;
    return { ok: true };
  }

  async function submitRevoke(reason: string) {
    if (!operatorUserId) return { ok: false, error: "請先在上方選擇目前操作人員" };
    setBusy(true);
    const res = await fetch(`/api/receipt-center/receipts/${receipt.id}/revoke-no-receipt-required`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason, operatorUserId }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) return { ok: false, error: data.error ?? "撤銷失敗" };
    setMessage("已撤銷「不需開立」標記，這筆收款重新回到待開立收據");
    setDialog(null);
    await refresh();
    return { ok: true };
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-3xl bg-white/70 p-6 shadow-card">
        <div className="flex items-center justify-between">
          <h2 className="text-lg text-ink">{current.receiptNumber ?? "（不需開立，無收據號碼）"}</h2>
          <span className={`rounded-full px-3 py-1 text-xs ${receiptStatusColor[current.status] ?? ""}`}>
            {receiptStatusLabel[current.status] ?? current.status}
          </span>
        </div>
        <p className="mt-2 text-sm text-ink-soft">
          {new Date(current.receiptDate).toLocaleDateString("zh-Hant")}・{current.payerName}・
          {receiptTypeLabel[current.receiptType] ?? current.receiptType}
        </p>
        <p className="mt-1 text-2xl text-ink">{current.totalAmount.toLocaleString("zh-Hant")} 元</p>
        <p className="mt-2 text-xs text-ink-faint">
          對應收款：
          <Link href={`/collection-center/payments/${current.paymentTransactionId}`} className="hover:underline">
            {current.transactionNo}
          </Link>
        </p>
        {current.createdByName && <p className="text-xs text-ink-faint">開立人：{current.createdByName}</p>}
      </div>

      <div className="rounded-3xl bg-white/70 p-6 shadow-card">
        <h3 className="text-sm text-ink">收據明細</h3>
        <table className="mt-3 w-full text-left text-sm">
          <tbody>
            {current.lines.map((l) => (
              <tr key={l.id} className="border-b border-cream-100">
                <td className="py-2">{l.itemName}</td>
                <td className="py-2 text-right">{l.amount.toLocaleString("zh-Hant")} 元</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {message && <p className="rounded-2xl bg-mist-100 px-4 py-3 text-sm text-ink">{message}</p>}

      <div className="flex flex-wrap gap-2">
        <button
          disabled={busy || current.status === "VOIDED" || !canPrint}
          onClick={print}
          title={!canPrint ? "目前操作人員沒有列印權限" : undefined}
          className="min-h-10 rounded-full bg-sage-100 px-4 text-sm text-ink-soft disabled:opacity-40"
        >
          {current.printCount > 0 ? "補印" : "正式列印"}
        </button>
        <button
          disabled={busy || current.status === "VOIDED" || current.status === "REPLACED" || !canVoid}
          onClick={() => setDialog("void")}
          title={!canVoid ? "目前操作人員沒有作廢權限" : undefined}
          className="min-h-10 rounded-full bg-blossom-100 px-4 text-sm text-ink-soft disabled:opacity-40"
        >
          作廢收據
        </button>
        <button
          disabled={busy || current.status === "VOIDED" || current.status === "REPLACED" || !canReissue}
          onClick={() => setDialog("reissue")}
          title={!canReissue ? "目前操作人員沒有換開權限" : undefined}
          className="min-h-10 rounded-full bg-yolk-100 px-4 text-sm text-ink-soft disabled:opacity-40"
        >
          換開收據
        </button>
        {current.status === "NO_RECEIPT_REQUIRED" && (
          <button
            disabled={busy || !canRevoke}
            onClick={() => setDialog("revoke")}
            title={!canRevoke ? "目前操作人員沒有撤銷「不需開立」的權限" : undefined}
            className="min-h-10 rounded-full bg-mist-100 px-4 text-sm text-ink-soft disabled:opacity-40"
          >
            撤銷「不需開立」
          </button>
        )}
      </div>

      {current.status === "VOIDED" && (
        <div className="rounded-2xl bg-cream-100 p-4 text-sm text-ink-faint">
          <p>作廢原因：{current.voidReason}</p>
          <p>作廢時間：{current.voidedAt ? new Date(current.voidedAt).toLocaleString("zh-Hant") : "－"}</p>
          <p>核准人：{current.approvedByName ?? "－"}</p>
        </div>
      )}

      {current.status === "NO_RECEIPT_REQUIRED" && (
        <div className="rounded-2xl bg-cream-100 p-4 text-sm text-ink-faint">
          <p>不需開立原因：{current.note ?? "－"}</p>
        </div>
      )}

      {dialog === "void" && (
        <ReceiptVoidReissueDialog title="作廢收據" actionLabel="確認作廢" onCancel={() => setDialog(null)} onSubmit={submitVoid} />
      )}
      {dialog === "reissue" && (
        <ReceiptVoidReissueDialog
          title="換開收據"
          actionLabel="確認換開"
          showPayerName
          onCancel={() => setDialog(null)}
          onSubmit={submitReissue}
        />
      )}
      {dialog === "revoke" && (
        <ReasonDialog
          title="撤銷「不需開立」"
          label="撤銷原因（必填）"
          confirmLabel="確認撤銷"
          onCancel={() => setDialog(null)}
          onSubmit={submitRevoke}
        />
      )}

      {current.originalReceiptId && (
        <p className="text-xs text-ink-faint">
          此收據由
          <Link href={`/receipt-center/receipts/${current.originalReceiptId}`} className="mx-1 hover:underline">
            舊收據
          </Link>
          換開而來。
        </p>
      )}
      {receipt.replacedByReceiptId && (
        <p className="text-xs text-ink-faint">
          這張收據已被
          <Link href={`/receipt-center/receipts/${receipt.replacedByReceiptId}`} className="mx-1 hover:underline">
            新收據
          </Link>
          換開取代。
        </p>
      )}

      <div className="rounded-3xl bg-white/70 p-6 shadow-card">
        <h3 className="text-sm text-ink">列印紀錄</h3>
        <table className="mt-3 w-full text-left text-xs text-ink-faint">
          <thead>
            <tr className="border-b border-cream-200">
              <th className="py-2">種類</th>
              <th className="py-2">時間</th>
              <th className="py-2">人員</th>
              <th className="py-2">原因</th>
            </tr>
          </thead>
          <tbody>
            {printLogs.map((p) => (
              <tr key={p.id} className="border-b border-cream-100">
                <td className="py-2">{receiptPrintKindLabel[p.kind] ?? p.kind}</td>
                <td className="py-2">{new Date(p.printedAt).toLocaleString("zh-Hant")}</td>
                <td className="py-2">{p.printedByName ?? "－"}</td>
                <td className="py-2">{p.reason ?? "－"}</td>
              </tr>
            ))}
            {!printLogs.length && (
              <tr>
                <td colSpan={4} className="py-4 text-center">
                  尚未列印過
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
