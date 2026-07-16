"use client";

import { useState } from "react";
import Link from "next/link";
import { receiptStatusLabel, receiptStatusColor } from "@/lib/labels";
import { useOperator } from "@/lib/operatorClient";

type ReceiptRow = {
  id: string;
  receiptNumber: string | null;
  receiptDate: string;
  payerName: string;
  totalAmount: number;
  status: string;
  printCount: number;
  reprintCount: number;
  transactionNo: string;
  itemSummary: string;
  createdByName: string | null;
};

/**
 * 需求「已開立收據」＋「收據查詢」共用畫面（兩個需求分頁本質是同一份
 * 查詢，見 src/app/receipt-center/page.tsx 上方畫面整合說明）。
 */
export default function ReceiptListScreen({ initialRows }: { initialRows: ReceiptRow[] }) {
  const { operatorUserId } = useOperator();
  const [rows, setRows] = useState(initialRows);
  const [filters, setFilters] = useState({ receiptNumber: "", payerName: "", transactionNo: "", status: "" });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function search() {
    setLoading(true);
    setMessage(null);
    const params = new URLSearchParams();
    if (operatorUserId) params.set("operatorUserId", operatorUserId);
    if (filters.receiptNumber) params.set("receiptNumber", filters.receiptNumber);
    if (filters.payerName) params.set("payerName", filters.payerName);
    if (filters.transactionNo) params.set("transactionNo", filters.transactionNo);
    if (filters.status) params.set("status", filters.status);
    const res = await fetch(`/api/receipt-center/receipts?${params.toString()}`);
    const data = await res.json();
    if (!res.ok) {
      setMessage(data.error ?? "查詢失敗");
      setLoading(false);
      return;
    }
    setRows(
      (data.rows ?? []).map((r: { id: string; receiptNumber: string | null; receiptDate: string; payerName: string; totalAmount: string | number; status: string; printCount: number; printLogs: { kind: string }[]; paymentTransaction: { transactionNo: string }; lines: { itemName: string }[]; createdByName: string | null }) => ({
        id: r.id,
        receiptNumber: r.receiptNumber,
        receiptDate: r.receiptDate,
        payerName: r.payerName,
        totalAmount: Number(r.totalAmount),
        status: r.status,
        printCount: r.printCount,
        reprintCount: r.printLogs.filter((p) => p.kind === "REPRINT").length,
        transactionNo: r.paymentTransaction.transactionNo,
        itemSummary: r.lines.map((l) => l.itemName).join("、"),
        createdByName: r.createdByName,
      }))
    );
    setLoading(false);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-white/70 p-4 shadow-soft">
        <input
          className="min-h-10 rounded-full border border-cream-200 px-3 text-sm"
          placeholder="收據號碼"
          value={filters.receiptNumber}
          onChange={(e) => setFilters((f) => ({ ...f, receiptNumber: e.target.value }))}
        />
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
          value={filters.status}
          onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}
        >
          <option value="">全部狀態</option>
          <option value="ISSUED">已開立</option>
          <option value="VOIDED">已作廢</option>
          <option value="REPLACED">已換開</option>
          <option value="NO_RECEIPT_REQUIRED">不需開立</option>
        </select>
        <button onClick={search} className="min-h-10 rounded-full bg-sage-100 px-4 text-sm text-ink-soft hover:bg-sage-200">
          搜尋
        </button>
      </div>

      {message && <p className="rounded-2xl bg-mist-100 px-4 py-3 text-sm text-ink">{message}</p>}
      {loading && <p className="text-sm text-ink-faint">載入中…</p>}

      <div className="overflow-x-auto rounded-2xl bg-white/70 shadow-card">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-cream-200 text-xs text-ink-faint">
              <th className="px-4 py-3">收據號碼</th>
              <th className="px-4 py-3">日期</th>
              <th className="px-4 py-3">付款人</th>
              <th className="px-4 py-3">項目摘要</th>
              <th className="px-4 py-3">金額</th>
              <th className="px-4 py-3">收款編號</th>
              <th className="px-4 py-3">經手人</th>
              <th className="px-4 py-3">狀態</th>
              <th className="px-4 py-3">補印次數</th>
              <th className="px-4 py-3">操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-cream-100">
                <td className="px-4 py-3">{r.receiptNumber ?? "－"}</td>
                <td className="px-4 py-3">{new Date(r.receiptDate).toLocaleDateString("zh-Hant")}</td>
                <td className="px-4 py-3">{r.payerName}</td>
                <td className="px-4 py-3">{r.itemSummary}</td>
                <td className="px-4 py-3">{r.totalAmount.toLocaleString("zh-Hant")}</td>
                <td className="px-4 py-3">
                  <Link href={`/collection-center/payments`} className="hover:underline">
                    {r.transactionNo}
                  </Link>
                </td>
                <td className="px-4 py-3">{r.createdByName ?? "－"}</td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-1 text-xs ${receiptStatusColor[r.status] ?? ""}`}>
                    {receiptStatusLabel[r.status] ?? r.status}
                  </span>
                </td>
                <td className="px-4 py-3">{r.reprintCount}</td>
                <td className="px-4 py-3">
                  <Link href={`/receipt-center/receipts/${r.id}`} className="text-xs text-ink-faint underline-offset-4 hover:underline">
                    查看詳細
                  </Link>
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={10} className="px-4 py-6 text-center text-ink-faint">
                  沒有符合條件的收據
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
