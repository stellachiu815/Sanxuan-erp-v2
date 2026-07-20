import Link from "next/link";
import { listPaymentTransactions } from "@/lib/collectionCenter";
import { paymentMethodTypeLabel, paymentTransactionStatusLabel } from "@/lib/labels";

/**
 * 這一頁在「每次請求」時即時查詢資料庫，不做建置期預渲染。
 *
 * 原因（V12.3 建置修正）：App Router 的頁面預設是靜態的——只要沒有用到
 * cookies()／headers()／searchParams 這類動態 API，Next.js 就會在
 * `next build` 階段直接執行這個 Server Component 並把結果存成靜態 HTML。
 * 本頁的資料來自直接呼叫 Prisma（不是 fetch，所以也沒有 fetch 層的快取
 * 標記可以讓 Next.js 判斷「這是動態資料」），因此會發生兩個問題：
 *
 *   1. 建置階段會去連線正式資料庫。資料庫在建置當下不可達（例如在本機
 *      build、或 Render 資料庫短暫離線）就會直接 build 失敗（Prisma P1001）。
 *   2. 更嚴重的是就算建置成功，這一頁也會被凍結成建置當下的快照，
 *      之後行政人員看到的數字不會更新，要等下一次部署才會變。
 *
 * 這一頁顯示的是即時營運資料，本來就不該被快取，所以明確標記為動態渲染。
 *
 * ⚠️ 這不會吞掉執行期的資料庫錯誤：請求當下若連不上資料庫，仍會照常拋出
 * 錯誤並顯示錯誤畫面，只是不再於建置階段連線。
 */
export const dynamic = "force-dynamic";

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
