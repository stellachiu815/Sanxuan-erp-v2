import Link from "next/link";
import { listPrintObjectsForReprintConsole } from "@/lib/printObjectRoster";
import PrintObjectReprintConsole from "@/components/print/PrintObjectReprintConsole";

/**
 * V36.2：列印物件查詢／補印準備（只讀）。
 *   /print-center/print-objects?year=115
 *
 * server component 只讀取（listPrintObjectsForReprintConsole，沿用既有列印物件查詢），
 * 交由 client 做前端篩選／搜尋／排序、預覽導向與補印摘要。不寫入、不修改任何資料。
 */
export const dynamic = "force-dynamic";

export default async function PrintObjectsPage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const { year: yearParam } = await searchParams;
  const currentMinguo = new Date().getFullYear() - 1911;
  const year = Number(yearParam);
  const resolvedYear = Number.isInteger(year) && year > 0 ? year : currentMinguo;

  const rows = await listPrintObjectsForReprintConsole(resolvedYear);

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <Link href="/print-center" className="text-sm text-ink-soft underline-offset-4 hover:underline">← 返回列印管理</Link>
        <div className="flex items-center gap-2 text-sm text-ink-soft">
          {[resolvedYear + 1, resolvedYear, resolvedYear - 1].map((y) => (
            <Link key={y} href={`/print-center/print-objects?year=${y}`} className={`rounded-full px-3 py-1 ${y === resolvedYear ? "bg-sage-200 text-ink" : "bg-cream-100 text-ink-soft hover:bg-cream-200"}`}>
              民國 {y}
            </Link>
          ))}
        </div>
      </div>
      <PrintObjectReprintConsole rows={rows} year={resolvedYear} />
    </main>
  );
}
