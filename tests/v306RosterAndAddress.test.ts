import { test } from "node:test";
import assert from "node:assert/strict";
import { sortByRegistrationOrder, orderCell } from "../src/lib/rosterSort";
import { addressVerticalAlign, estimateVerticalLineCount, charsPerColumn } from "../src/components/ritual/tablets/addressLayout";

/** V30.6 活動總名單 Excel 排序 + 地址兩行對齊（既有 Bounding Box 寬15mm 高150mm）。 */

// ── 匯出排序：registrationOrder ASC，NULL 最後、顯示「—」，不以姓名排序 ──
test("sortByRegistrationOrder：ASC 且 NULL 排最後", () => {
  const rows = [
    { registrationOrder: 3, name: "丙" },
    { registrationOrder: null, name: "戊" },
    { registrationOrder: 1, name: "甲" },
    { registrationOrder: 2, name: "乙" },
    { registrationOrder: null, name: "丁" },
  ];
  const sorted = sortByRegistrationOrder(rows).map((r) => r.registrationOrder);
  assert.deepEqual(sorted, [1, 2, 3, null, null]);
});

test("orderCell：有號→數字；NULL→「—」", () => {
  assert.equal(orderCell(7), 7);
  assert.equal(orderCell(null), "—");
});

test("排序穩定，不因輸入姓名順序改變號碼順序（不以姓名排序）", () => {
  const a = [{ registrationOrder: 2, name: "z" }, { registrationOrder: 1, name: "a" }];
  const b = [{ registrationOrder: 1, name: "a" }, { registrationOrder: 2, name: "z" }];
  assert.deepEqual(sortByRegistrationOrder(a).map((r) => r.registrationOrder), [1, 2]);
  assert.deepEqual(sortByRegistrationOrder(b).map((r) => r.registrationOrder), [1, 2]);
});

// ── 地址兩行向下對齊：Bounding Box 寬15mm × 高150mm、字級 16px ──
const BOX_H = 150;
const FONT = 16;

test("單行地址 → center", () => {
  assert.equal(addressVerticalAlign("台北市中正區".length, BOX_H, FONT), "center");
});

test("兩行相近長度 → end", () => {
  const perCol = charsPerColumn(BOX_H, FONT);
  assert.equal(estimateVerticalLineCount(perCol + Math.floor(perCol / 2), BOX_H, FONT), 2);
  assert.equal(addressVerticalAlign(perCol + Math.floor(perCol / 2), BOX_H, FONT), "end");
});

test("第二行很短（僅多 1 字）→ 仍 end（第二行向下對齊）", () => {
  const perCol = charsPerColumn(BOX_H, FONT);
  assert.equal(addressVerticalAlign(perCol + 1, BOX_H, FONT), "end");
});

test("超長兩行（塞滿兩行）→ end，且限制在 Bounding Box 最大可排範圍內（2 行）", () => {
  const perCol = charsPerColumn(BOX_H, FONT);
  assert.equal(estimateVerticalLineCount(perCol * 2, BOX_H, FONT), 2);
  assert.equal(addressVerticalAlign(perCol * 2, BOX_H, FONT), "end");
});

test("邊界：剛好一行 center；多一字兩行 end", () => {
  const perCol = charsPerColumn(BOX_H, FONT);
  assert.equal(addressVerticalAlign(perCol, BOX_H, FONT), "center");
  assert.equal(addressVerticalAlign(perCol + 1, BOX_H, FONT), "end");
});
