import Link from "next/link";
import PrintItemsCenter from "@/components/universal-salvation/PrintItemsCenter";

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
          <PrintItemsCenter year={year} />
        )}
      </main>
    </div>
  );
}
