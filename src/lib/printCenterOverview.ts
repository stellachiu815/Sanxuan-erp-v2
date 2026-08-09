/**
 * V39 列印中心總覽（依檔期自動排當季活動＋年度自動帶對）。
 *
 * ── 為什麼需要這支 ─────────────────────────────────────────
 * 舊列印中心頁把「年度」寫死成民國當年（new Date().getFullYear() - 1911），
 * 所有活動卡片、正式列印入口、彙總都共用這一個年度。但年度燈的規則是
 * 「隔年」——民國 115 年底受理、列印的是 116 年度，資料落在 116。
 * 於是列印中心停在 115 時，年度燈整組顯示 0、名單空、就算硬印歲數還會少一歲。
 *
 * 這支改用全系統唯一的年度判斷機制 resolveDefaultActivityYear()，對**每個活動
 * 群組各自**解析出正確年度（普渡→當年、年度燈→隔年），並判斷哪個活動「當季」
 * （今天仍可報名或可列印），供頁面把當季活動的正式列印入口排到最顯眼。
 *
 * ⚠️ 純加法：不改 listActivityItemPrintSummary、不改普渡任何既有查詢或連結。
 *    只是「對的年度餵給既有彙總」，再把結果依群組整理。
 */

import { prisma } from "@/lib/prisma";
import type { ActivityType } from "@prisma/client";
import {
  resolveDefaultActivityYear,
  canAcceptRegistration,
  canPrint,
} from "@/lib/activityYear";
import {
  listActivityItemPrintSummary,
  type ActivityItemPrintSummary,
} from "@/lib/printDocuments";
import {
  PRINT_HEAVY_GROUPS,
  RESOLVABLE_ACTIVITY_TYPES,
  sumActivityTotals,
  orderPrintCenterActivities,
  type PrintCenterActivity,
} from "@/lib/printCenterOverviewShape";

// 純型別與純函式集中在 printCenterOverviewShape.ts（不碰 DB，方便單元測試）。
export {
  PRINT_HEAVY_GROUPS,
  sumActivityTotals,
  orderPrintCenterActivities,
} from "@/lib/printCenterOverviewShape";
export type { PrintCenterActivity } from "@/lib/printCenterOverviewShape";

/**
 * 列印中心總覽：每個活動群組各自帶對年度＋當季判斷＋該年度彙總。
 *
 * 效能：同一個年度的彙總只查一次（多數情況就 115／116 兩個年度）。
 */
export async function resolvePrintCenterActivities(
  now: Date = new Date()
): Promise<PrintCenterActivity[]> {
  // 1) 取得目前有啟用報名項目的所有活動群組（保留定義順序）。
  const itemTypes = await prisma.registrationItemType.findMany({
    where: { isActive: true },
    orderBy: [{ activityGroup: "asc" }, { sortOrder: "asc" }],
    select: { activityGroup: true, activityGroupName: true },
  });
  const groupNames = new Map<string, string>();
  for (const t of itemTypes) {
    if (!groupNames.has(t.activityGroup)) groupNames.set(t.activityGroup, t.activityGroupName);
  }

  // 2) 每個年度的彙總只查一次。
  const summaryCache = new Map<number, ActivityItemPrintSummary[]>();
  const getSummary = async (y: number) => {
    const cached = summaryCache.get(y);
    if (cached) return cached;
    const s = await listActivityItemPrintSummary(y);
    summaryCache.set(y, s);
    return s;
  };

  const out: PrintCenterActivity[] = [];
  for (const [group, groupName] of groupNames) {
    const activityType = RESOLVABLE_ACTIVITY_TYPES.has(group) ? (group as ActivityType) : null;

    let year: number | null = null;
    let templeEventId: string | null = null;
    let reason = "";
    let hasEvent = false;
    let isInSeason = false;
    let isPrintOpen = false;

    if (activityType) {
      const decision = await resolveDefaultActivityYear(activityType, now);
      if (decision.ok) {
        year = decision.candidate.year;
        templeEventId = decision.candidate.templeEventId;
        reason = decision.reason;
        hasEvent = true;
        isPrintOpen = canPrint(decision.candidate).ok;
        isInSeason = canAcceptRegistration(decision.candidate, now).ok || isPrintOpen;
      } else {
        reason = decision.reason;
        hasEvent = decision.alternatives.length > 0;
      }
    }

    const items = year != null ? (await getSummary(year)).filter((s) => s.activityGroup === group) : [];

    out.push({
      activityGroup: group,
      activityGroupName: groupName,
      activityType,
      year,
      templeEventId,
      reason,
      hasEvent,
      isInSeason,
      isPrintOpen,
      isPrintHeavy: PRINT_HEAVY_GROUPS.has(group),
      items,
      totals: sumActivityTotals(items),
    });
  }

  return orderPrintCenterActivities(out);
}
