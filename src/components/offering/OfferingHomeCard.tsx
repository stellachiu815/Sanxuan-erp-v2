import Link from "next/link";
import { getOfferingHomeSummary } from "@/lib/offeringClaims";
import { getCurrentRitualYear } from "@/lib/ritual";

/**
 * V10.1「供品認捐中心」需求「十六、供品認捐首頁」提醒卡。
 *
 * 這是整個系統第一張「首頁提醒卡」（首頁原本只有搜尋框跟功能連結，沒有
 * 任何統計提醒），所以這裡直接建立成獨立元件，之後如果其他模組（例如
 * 代收待繳回提醒，docs/AGENT_REMITTANCE.md 目前還只是規劃文件、尚未真正
 * 開發）也要在首頁加提醒卡，可以沿用同樣的卡片樣式，不需要重新設計版型。
 *
 * 這是 async server component（Next.js App Router 支援），直接在伺服器端
 * 呼叫 Prisma 查詢，不需要另外開一支 API route 給首頁用。
 */
export default async function OfferingHomeCard() {
  const year = getCurrentRitualYear();
  const summary = await getOfferingHomeSummary(year);

  return (
    <section className="w-full max-w-3xl rounded-3xl bg-white/70 p-6 shadow-card">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-medium text-ink">🙏 供品認捐提醒（{year} 年）</h2>
        <Link
          href="/offering-center"
          className="text-sm text-ink-faint underline-offset-4 hover:underline"
        >
          前往供品認捐中心 →
        </Link>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {/* 花果供品／大小福壽龜／麵塔／散壽桃麵都是彙整多個活動的統計數字，
            不對應單一畫面，所以點進去統一先回供品認捐中心主選單，再由使用者
            選擇要看的活動（詳見該活動卡片裡的「查看花果供品名單」等連結）。 */}
        <Link
          href="/offering-center"
          className="rounded-2xl bg-cream-100 p-4 transition hover:bg-cream-200"
        >
          <p className="text-xs text-ink-faint">花果供品</p>
          <p className="mt-1 text-lg text-ink">
            {summary.floralClaimedCount}／{summary.floralTotalSlots}
          </p>
          <p className="text-xs text-ink-faint">已認捐（尚缺 {summary.floralUnclaimedCount} 次）</p>
        </Link>

        <Link
          href="/offering-center/unpaid"
          className="rounded-2xl bg-blossom-100 p-4 transition hover:bg-blossom-200"
        >
          <p className="text-xs text-ink-faint">花果供品未收款</p>
          <p className="mt-1 text-lg text-ink">{summary.floralUnpaidCount} 筆</p>
        </Link>

        <Link
          href="/offering-center"
          className="rounded-2xl bg-mist-100 p-4 transition hover:bg-mist-200"
        >
          <p className="text-xs text-ink-faint">大福壽龜</p>
          <p className="mt-1 text-lg text-ink">{summary.largeTurtleClaimed ? "已登錄得主" : "尚未登錄"}</p>
        </Link>

        <Link
          href="/offering-center"
          className="rounded-2xl bg-sage-100 p-4 transition hover:bg-sage-200"
        >
          <p className="text-xs text-ink-faint">小福壽龜</p>
          <p className="mt-1 text-lg text-ink">
            {summary.smallTurtleRemaining === null ? "本年度尚未設定" : `尚缺 ${summary.smallTurtleRemaining} 位`}
          </p>
        </Link>

        <Link
          href="/offering-center"
          className="rounded-2xl bg-cream-100 p-4 transition hover:bg-cream-200"
        >
          <p className="text-xs text-ink-faint">壽桃麵塔</p>
          <p className="mt-1 text-lg text-ink">
            {summary.noodleTowerRemaining === null ? "本年度尚未設定" : `尚缺 ${summary.noodleTowerRemaining} 對`}
          </p>
        </Link>

        <Link
          href="/offering-center"
          className="rounded-2xl bg-blossom-100 p-4 transition hover:bg-blossom-200"
        >
          <p className="text-xs text-ink-faint">散壽桃麵</p>
          <p className="mt-1 text-lg text-ink">
            {summary.loosePeachRemaining === null ? "本年度尚未設定" : `尚缺 ${summary.loosePeachRemaining} 份`}
          </p>
        </Link>

        <Link
          href="/offering-center/unpaid?crossYear=1"
          className="col-span-2 rounded-2xl bg-mist-100 p-4 transition hover:bg-mist-200 sm:col-span-2"
        >
          <p className="text-xs text-ink-faint">跨年度未收款</p>
          <p className="mt-1 text-lg text-ink">
            {summary.crossYearUnpaidCount} 筆／{summary.crossYearUnpaidAmount.toLocaleString("zh-Hant")} 元
          </p>
        </Link>
      </div>
    </section>
  );
}
