import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getCurrentRitualYear, getUniversalSalvationRecord } from "@/lib/ritual";
import UniversalSalvationScreen from "@/components/ritual/UniversalSalvationScreen";
import type { RecordJSON } from "@/components/ritual/types";

/**
 * 普渡登記畫面（V3.0）。
 *
 * 網址：/household/F00009/rituals/universal-salvation
 * 年度固定用「目前的民國年」（見 getCurrentRitualYear），不需要行政人員自己選年度。
 */
export default async function UniversalSalvationPage({
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
  const record = await getUniversalSalvationRecord(householdId, year);

  // 傳給 Client Component 之前先做一次 JSON 序列化：Prisma 回傳的
  // Decimal（贊普單價/金額）與 Date 都不是單純物件，無法直接跨越
  // Server → Client 元件邊界，序列化過後就會變成單純的字串/數字。
  const initialRecord: RecordJSON | null = record
    ? (JSON.parse(JSON.stringify(record)) as RecordJSON)
    : null;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-cream-200 bg-cream-50/90 px-6 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-4">
          <Link
            href={`/household/${household.id}`}
            className="whitespace-nowrap text-sm text-ink-soft transition hover:text-ink"
          >
            ← 返回家戶頁
          </Link>
          <span className="truncate text-sm text-ink-faint">
            {household.name}・{household.id}
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-10">
        <UniversalSalvationScreen
          householdId={household.id}
          householdName={household.name}
          year={year}
          initialRecord={initialRecord}
        />
      </main>
    </div>
  );
}
