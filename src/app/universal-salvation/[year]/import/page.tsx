import Link from "next/link";
import PurificationImportScreen from "@/components/universal-salvation/PurificationImportScreen";

/**
 * V14.4 Part 6B：普渡 Excel 匯入頁（沿用普渡年度，不建第二個活動中心）。
 * 入口：活動中心 → 當年度普渡活動 → Excel 匯入。
 */
export default async function PurificationImportPage({ params }: { params: Promise<{ year: string }> }) {
  const { year: yearParam } = await params;
  const year = Number(yearParam);
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-cream-200 bg-cream-50/90 px-6 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4">
          <Link href="/activities" className="text-sm text-ink-soft hover:underline">← 宮務活動中心</Link>
          <h1 className="text-sm text-ink-soft">{yearParam} 年普渡 Excel 匯入</h1>
        </div>
      </header>
      <main className="mx-auto flex max-w-5xl flex-col gap-6 px-6 py-10">
        {!Number.isInteger(year) ? <p className="text-sm text-ink-soft">年度格式錯誤。</p> : <PurificationImportScreen year={year} />}
      </main>
    </div>
  );
}
