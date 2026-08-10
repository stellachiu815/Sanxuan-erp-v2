import Link from "next/link";
import { getDashboardHomeSummary } from "@/lib/dashboardHome";

/**
 * V11.2「首頁 Dashboard（系統總覽）」。
 *
 * 樣式沿用既有 *HomeCard 元件慣例（比照 src/components/collection/
 * CollectionHomeCard.tsx／src/components/receipt/ReceiptHomeCard.tsx）：
 * 圓角卡片、莫蘭迪淡色系、陰影、hover 效果；沒有資料時一律顯示「0」
 * 「—」或「目前沒有資料」，不會出現 Error（需求「UI 要求」）。
 */

function formatAmount(amount: number): string {
  return `${amount.toLocaleString("zh-Hant")} 元`;
}

export default async function DashboardOverviewCard() {
  const data = await getDashboardHomeSummary();

  return (
    <section className="w-full max-w-5xl">
      <h2 className="mb-4 text-base font-medium text-ink">🏠 系統總覽</h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {/* ① 今日生日 */}
        <div className="rounded-3xl bg-yolk-50 p-6 shadow-card transition hover:shadow-pop">
          <p className="text-sm font-medium text-ink">🎂 今日生日</p>
          <div className="mt-3 space-y-3">
            <div>
              <p className="text-xs text-ink-faint">今日國曆生日（{data.todaySolarBirthdays.length} 位）</p>
              {data.todaySolarBirthdays.length === 0 ? (
                <p className="mt-1 text-sm text-ink-faint">今天沒有</p>
              ) : (
                <ul className="mt-1 space-y-1">
                  {data.todaySolarBirthdays.map((b) => (
                    <li key={b.memberId} className="text-sm text-ink">
                      <Link href={`/devotee-center/${b.memberId}`} className="underline-offset-4 hover:underline">{b.name}</Link>
                      {b.householdName && <span className="text-ink-faint">（{b.householdName}）</span>}
                      {b.solarBirthDate && <span className="ml-1 text-xs text-ink-faint">{b.solarBirthDate}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <p className="text-xs text-ink-faint">今日農曆生日（{data.todayLunarBirthdays.length} 位）</p>
              {data.todayLunarBirthdays.length === 0 ? (
                <p className="mt-1 text-sm text-ink-faint">今天沒有</p>
              ) : (
                <ul className="mt-1 space-y-1">
                  {data.todayLunarBirthdays.map((b) => (
                    <li key={b.memberId} className="text-sm text-ink">
                      <Link href={`/devotee-center/${b.memberId}`} className="underline-offset-4 hover:underline">{b.name}</Link>
                      {b.householdName && <span className="text-ink-faint">（{b.householdName}）</span>}
                      {b.lunarBirthDisplay && <span className="ml-1 text-xs text-ink-faint">{b.lunarBirthDisplay}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          <Link
            href="/tools/birthday"
            className="mt-4 inline-block text-xs text-ink-faint underline-offset-4 hover:underline"
          >
            查看完整生日名單 →
          </Link>
        </div>

        {/* ③ 今日收款 */}
        <div className="rounded-3xl bg-sage-50 p-6 shadow-card transition hover:shadow-pop">
          <p className="text-sm font-medium text-ink">💰 今日收款</p>
          <div className="mt-3 space-y-2">
            <div>
              <p className="text-xs text-ink-faint">今日收款筆數</p>
              <p className="mt-1 text-lg text-ink">{data.todayCollection.count} 筆</p>
            </div>
            <div>
              <p className="text-xs text-ink-faint">今日收款總額</p>
              <p className="mt-1 text-lg text-ink">{formatAmount(data.todayCollection.totalAmount)}</p>
            </div>
          </div>
        </div>

        {/* ④ 待收款 */}
        <div className="rounded-3xl bg-blossom-50 p-6 shadow-card transition hover:shadow-pop">
          <p className="text-sm font-medium text-ink">🧾 待收款</p>
          <div className="mt-3 space-y-2">
            <div>
              <p className="text-xs text-ink-faint">未收筆數</p>
              <p className="mt-1 text-lg text-ink">{data.pendingReceivable.count} 筆</p>
            </div>
            <div>
              <p className="text-xs text-ink-faint">未收總額</p>
              <p className="mt-1 text-lg text-ink">{formatAmount(data.pendingReceivable.amount)}</p>
            </div>
          </div>
        </div>

        {/* ⑤ 代收待繳回 */}
        <div className="rounded-3xl bg-cream-200 p-6 shadow-card transition hover:shadow-pop">
          <p className="text-sm font-medium text-ink">🔄 代收待繳回</p>
          <div className="mt-3 space-y-2">
            <div>
              <p className="text-xs text-ink-faint">尚未繳回筆數</p>
              <p className="mt-1 text-lg text-ink">{data.agentPending.count} 筆</p>
            </div>
            <div>
              <p className="text-xs text-ink-faint">尚未繳回金額</p>
              <p className="mt-1 text-lg text-ink">{formatAmount(data.agentPending.amount)}</p>
            </div>
            <div>
              <p className="text-xs text-ink-faint">最長未繳回天數</p>
              <p className="mt-1 text-lg text-ink">
                {data.agentPending.count > 0 ? `${data.agentPending.longestDaysOutstanding} 天` : "—"}
              </p>
            </div>
          </div>
          <Link
            href="/collection-center/agent-collection"
            className="mt-4 inline-block rounded-xl bg-cream-100 px-3 py-1 text-xs text-ink transition hover:bg-cream-300"
          >
            進入對帳 →
          </Link>
        </div>

        {/* ⑥ 年度統計 */}
        <div className="rounded-3xl bg-yolk-100 p-6 shadow-card transition hover:shadow-pop">
          <p className="text-sm font-medium text-ink">📊 {data.rocYear} 年度統計</p>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div>
              <p className="text-xs text-ink-faint">信眾人數</p>
              <p className="mt-1 text-lg text-ink">{data.annualStats.devoteeCount}</p>
            </div>
            <div>
              <p className="text-xs text-ink-faint">家戶數</p>
              <p className="mt-1 text-lg text-ink">{data.annualStats.householdCount}</p>
            </div>
            <div>
              <p className="text-xs text-ink-faint">活動數</p>
              <p className="mt-1 text-lg text-ink">{data.annualStats.activityCount}</p>
            </div>
            <div>
              <p className="text-xs text-ink-faint">收據數</p>
              <p className="mt-1 text-lg text-ink">{data.annualStats.receiptCount}</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
