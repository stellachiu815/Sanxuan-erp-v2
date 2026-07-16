"use client";

import { useRef, useState } from "react";
import { amountToChineseCapital } from "@/lib/receiptRules";
import { paymentMethodTypeLabel } from "@/lib/labels";
import { exportSheetsToPdf } from "@/components/ritual/pdfExport";

type ReceiptPrintData = {
  receiptNumber: string;
  receiptDate: string;
  payerName: string;
  totalAmount: number;
  lines: { itemName: string; amount: number }[];
  methodType: string;
  collectedByName: string | null;
  note: string | null;
  isReprint: boolean;
};

/**
 * 需求「八、收據版型」正式標準版型——先只提供一款正式、清楚、簡單的版面，
 * 不做花俏樣式。字體特意放大（見下方 text-base/text-lg 為主，不使用
 * text-xs），避免列印出來太小看不清楚。
 */
export default function ReceiptPrintView({ receipt }: { receipt: ReceiptPrintData }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pdfGenerating, setPdfGenerating] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);

  async function downloadPdf() {
    if (!containerRef.current) return;
    setPdfError(null);
    setPdfGenerating(true);
    try {
      await exportSheetsToPdf(containerRef.current, `三玄宮收據_${receipt.receiptNumber}.pdf`);
    } catch {
      setPdfError("PDF 產生失敗，請重新整理頁面再試一次。");
    } finally {
      setPdfGenerating(false);
    }
  }

  return (
    <div className="min-h-screen bg-cream-50 py-10">
      <style>{`@page { size: A4; margin: 0; }`}</style>

      <div className="mx-auto mb-6 flex max-w-2xl items-center justify-between px-6 print:hidden">
        <p className="text-sm text-ink-soft">收據列印預覽</p>
        <div className="flex gap-2">
          <button onClick={() => window.print()} className="min-h-10 rounded-full bg-sage-100 px-4 text-sm text-ink-soft hover:bg-sage-200">
            🖨️ 列印
          </button>
          <button
            disabled={pdfGenerating}
            onClick={downloadPdf}
            className="min-h-10 rounded-full bg-mist-100 px-4 text-sm text-ink-soft hover:bg-mist-200 disabled:opacity-50"
          >
            {pdfGenerating ? "產生中…" : "⬇️ 下載 PDF"}
          </button>
        </div>
      </div>
      {pdfError && (
        <p className="mx-auto mb-4 max-w-2xl rounded-xl bg-blossom-50 px-6 py-2.5 text-sm text-ink-soft print:hidden">
          {pdfError}
        </p>
      )}

      <div
        ref={containerRef}
        className="print-sheet relative mx-auto bg-white p-12 shadow-card print:shadow-none"
        style={{ width: "210mm", minHeight: "148mm", boxSizing: "border-box" }}
      >
        {receipt.isReprint && (
          <div className="pointer-events-none absolute right-12 top-12 rotate-12 rounded-lg border-4 border-blossom-300 px-4 py-1 text-2xl font-bold text-blossom-300">
            補印
          </div>
        )}

        <div className="flex items-start justify-between border-b-2 border-ink pb-4">
          <div>
            <h1 className="text-2xl text-ink">台北三玄宮</h1>
            <p className="mt-1 text-lg text-ink-soft">收據</p>
          </div>
          <div className="text-right text-base text-ink-soft">
            <p>收據號碼：{receipt.receiptNumber}</p>
            <p>日期：{new Date(receipt.receiptDate).toLocaleDateString("zh-Hant")}</p>
          </div>
        </div>

        <div className="mt-6 flex items-center justify-between text-lg text-ink">
          <p>玆收到　{receipt.payerName}　先生／女士 繳納：</p>
        </div>

        <table className="mt-4 w-full text-left text-base">
          <thead>
            <tr className="border-b border-ink-faint text-ink-soft">
              <th className="py-2">收款項目</th>
              <th className="py-2 text-right">金額（新台幣）</th>
            </tr>
          </thead>
          <tbody>
            {receipt.lines.map((l, i) => (
              <tr key={i} className="border-b border-cream-200">
                <td className="py-2">{l.itemName}</td>
                <td className="py-2 text-right">{l.amount.toLocaleString("zh-Hant")} 元</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td className="pt-3 text-lg text-ink">合計</td>
              <td className="pt-3 text-right text-lg text-ink">{receipt.totalAmount.toLocaleString("zh-Hant")} 元</td>
            </tr>
          </tfoot>
        </table>

        <p className="mt-4 text-base text-ink">金額大寫：{amountToChineseCapital(receipt.totalAmount)}</p>

        <div className="mt-6 flex items-center justify-between text-base text-ink-soft">
          <p>付款方式：{paymentMethodTypeLabel[receipt.methodType] ?? receipt.methodType}</p>
          <p>經手人：{receipt.collectedByName ?? "－"}</p>
        </div>

        {receipt.note && <p className="mt-2 text-sm text-ink-faint">備註：{receipt.note}</p>}

        <div className="mt-10 flex items-end justify-between">
          <p className="text-sm text-ink-faint">台北三玄宮 敬致</p>
          <div className="flex h-24 w-24 items-center justify-center rounded-lg border-2 border-dashed border-ink-faint text-xs text-ink-faint">
            宮方蓋章
          </div>
        </div>
      </div>
    </div>
  );
}
