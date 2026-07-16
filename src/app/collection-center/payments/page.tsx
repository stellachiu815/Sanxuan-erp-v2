import Link from "next/link";
import { listPaymentTransactions } from "@/lib/collectionCenter";
import { paymentMethodTypeLabel, paymentTransactionStatusLabel } from "@/lib/labels";

export default async function PaymentTransactionsPage() {
  const rows = await listPaymentTransactions();

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-cream-200 bg-cream-50/90 px-6 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4">
          <Link href="/collection-center" className="text-sm text-ink-soft hover:underline">
            ← 收款中心
          </Link>
          <h1 className="text-sm text-ink-soft">🧾 收款紀錄</h1>
        </div>
      </header>
      <main className="mx-auto flex max-w-5xl flex-col gap-4 px-6 py-10">
        <div className="overflow-x-auto rounded-2xl bg-white/70 shadow-card">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-cream-200 text-xs text-ink-faint">
                <th className="px-4 py-3">收款序號</th>
                <th className="px-4 py-3">收款日</th>
                <th className="px-4 py-3">付款人</th>
                <th className="px-4 py-3">金額</th>
                <th className="px-4 py-3">方式</th>
                <th className="px-4 py-3">分配項目數</th>
                <th className="px-4 py-3">狀態</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id} className="border-b border-cream-100 hover:bg-cream-50">
                  <td className="px-4 py-3">
                    <Link href={`/collection-center/payments/${t.id}`} className="text-ink hover:underline">
                      {t.transactionNo}
                    </Link>
                  </td>
                  <td className="px-4 py-3">{t.paidOn.toISOString().slice(0, 10)}</td>
                  <td className="px-4 py-3">
                    {t.payerNameSnapshot}
                    {t.isAgentCollected && <span className="ml-1 text-xs text-ink-faint">（代收：{t.agentName}）</span>}
                  </td>
                  <td className="px-4 py-3">{Number(t.totalAmount).toLocaleString("zh-Hant")}</td>
                  <td className="px-4 py-3">{paymentMethodTypeLabel[t.methodType] ?? t.methodType}</td>
                  <td className="px-4 py-3">{t.allocations.length}</td>
                  <td className="px-4 py-3">{paymentTransactionStatusLabel[t.status] ?? t.status}</td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-ink-faint">
                    目前還沒有任何收款紀錄
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
