import Link from "next/link";
import { getReceiptStats } from "@/lib/receipt";

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
