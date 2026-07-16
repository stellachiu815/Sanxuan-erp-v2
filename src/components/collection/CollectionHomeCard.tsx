import Link from "next/link";
import { getCollectionHomeSummary } from "@/lib/collectionCenter";
import { getCurrentRitualYear } from "@/lib/ritual";

/**
 * V11.0「全宮共用收款中心」首頁提醒卡。比照 V10.1
 * src/components/offering/OfferingHomeCard.tsx 的既有卡片樣式。
 */
export default async function CollectionHomeCard() {
  const year = getCurrentRitualYear();
  const summary = await getCollectionHomeSummary(year);

  return (
    <section className="w-full max-w-3xl rounded-3xl bg-white/70 p-6 shadow-card">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-medium text-ink">💰 收款中心提醒（{year} 年）</h2>
        <Link
          href="/collection-center"
          className="text-sm text-ink-faint underline-offset-4 hover:underline"
        >
          前往收款中心 →
        </Link>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Link
          href="/collection-center/pending"
          className="rounded-2xl bg-blossom-100 p-4 transition hover:bg-blossom-200"
        >
          <p className="text-xs text-ink-faint">待收款項</p>
          <p className="mt-1 text-lg text-ink">{summary.pendingReceivableCount} 筆</p>
          <p className="text-xs text-ink-faint">共 {summary.pendingReceivableAmount.toLocaleString("zh-Hant")} 元</p>
        </Link>

        <Link
          href="/collection-center/pending?onlyCrossYear=1"
          className="rounded-2xl bg-yolk-100 p-4 transition hover:bg-yolk-200"
        >
          <p className="text-xs text-ink-faint">跨年度未收款</p>
          <p className="mt-1 text-lg text-ink">{summary.crossYearUnpaidCount} 筆</p>
        </Link>

        <Link
          href="/collection-center/agent-collection"
          className="rounded-2xl bg-mist-100 p-4 transition hover:bg-mist-200"
        >
          <p className="text-xs text-ink-faint">代收待繳回</p>
          <p className="mt-1 text-lg text-ink">{summary.agentPendingCount} 筆</p>
          <p className="text-xs text-ink-faint">共 {summary.agentPendingAmount.toLocaleString("zh-Hant")} 元</p>
        </Link>

        <Link
          href="/collection-center/quick-payment"
          className="rounded-2xl bg-sage-100 p-4 transition hover:bg-sage-200"
        >
          <p className="text-xs text-ink-faint">快速收款</p>
          <p className="mt-1 text-lg text-ink">立即登錄 →</p>
        </Link>
      </div>
    </section>
  );
}
