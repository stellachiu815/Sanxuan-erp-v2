/**
 * V39 列印中心總覽——**純型別與純函式**（不碰 DB）。
 *
 * 抽出來的目的：讓排序／加總等純邏輯可以單獨單元測試，不會在測試時
 * 連帶載入 Prisma（沙盒無 Prisma 引擎）。DB 查詢在 printCenterOverview.ts。
 */

import type { ActivityType } from "@prisma/client";
import type { ActivityItemPrintSummary } from "@/lib/printDocuments";

/**
 * 「列印品項多、需要正式列印入口」的活動群組——目前是普渡與年度燈。
 * 其餘（補庫／宮燈／宮慶…）只需要總名單，不在這裡展開正式列印入口。
 */
export const PRINT_HEAVY_GROUPS = new Set<string>([
  "UNIVERSAL_SALVATION",
  "ANNUAL_LANTERN",
]);

/**
 * activityGroup 字串一律等於 ActivityType enum 名稱（見 RegistrationItemType seed）。
 * 這裡列出可解析年度的合法值，非清單內的群組退回不解析年度。
 */
export const RESOLVABLE_ACTIVITY_TYPES = new Set<string>([
  "UNIVERSAL_SALVATION",
  "ANNUAL_LANTERN",
  "DRAGON_PHOENIX_LANTERN",
  "TEMPLE_CELEBRATION",
  "STORAGE_REPAYMENT",
  "PURIFICATION",
  "OTHER",
]);

export type PrintCenterActivity = {
  /** = ActivityType 字串 */
  activityGroup: string;
  /** 中文群組名（中元普渡／年度燈／補庫／宮慶…） */
  activityGroupName: string;
  activityType: ActivityType | null;
  /** 解析出的活動使用年度（民國）。沒有已建立的活動時為 null。 */
  year: number | null;
  /** 選中／排除的理由，供畫面顯示。 */
  reason: string;
  /** 是否已建立該活動年度。 */
  hasEvent: boolean;
  /** 當季＝今天仍可報名或可列印（用來把它排到最顯眼）。 */
  isInSeason: boolean;
  /** 是否開放列印。 */
  isPrintOpen: boolean;
  /** 是否列印品項多、需要正式列印入口（普渡／年度燈）。 */
  isPrintHeavy: boolean;
  /** 該群組在該年度的各報名項目彙總。 */
  items: ActivityItemPrintSummary[];
  totals: { pending: number; printed: number; reprinted: number; confirmed: number };
};

/** 純函式：把某群組的項目彙總加總。 */
export function sumActivityTotals(items: ActivityItemPrintSummary[]): PrintCenterActivity["totals"] {
  return {
    pending: items.reduce((s, it) => s + it.unprintedCount, 0),
    printed: items.reduce((s, it) => s + it.printedCount, 0),
    reprinted: items.reduce((s, it) => s + it.reprintedCount, 0),
    confirmed: items.reduce((s, it) => s + it.confirmedCount, 0),
  };
}

/**
 * 純函式：列印中心活動排序——當季優先、其次列印品項多者、再次有資料者、最後照名稱。
 */
export function orderPrintCenterActivities(list: PrintCenterActivity[]): PrintCenterActivity[] {
  const rank = (a: PrintCenterActivity) =>
    (a.isInSeason ? 0 : 1) * 1000 +
    (a.isPrintHeavy ? 0 : 1) * 100 +
    (a.totals.confirmed > 0 ? 0 : 1) * 10;
  return [...list].sort((a, b) => {
    const r = rank(a) - rank(b);
    if (r !== 0) return r;
    return a.activityGroupName.localeCompare(b.activityGroupName, "zh-Hant");
  });
}
