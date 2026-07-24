import Link from "next/link";
import PrintItemsCenter from "@/components/universal-salvation/PrintItemsCenter";
import PrintObjectCenter from "@/components/universal-salvation/PrintObjectCenter";

/**
 * V9.1「普渡列印中心」（需求「九」）：跨家戶依年度查看/篩選/批次列印
 * 附加列印項目（寶袋等），入口跟既有的普渡登記畫面是分開的兩條路徑
 * （登記在 /household/[id]/rituals/universal-salvation/[year]，這裡是
 * 跨家戶的列印中心），對應 API 路徑 /api/universal-salvation/[year]/...。
 */
export default async function UniversalSalvationPrintCenterPage({
  params,
}: {
  params: Promise<{ year: string }>;
}) {
  const { year: yearParam } = await params;
  const year = Number(yearParam);

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-cream-200 bg-cream-50/90 px-6 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
          <Link href="/" className="text-sm text-ink-soft hover:underline">
            ← 三玄宮行政系統
          </Link>
          <h1 className="text-sm text-ink-soft">{yearParam} 年普渡列印中心</h1>
        </div>
      </header>

      <main className="mx-auto flex max-w-6xl flex-col gap-8 px-6 py-10">
        {!Number.isInteger(year) ? (
          <p className="text-sm text-ink-soft">年度格式錯誤。</p>
        ) : (
          <>
            {/* V14.4 Part 3：牌位／寶袋列印物件（各自狀態、確認完成列印）。 */}
            <section className="flex flex-col gap-3">
              <h2 className="text-lg font-medium text-ink">牌位與寶袋列印</h2>
              <PrintObjectCenter year={year} />
            </section>
            {/* 既有：附加列印項目（額外寶袋等）明細管理，沿用不動。 */}
            <section className="flex flex-col gap-3">
              <h2 className="text-lg font-medium text-ink">附加列印項目管理</h2>
              <PrintItemsCenter year={year} />
            </section>
          </>
        )}
      </main>
    </div>
  );
}
