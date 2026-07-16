import Link from "next/link";
import { notFound } from "next/navigation";
import { getHouseholdTimeline } from "@/lib/timeline";
import TimelineScreen from "@/components/timeline/TimelineScreen";

/**
 * 信眾時間軸頁面（V6.0 新增）。
 *
 * 網址：/household/F00009/timeline
 *
 * 純唯讀畫面：整合 RitualRecord（普渡，目前唯一有實際內容的祭祀模組）與
 * 舊 Activity 資料表（唯讀顯示，不再寫入），依年度由新到舊列出這一戶
 * 歷年的祭祀紀錄。這支只負責取資料、算好「搜尋帶進來的成員」要不要預選
 * 成員視角，實際的家戶/成員視角切換、年度篩選、卡片展開都在
 * TimelineScreen（Client Component）裡做，篩選只影響畫面，不會重新查詢
 * 或修改任何資料。
 */
export default async function HouseholdTimelinePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ member?: string }>;
}) {
  const { id: householdId } = await params;
  const { member: memberParam } = await searchParams;

  const timeline = await getHouseholdTimeline(householdId);
  if (!timeline) {
    // 說明同 household/[id]/page.tsx：多這行 throw 讓 TS 自己就能證明
    // 往下走 timeline 一定非 null，不依賴 next/navigation 的型別宣告。
    notFound();
    throw new Error("timeline not found");
  }

  // 從搜尋結果帶進來的成員 id，只有在真的屬於這一戶時才採用，避免網址被
  // 亂帶參數時預選到不存在的成員。
  const initialMemberId =
    memberParam && timeline.members.some((m) => m.id === memberParam) ? memberParam : null;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-cream-200 bg-cream-50/90 px-6 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center gap-4">
          <Link
            href={`/household/${timeline.household.id}${initialMemberId ? `?member=${initialMemberId}` : ""}`}
            className="whitespace-nowrap text-sm text-ink-soft transition hover:text-ink"
          >
            ← 返回家戶頁
          </Link>
          <span className="truncate text-sm text-ink-faint">
            {timeline.household.name}・{timeline.household.id}
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-10">
        <div className="mb-6">
          <h1 className="text-2xl font-medium text-ink">📜 {timeline.household.name} 歷年紀錄</h1>
          <p className="mt-1 text-sm text-ink-faint">
            整合普渡登記與歷史活動紀錄，只能查看，修改請回原本的登記畫面操作。
          </p>
        </div>

        <TimelineScreen timeline={timeline} initialMemberId={initialMemberId} />
      </main>
    </div>
  );
}
