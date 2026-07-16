import Link from "next/link";
import { notFound } from "next/navigation";
import { getReceiptDetail } from "@/lib/receipt";
import ReceiptDetailScreen from "@/components/receipt/ReceiptDetailScreen";
import { OperatorProvider } from "@/lib/operatorClient";
import OperatorBar from "@/components/system/OperatorBar";

export default async function ReceiptDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const receipt = await getReceiptDetail(id);
  if (!receipt) notFound();

  const view = {
    id: receipt.id,
    receiptNumber: receipt.receiptNumber,
    receiptDate: receipt.receiptDate.toISOString(),
    receiptTime: receipt.receiptTime.toISOString(),
    payerName: receipt.payerName,
    totalAmount: Number(receipt.totalAmount),
    receiptType: receipt.receiptType,
    status: receipt.status,
    printCount: receipt.printCount,
    note: receipt.note,
    voidReason: receipt.voidReason,
    voidedAt: receipt.voidedAt?.toISOString() ?? null,
    voidedByName: receipt.voidedByName,
    approvedByName: receipt.approvedByName,
    createdByName: receipt.createdByName,
    originalReceiptId: receipt.originalReceiptId,
    replacedByReceiptId: receipt.replacedByReceipts[0]?.id ?? null,
    paymentTransactionId: receipt.paymentTransactionId,
    transactionNo: receipt.paymentTransaction.transactionNo,
    lines: receipt.lines.map((l) => ({
      id: l.id,
      itemName: l.itemName,
      amount: Number(l.amount),
      sourceType: l.sourceType,
      sourceId: l.sourceId,
    })),
    printLogs: receipt.printLogs.map((p) => ({
      id: p.id,
      kind: p.kind,
      printedAt: p.printedAt.toISOString(),
      printedByName: p.printedByName,
      reason: p.reason,
      deviceInfo: p.deviceInfo,
    })),
  };

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-cream-200 bg-cream-50/90 px-6 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4">
          <Link href="/receipt-center/receipts" className="text-sm text-ink-soft hover:underline">
            ← 收據查詢
          </Link>
          <h1 className="text-sm text-ink-soft">收據詳細：{view.receiptNumber ?? "（不需開立）"}</h1>
        </div>
      </header>
      <main className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-10">
        <OperatorProvider>
          <OperatorBar />
          <ReceiptDetailScreen receipt={view} />
        </OperatorProvider>
      </main>
    </div>
  );
}
