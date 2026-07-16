import Link from "next/link";
import { listPurificationYears } from "@/lib/purification";
import YearListScreen from "@/components/purification/YearListScreen";

/**
 * 祭改年度清單（V9.0「祭改管理與小人頭貼紙列印」）。
 *
 * 台北三玄宮目前只有一種祭改，不分類別，每一年度建立一筆祭改活動
 * （需求「一」），這一頁就是「所有年度」的入口。
 */
export default async function PurificationYearsPage() {
  const years = await listPurificationYears();

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-cream-200 bg-cream-50/90 px-6 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4">
          <Link href="/" className="text-sm text-ink-soft hover:underline">
            ← 三玄宮行政系統
          </Link>
          <h1 className="text-sm text-ink-soft">祭改管理</h1>
        </div>
      </header>

      <main className="mx-auto flex max-w-4xl flex-col gap-8 px-6 py-10">
        <div>
          <h2 className="text-2xl font-medium text-ink">祭改年度</h2>
          <p className="mt-1 text-sm text-ink-soft">
            每一年度建立一筆祭改活動，例如「民國一一五年度祭改」。
          </p>
        </div>

        <YearListScreen
          initialYears={years.map((y) => ({
            id: y.id,
            year: y.year,
            name: y.name,
            isLocked: y.isLocked,
            copiedFromYearId: y.copiedFromYearId,
            createdAt: y.createdAt.toISOString(),
            updatedAt: y.updatedAt.toISOString(),
          }))}
        />
      </main>
    </div>
  );
}
