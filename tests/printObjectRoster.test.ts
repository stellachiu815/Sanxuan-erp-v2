import { test } from "node:test";
import assert from "node:assert/strict";
import {
  expandPrintObjects,
  filterAndSortPrintObjectRows,
  type PrintObjectBase,
} from "../src/lib/printObjectRosterFilter";

/** V36.2 列印物件查詢／補印準備：純函式（展開、篩選、排序）。 */

function base(p: Partial<PrintObjectBase>): PrintObjectBase {
  return {
    objectId: p.objectId ?? Math.random().toString(36).slice(2),
    workNo: p.workNo ?? null,
    activityName: p.activityName ?? "民國 115 年中元普渡",
    itemType: p.itemType ?? "TABLET",
    typeKey: p.typeKey ?? "TABLET:ANCESTOR_LINE",
    typeLabel: p.typeLabel ?? "牌位・歷代祖先",
    householdId: p.householdId ?? "F00001",
    householdCode: p.householdCode ?? "F00001",
    householdName: p.householdName ?? "周家",
    registrantName: p.registrantName ?? "周財寶",
    mainText: p.mainText ?? "周姓歷代祖先",
    yangshang: p.yangshang ?? ["周財寶"],
    address: p.address ?? "台北市",
    firstPrintedAt: p.firstPrintedAt ?? null,
    lastPrintedAt: p.lastPrintedAt ?? null,
    printCount: p.printCount ?? 0,
    quantity: p.quantity ?? 1,
    printedQuantity: p.printedQuantity ?? 0,
    reportStatus: p.reportStatus ?? "CONFIRMED",
    createdAt: p.createdAt ?? "2026-08-01T00:00:00.000Z",
    previewHref: p.previewHref ?? "/preview",
  };
}

test("一筆報名 5 個寶袋 → 展開成 5 筆獨立列印物件（非數量單列）", () => {
  const rows = expandPrintObjects([base({ objectId: "pk", itemType: "POCKET", typeKey: "POCKET", quantity: 5, printedQuantity: 2 })]);
  assert.equal(rows.length, 5);
  assert.deepEqual(rows.map((r) => r.copyIndex), [1, 2, 3, 4, 5]);
  // 前 2 份已列印、後 3 份未列印。
  assert.deepEqual(rows.map((r) => r.copyPrinted), [true, true, false, false, false]);
  // 皆為獨立 rowKey。
  assert.equal(new Set(rows.map((r) => r.rowKey)).size, 5);
});

test("No.xxx 排序，空號一律排最後（升冪與降冪）", () => {
  const rows = expandPrintObjects([base({ workNo: 3 }), base({ workNo: null }), base({ workNo: 1 })]);
  assert.deepEqual(filterAndSortPrintObjectRows(rows, { sort: "workNoAsc" }).map((r) => r.workNo), [1, 3, null]);
  assert.deepEqual(filterAndSortPrintObjectRows(rows, { sort: "workNoDesc" }).map((r) => r.workNo), [3, 1, null]);
});

test("已列印／未列印篩選（每份層級）", () => {
  const rows = expandPrintObjects([base({ objectId: "a", quantity: 3, printedQuantity: 1 })]);
  assert.equal(filterAndSortPrintObjectRows(rows, { printed: "printed" }).length, 1);
  assert.equal(filterAndSortPrintObjectRows(rows, { printed: "unprinted" }).length, 2);
});

test("首印／補印篩選（物件層級：printCount>0＝補印）", () => {
  const rows = expandPrintObjects([base({ objectId: "new", printCount: 0 }), base({ objectId: "again", printCount: 2 })]);
  assert.equal(filterAndSortPrintObjectRows(rows, { firstReprint: "first" }).length, 1);
  assert.equal(filterAndSortPrintObjectRows(rows, { firstReprint: "reprint" }).length, 1);
});

test("活動與類型篩選", () => {
  const rows = expandPrintObjects([
    base({ objectId: "t", typeKey: "TABLET:ANCESTOR_LINE", activityName: "普渡A" }),
    base({ objectId: "p", typeKey: "POCKET", activityName: "普渡B" }),
  ]);
  assert.equal(filterAndSortPrintObjectRows(rows, { typeKey: "POCKET" }).length, 1);
  assert.equal(filterAndSortPrintObjectRows(rows, { activityName: "普渡A" }).length, 1);
});

test("姓名／主文／陽上人搜尋", () => {
  const rows = expandPrintObjects([
    base({ objectId: "a", registrantName: "周財寶", mainText: "周姓歷代祖先", yangshang: ["周財寶"] }),
    base({ objectId: "b", registrantName: "陳秀珍", mainText: "累世冤親債主", yangshang: ["陳秀珍"] }),
  ]);
  assert.equal(filterAndSortPrintObjectRows(rows, { keyword: "冤親" }).length, 1);
  assert.equal(filterAndSortPrintObjectRows(rows, { keyword: "周財寶" }).length, 1);
  assert.equal(filterAndSortPrintObjectRows(rows, { keyword: "陳秀珍" }).length, 1);
});

test("同一家戶的不同列印物件不合併（各自成列）", () => {
  const rows = expandPrintObjects([
    base({ objectId: "x", householdCode: "F00001", mainText: "周姓歷代祖先" }),
    base({ objectId: "y", householdCode: "F00001", mainText: "累世冤親債主" }),
    base({ objectId: "z", householdCode: "F00001", itemType: "POCKET", typeKey: "POCKET", quantity: 2 }),
  ]);
  // 2 個牌位 + 1 個寶袋(數量2→2列) = 4 列，全屬同一家戶但不合併。
  assert.equal(filterAndSortPrintObjectRows(rows, { householdCode: "F00001" }).length, 4);
});
