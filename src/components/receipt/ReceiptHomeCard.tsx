import Link from "next/link";
import { getReceiptHomeSummary } from "@/lib/receipt";

/**
 * V11.1「全宮共用收據中心」首頁提醒卡（需求「二」）。比照 V11.0
 * src/components/collection/CollectionHomeCard.tsx 的既有卡片樣式。
 */
export default async function ReceiptHomeCard() {
  const summary = await getReceiptHomeSummary();

  return (
    <section className="w-full max-w-3xl rounded-3xl bg-white/70 p-6 shadow-card">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-medium text-ink">🧾 收據中心提醒</h2>
        <Link href="/receipt-center" className="text-sm text-ink-faint underline-offset-4 hover:underline">
          前往收據中心 →
        </Link>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Link href="/receipt-center/pending" className="rounded-2xl bg-blossom-100 p-4 transition hover:bg-blossom-200">
          <p className="text-xs text-ink-faint">尚未開立收據</p>
          <p className="mt-1 text-lg text-ink">{summary.pendingCount} 筆</p>
          <p className="text-xs text-ink-faint">共 {summary.pendingAmount.toLocaleString("zh-Hant")} 元</p>
        </Link>

        <div className="rounded-2xl bg-sage-100 p-4">
          <p className="text-xs text-ink-faint">今日已開立</p>
          <p className="mt-1 text-lg text-ink">{summary.todayIssuedCount} 張</p>
        </div>

        <div className="rounded-2xl bg-yolk-100 p-4">
          <p className="text-xs text-ink-faint">本月已開立</p>
          <p className="mt-1 text-lg text-ink">{summary.monthIssuedCount} 張</p>
        </div>

        <div className="rounded-2xl bg-cream-200 p-4">
          <p className="text-xs text-ink-faint">已作廢</p>
          <p className="mt-1 text-lg text-ink">{summary.voidedCount} 張</p>
        </div>

        <div className="rounded-2xl bg-mist-100 p-4">
          <p className="text-xs text-ink-faint">最近收據號碼</p>
          <p className="mt-1 text-base text-ink">{summary.latestReceiptNumber ?? "－"}</p>
        </div>

        <Link href="/receipt-center/pending" className="rounded-2xl bg-blossom-200 p-4 transition hover:bg-blossom-300">
          <p className="text-xs text-ink-faint">開立收據</p>
          <p className="mt-1 text-lg text-ink">立即前往 →</p>
        </Link>
      </div>
    </section>
  );
}
