import Link from "next/link";
import { listPendingReceiptAllocations } from "@/lib/receipt";
import PendingReceiptsScreen from "@/components/receipt/PendingReceiptsScreen";
import { OperatorProvider } from "@/lib/operatorClient";
import OperatorBar from "@/components/system/OperatorBar";

export default async function ReceiptPendingPage() {
  const rows = await listPendingReceiptAllocations();

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-cream-200 bg-cream-50/90 px-6 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
          <Link href="/receipt-center" className="text-sm text-ink-soft hover:underline">
            ← 收據中心
          </Link>
          <h1 className="text-sm text-ink-soft">📋 待開立收據</h1>
        </div>
      </header>

      <main className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-10">
        <OperatorProvider>
          <OperatorBar />
          <PendingReceiptsScreen
            initialRows={rows.map((r) => ({
              ...r,
              paidOn: r.paidOn.toISOString(),
            }))}
          />
        </OperatorProvider>
      </main>
    </div>
  );
}
