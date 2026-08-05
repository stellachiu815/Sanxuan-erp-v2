import Link from "next/link";
import { listUniversalSalvationParticipantItems } from "@/lib/activityParticipantRoster";
import ActivityParticipantRosterScreen from "@/components/print/ActivityParticipantRosterScreen";

/**
 * V36.1：活動參加名單（只讀）——每一筆報名項目一列，不合併家戶。
 *   /print-center/activity-participants?year=115
 *
 * server component 只讀取（listUniversalSalvationParticipantItems，純 SELECT），
 * 交由 client 元件做前端篩選／搜尋／排序與響應式呈現。不寫入、不修改任何資料。
 */
export const dynamic = "force-dynamic";

export default async function ActivityParticipantsPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  const { year: yearParam } = await searchParams;
  const currentMinguo = new Date().getFullYear() - 1911;
  const year = Number(yearParam);
  const resolvedYear = Number.isInteger(year) && year > 0 ? year : currentMinguo;

  const items = await listUniversalSalvationParticipantItems(resolvedYear);

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <Link href="/print-center" className="text-sm text-ink-soft underline-offset-4 hover:underline">← 返回列印管理</Link>
        <div className="flex items-center gap-2 text-sm text-ink-soft">
          {[resolvedYear + 1, resolvedYear, resolvedYear - 1].map((y) => (
            <Link
              key={y}
              href={`/print-center/activity-participants?year=${y}`}
              className={`rounded-full px-3 py-1 ${y === resolvedYear ? "bg-sage-200 text-ink" : "bg-cream-100 text-ink-soft hover:bg-cream-200"}`}
            >
              民國 {y}
            </Link>
          ))}
        </div>
      </div>
      <ActivityParticipantRosterScreen items={items} year={resolvedYear} />
    </main>
  );
}
