import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getCurrentRitualYear } from "@/lib/ritual";
import PrintCenter from "@/components/ritual/PrintCenter";

/**
 * 普渡牌位列印中心（V4.0）。
 *
 * 網址：/household/F00009/rituals/universal-salvation/print
 *
 * 這支畫面完全不重新查詢祭祀資料庫——列印資料一律由既有的 Print API
 * （GET /api/households/[id]/rituals/universal-salvation/[year]/print）
 * 提供，這裡只負責取家戶名稱做畫面標題，跟其他祭祀頁面一樣的模式。
 */
export default async function UniversalSalvationPrintPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: householdId } = await params;

  const household = await prisma.household.findFirst({
    where: { id: householdId, deletedAt: null },
    select: { id: true, name: true },
  });
  if (!household) notFound();

  const year = getCurrentRitualYear();

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-cream-200 bg-cream-50/90 px-6 py-4 backdrop-blur print:hidden">
        <div className="mx-auto flex max-w-5xl items-center gap-4">
          <Link
            href={`/household/${household.id}/rituals/universal-salvation`}
            className="whitespace-nowrap text-sm text-ink-soft transition hover:text-ink"
          >
            ← 返回普渡登記
          </Link>
          <span className="truncate text-sm text-ink-faint">
            {household.name}・{household.id}
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-10 print:max-w-none print:p-0">
        <PrintCenter householdId={household.id} householdName={household.name} year={year} />
      </main>
    </div>
  );
}
