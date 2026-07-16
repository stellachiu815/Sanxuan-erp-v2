import Link from "next/link";
import { notFound } from "next/navigation";
import { getPaymentTransaction } from "@/lib/collectionCenter";
import PaymentTransactionDetailScreen from "@/components/collection/PaymentTransactionDetailScreen";

export default async function PaymentTransactionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const transaction = await getPaymentTransaction(id);
  if (!transaction) notFound();

  const view = {
    id: transaction.id,
    transactionNo: transaction.transactionNo,
    paidOn: transaction.paidOn.toISOString().slice(0, 10),
    totalAmount: Number(transaction.totalAmount),
    methodType: transaction.methodType,
    payerNameSnapshot: transaction.payerNameSnapshot,
    isAgentCollected: transaction.isAgentCollected,
    agentName: transaction.agentName,
    agentRemittanceStatus: transaction.agentRemittanceStatus,
    status: transaction.status,
    voidReason: transaction.voidReason,
    note: transaction.note,
    allocations: transaction.allocations.map((a) => ({
      id: a.id,
      sourceType: a.sourceType,
      sourceId: a.sourceId,
      sourceLabel: a.sourceLabel,
      sourceYear: a.sourceYear,
      amount: Number(a.amount),
    })),
    adjustments: transaction.adjustments.map((a) => ({
      id: a.id,
      adjustmentType: a.adjustmentType,
      amount: Number(a.amount),
      reason: a.reason,
      createdAt: a.createdAt.toISOString(),
    })),
  };

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-cream-200 bg-cream-50/90 px-6 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4">
          <Link href="/collection-center/payments" className="text-sm text-ink-soft hover:underline">
            ← 收款紀錄
          </Link>
          <h1 className="text-sm text-ink-soft">收款詳細：{view.transactionNo}</h1>
        </div>
      </header>
      <main className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-10">
        <PaymentTransactionDetailScreen transaction={view} />
      </main>
    </div>
  );
}
