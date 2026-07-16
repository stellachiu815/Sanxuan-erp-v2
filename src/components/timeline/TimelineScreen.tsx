"use client";

import { useMemo, useState, type ReactNode } from "react";
import type { HouseholdTimelineView, TimelineEntry } from "@/lib/timeline";
import TimelineEntryCard from "./TimelineEntryCard";

type Props = {
  timeline: HouseholdTimelineView;
  /** 從搜尋結果帶進來的成員 id（已在 page.tsx 驗證過確實屬於這一戶），沒有就是 null。 */
  initialMemberId: string | null;
};

type ViewMode = "HOUSEHOLD" | string;
type YearFilter = "ALL" | number;

/**
 * 信眾時間軸主畫面（V6.0 新增，Client Component）。
 *
 * 資料一次從伺服器端整批拿到（見 page.tsx 呼叫的 getHouseholdTimeline），
 * 這裡的視角切換（整戶／成員）跟年度篩選，全部是純前端的陣列篩選，
 * 不會重新呼叫任何 API、也不會修改資料——符合「任何篩選都只影響畫面」的要求。
 */
export default function TimelineScreen({ timeline, initialMemberId }: Props) {
  const [viewMode, setViewMode] = useState<ViewMode>(initialMemberId ?? "HOUSEHOLD");
  const [yearFilter, setYearFilter] = useState<YearFilter>("ALL");

  const filteredEntries = useMemo(() => {
    return timeline.entries.filter((e) => {
      if (yearFilter !== "ALL" && e.year !== yearFilter) return false;
      if (viewMode !== "HOUSEHOLD") {
        if (e.member === null) return true; // 家戶共同紀錄，任何成員視角都看得到
        if (e.member.id !== viewMode) return false;
      }
      return true;
    });
  }, [timeline.entries, viewMode, yearFilter]);

  const grouped = useMemo(() => {
    const map = new Map<number | null, TimelineEntry[]>();
    for (const entry of filteredEntries) {
      const list = map.get(entry.year) ?? [];
      list.push(entry);
      map.set(entry.year, list);
    }
    const knownYears = Array.from(map.keys())
      .filter((y): y is number => y !== null)
      .sort((a, b) => b - a);
    const groups: { year: number | null; entries: TimelineEntry[] }[] = knownYears.map((year) => ({
      year,
      entries: map.get(year)!,
    }));
    if (map.has(null)) {
      groups.push({ year: null, entries: map.get(null)! });
    }
    return groups;
  }, [filteredEntries]);

  const currentMemberName =
    viewMode !== "HOUSEHOLD" ? timeline.members.find((m) => m.id === viewMode)?.name ?? null : null;

  const [thisYear, lastYear, yearBeforeLast] = timeline.recentYears;

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-3xl bg-white/70 p-6 shadow-card">
        <p className="text-xs text-ink-faint">視角</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <ViewButton active={viewMode === "HOUSEHOLD"} onClick={() => setViewMode("HOUSEHOLD")}>
            👪 整戶視角
          </ViewButton>
          {timeline.members.map((m) => (
            <ViewButton key={m.id} active={viewMode === m.id} onClick={() => setViewMode(m.id)}>
              {m.name}
            </ViewButton>
          ))}
        </div>

        <p className="mt-5 text-xs text-ink-faint">年度</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <ViewButton active={yearFilter === "ALL"} onClick={() => setYearFilter("ALL")}>
            全部年度
          </ViewButton>
          <ViewButton active={yearFilter === thisYear} onClick={() => setYearFilter(thisYear)}>
            今年（{thisYear}）
          </ViewButton>
          <ViewButton active={yearFilter === lastYear} onClick={() => setYearFilter(lastYear)}>
            去年（{lastYear}）
          </ViewButton>
          <ViewButton active={yearFilter === yearBeforeLast} onClick={() => setYearFilter(yearBeforeLast)}>
            前年（{yearBeforeLast}）
          </ViewButton>

          {timeline.years.length > 0 && (
            <select
              className="rounded-full border border-cream-300 bg-white/90 px-3 py-1.5 text-sm text-ink-soft outline-none transition focus:border-mist-300"
              value={typeof yearFilter === "number" ? String(yearFilter) : ""}
              onChange={(e) => setYearFilter(e.target.value ? Number(e.target.value) : "ALL")}
            >
              <option value="">選擇年度…</option>
              {timeline.years.map((y) => (
                <option key={y} value={y}>
                  {y} 年
                </option>
              ))}
            </select>
          )}
        </div>
      </section>

      <p className="text-xs text-ink-faint">
        目前顯示：{viewMode === "HOUSEHOLD" ? "整戶視角" : `${currentMemberName ?? ""} 視角（含家戶共同紀錄）`}
        ・{yearFilter === "ALL" ? "全部年度" : `${yearFilter} 年`}
        ・共 {filteredEntries.length} 筆
      </p>

      {grouped.length === 0 && (
        <div className="rounded-3xl bg-white/70 p-10 text-center shadow-card">
          <p className="text-sm text-ink-faint">目前篩選條件下沒有紀錄。</p>
        </div>
      )}

      {grouped.map((group) => (
        <section key={group.year ?? "unknown"} className="flex flex-col gap-3">
          <h2 className="text-lg font-medium text-ink">
            {group.year !== null ? `${group.year} 年` : "年度不詳（舊資料）"}
          </h2>
          <div className="flex flex-col gap-3">
            {group.entries.map((entry) => (
              <TimelineEntryCard key={`${entry.source}-${entry.id}`} entry={entry} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function ViewButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "rounded-full px-4 py-1.5 text-sm transition " +
        (active ? "bg-ink-soft text-cream-50" : "bg-cream-100/70 text-ink-soft hover:bg-cream-200")
      }
    >
      {children}
    </button>
  );
}
