import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sumActivityTotals,
  orderPrintCenterActivities,
  PRINT_HEAVY_GROUPS,
  type PrintCenterActivity,
} from "../src/lib/printCenterOverviewShape";

function mk(partial: Partial<PrintCenterActivity> & { activityGroup: string; activityGroupName: string }): PrintCenterActivity {
  return {
    activityType: null,
    year: 115,
    templeEventId: null,
    reason: "",
    hasEvent: true,
    isInSeason: false,
    isPrintOpen: false,
    isPrintHeavy: PRINT_HEAVY_GROUPS.has(partial.activityGroup),
    items: [],
    totals: { pending: 0, printed: 0, reprinted: 0, confirmed: 0 },
    ...partial,
  };
}

test("sumActivityTotals 逐欄加總", () => {
  const totals = sumActivityTotals([
    { itemKey: "A", itemName: "甲", activityGroup: "G", activityGroupName: "群", year: 115, confirmedCount: 3, printedCount: 1, unprintedCount: 2, reprintedCount: 1, printDocumentKeys: [] },
    { itemKey: "B", itemName: "乙", activityGroup: "G", activityGroupName: "群", year: 115, confirmedCount: 5, printedCount: 5, unprintedCount: 0, reprintedCount: 2, printDocumentKeys: [] },
  ]);
  assert.deepEqual(totals, { pending: 2, printed: 6, reprinted: 3, confirmed: 8 });
});

test("普渡與年度燈屬於列印品項多的活動", () => {
  assert.ok(PRINT_HEAVY_GROUPS.has("UNIVERSAL_SALVATION"));
  assert.ok(PRINT_HEAVY_GROUPS.has("ANNUAL_LANTERN"));
  assert.ok(!PRINT_HEAVY_GROUPS.has("STORAGE_REPAYMENT"));
});

test("orderPrintCenterActivities：當季優先，其次列印品項多，再次有資料", () => {
  const 補庫閒置 = mk({ activityGroup: "STORAGE_REPAYMENT", activityGroupName: "補庫", isInSeason: false });
  const 年度燈當季 = mk({ activityGroup: "ANNUAL_LANTERN", activityGroupName: "年度燈", isInSeason: true, year: 116 });
  const 宮慶有資料 = mk({ activityGroup: "TEMPLE_CELEBRATION", activityGroupName: "宮慶", isInSeason: false, totals: { pending: 0, printed: 0, reprinted: 0, confirmed: 4 } });
  const 普渡當季 = mk({ activityGroup: "UNIVERSAL_SALVATION", activityGroupName: "中元普渡", isInSeason: true });

  const ordered = orderPrintCenterActivities([補庫閒置, 年度燈當季, 宮慶有資料, 普渡當季]);
  const names = ordered.map((a) => a.activityGroupName);

  // 當季的兩個（普渡、年度燈）一定排在非當季（補庫、宮慶）前面。
  assert.ok(names.indexOf("中元普渡") < names.indexOf("補庫"));
  assert.ok(names.indexOf("年度燈") < names.indexOf("宮慶"));
  // 非當季中，有資料的宮慶排在無資料的補庫前面。
  assert.ok(names.indexOf("宮慶") < names.indexOf("補庫"));
});
