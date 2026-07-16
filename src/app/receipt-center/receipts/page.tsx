import Link from "next/link";
import { listReceipts } from "@/lib/receipt";
import ReceiptListScreen from "@/components/receipt/ReceiptListScreen";
import { OperatorProvider } from "@/lib/operatorClient";
import OperatorBar from "@/components/system/OperatorBar";

export default async function ReceiptListPage() {
  const receipts = await listReceipts();

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-cream-200 bg-cream-50/90 px-6 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
          <Link href="/receipt-center" className="text-sm text-ink-soft hover:underline">
            ← 收據中心
          </Link>
          <h1 className="text-sm text-ink-soft">🧾 已開立收據／收據查詢</h1>
        </div>
      </header>

      <main className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-10">
        <OperatorProvider>
          <OperatorBar />
          <ReceiptListScreen
            initialRows={receipts.map((r) => ({
              id: r.id,
              receiptNumber: r.receiptNumber,
              receiptDate: r.receiptDate.toISOString(),
              payerName: r.payerName,
              totalAmount: Number(r.totalAmount),
              status: r.status,
              printCount: r.printCount,
              reprintCount: r.printLogs.filter((p) => p.kind === "REPRINT").length,
              transactionNo: r.paymentTransaction.transactionNo,
              itemSummary: r.lines.map((l) => l.itemName).join("、"),
              createdByName: r.createdByName,
            }))}
          />
        </OperatorProvider>
      </main>
    </div>
  );
}
