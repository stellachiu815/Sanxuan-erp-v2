import Link from "next/link";
import { getReceiptStats } from "@/lib/receipt";

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

export default async function ReceiptStatsPage() {
  const stats = await getReceiptStats();

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-cream-200 bg-cream-50/90 px-6 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4">
          <Link href="/receipt-center" className="text-sm text-ink-soft hover:underline">
            ← 收據中心
          </Link>
          <h1 className="text-sm text-ink-soft">📊 收據統計</h1>
        </div>
      </header>

      <main className="mx-auto flex max-w-4xl flex-col gap-6 px-6 py-10">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div className="rounded-2xl bg-sage-100 p-4">
            <p className="text-xs text-ink-faint">今日開立</p>
            <p className="mt-1 text-lg text-ink">{stats.todayIssuedCount} 張</p>
          </div>
          <div className="rounded-2xl bg-yolk-100 p-4">
            <p className="text-xs text-ink-faint">本月開立</p>
            <p className="mt-1 text-lg text-ink">{stats.monthIssuedCount} 張</p>
          </div>
          <div className="rounded-2xl bg-mist-100 p-4">
            <p className="text-xs text-ink-faint">本年開立</p>
            <p className="mt-1 text-lg text-ink">{stats.yearIssuedCount} 張</p>
          </div>
          <div className="rounded-2xl bg-blossom-100 p-4">
            <p className="text-xs text-ink-faint">開立總金額（有效）</p>
            <p className="mt-1 text-lg text-ink">{stats.totalIssuedAmount.toLocaleString("zh-Hant")} 元</p>
          </div>
          <div className="rounded-2xl bg-cream-200 p-4">
            <p className="text-xs text-ink-faint">作廢張數</p>
            <p className="mt-1 text-lg text-ink">{stats.voidedCount} 張</p>
          </div>
          <div className="rounded-2xl bg-cream-200 p-4">
            <p className="text-xs text-ink-faint">換開張數</p>
            <p className="mt-1 text-lg text-ink">{stats.reissuedCount} 張</p>
          </div>
          <div className="rounded-2xl bg-cream-200 p-4">
            <p className="text-xs text-ink-faint">補印次數</p>
            <p className="mt-1 text-lg text-ink">{stats.reprintCount} 次</p>
          </div>
          <div className="rounded-2xl bg-cream-200 p-4">
            <p className="text-xs text-ink-faint">標記不需開立金額</p>
            <p className="mt-1 text-lg text-ink">{stats.noReceiptRequiredAmount.toLocaleString("zh-Hant")} 元</p>
          </div>
        </div>

        <div className="rounded-3xl bg-white/70 p-6 shadow-card">
          <h2 className="text-sm text-ink">各項目收據統計</h2>
          <table className="mt-3 w-full text-left text-sm">
            <thead>
              <tr className="border-b border-cream-200 text-xs text-ink-faint">
                <th className="py-2">項目</th>
                <th className="py-2">張數</th>
                <th className="py-2">金額</th>
              </tr>
            </thead>
            <tbody>
              {stats.byItem.map((i) => (
                <tr key={i.itemName} className="border-b border-cream-100">
                  <td className="py-2">{i.itemName}</td>
                  <td className="py-2">{i.count}</td>
                  <td className="py-2">{i.amount.toLocaleString("zh-Hant")} 元</td>
                </tr>
              ))}
              {!stats.byItem.length && (
                <tr>
                  <td colSpan={3} className="py-4 text-center text-ink-faint">
                    尚無資料
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="rounded-3xl bg-white/70 p-6 shadow-card">
          <h2 className="text-sm text-ink">各經手人統計</h2>
          <table className="mt-3 w-full text-left text-sm">
            <thead>
              <tr className="border-b border-cream-200 text-xs text-ink-faint">
                <th className="py-2">經手人</th>
                <th className="py-2">張數</th>
                <th className="py-2">金額</th>
              </tr>
            </thead>
            <tbody>
              {stats.byOperator.map((o) => (
                <tr key={o.operatorName} className="border-b border-cream-100">
                  <td className="py-2">{o.operatorName}</td>
                  <td className="py-2">{o.count}</td>
                  <td className="py-2">{o.amount.toLocaleString("zh-Hant")} 元</td>
                </tr>
              ))}
              {!stats.byOperator.length && (
                <tr>
                  <td colSpan={3} className="py-4 text-center text-ink-faint">
                    尚無資料
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
