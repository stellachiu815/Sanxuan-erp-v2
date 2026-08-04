import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { printObjectCountsByItemKey, US_CATEGORY_TO_ITEM_KEY } from "../src/lib/TabletBatchService";

/**
 * V36.8：Print Center 祖先／乙位／冤親／寶袋計數＝V34 同一支查詢（列印物件）換算（純函式）。
 */

const po = (itemType: string, sourceCategory: string, printCount = 0) => ({ itemType, sourceCategory, printCount });

test("牌位依 sourceCategory 對應 US key；寶袋歸 US_POCKET_EXTRA", () => {
  const objs = [
    ...Array.from({ length: 34 }, () => po("TABLET", "ANCESTOR_LINE")),
    ...Array.from({ length: 13 }, () => po("TABLET", "INDIVIDUAL_SOUL")),
    ...Array.from({ length: 2 }, () => po("TABLET", "DEBT_CREDITOR")),
    ...Array.from({ length: 50 }, () => po("POCKET", "ANCESTOR_LINE")), // 基本+額外皆 POCKET
  ];
  const m = printObjectCountsByItemKey(objs);
  assert.equal(m.get("US_ANCESTOR")?.confirmed, 34);
  assert.equal(m.get("US_ZHENGHUN")?.confirmed, 13);
  assert.equal(m.get("US_YUANQIN")?.confirmed, 2);
  assert.equal(m.get("US_POCKET_EXTRA")?.confirmed, 50);
});

test("printed＝printCount>0；reprinted＝printCount>=2", () => {
  const m = printObjectCountsByItemKey([
    po("TABLET", "ANCESTOR_LINE", 0),
    po("TABLET", "ANCESTOR_LINE", 1),
    po("TABLET", "ANCESTOR_LINE", 3),
  ]);
  const s = m.get("US_ANCESTOR")!;
  assert.equal(s.confirmed, 3);
  assert.equal(s.printed, 2);
  assert.equal(s.reprinted, 1);
});

test("未知類別 / 非牌位寶袋型別不計入", () => {
  const m = printObjectCountsByItemKey([po("TABLET", "SOMETHING_ELSE", 1), po("LANTERN", "X", 1)]);
  assert.equal(m.size, 0);
});

test("category→key 對照正確", () => {
  assert.equal(US_CATEGORY_TO_ITEM_KEY.ANCESTOR_LINE, "US_ANCESTOR");
  assert.equal(US_CATEGORY_TO_ITEM_KEY.INDIVIDUAL_SOUL, "US_ZHENGHUN");
  assert.equal(US_CATEGORY_TO_ITEM_KEY.DEBT_CREDITOR, "US_YUANQIN");
  assert.equal(US_CATEGORY_TO_ITEM_KEY.UNBORN_CHILD, "US_WUYUAN");
});

test("listActivityItemPrintSummary 已改用 listPrintItemsForPrintCenter（與 V34 同源，普渡不再另用 CONFIRMED 計數）", () => {
  const src = readFileSync(new URL("../src/lib/printDocuments.ts", import.meta.url), "utf8");
  assert.ok(src.includes("listPrintItemsForPrintCenter"), "彙總需沿用 V34 列印物件查詢");
  assert.ok(src.includes("printObjectCountsByItemKey"), "以列印物件換算普渡計數");
  // 其他活動仍保留 CONFIRMED 報名計數（不破壞）。
  assert.ok(/status:\s*"CONFIRMED"/.test(src), "非普渡項目維持 CONFIRMED 報名計數");
});
