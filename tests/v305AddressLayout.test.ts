import { test } from "node:test";
import assert from "node:assert/strict";
import {
  charsPerColumn,
  estimateVerticalLineCount,
  addressVerticalAlign,
} from "../src/components/ritual/tablets/addressLayout";

/**
 * V30.5 地址兩行向下對齊：只驗證「何時判定為兩行 → 用 end 對齊」的純規則。
 * 牌位地址欄以 POCKET 地址盒（25×140mm、字級 16px）為代表；牌位版型地址盒亦同字級。
 */
const BOX_H = 140; // mm（寶袋地址盒高；牌位地址盒同數量級）
const FONT = 16; // px（fontPxFor address）

test("單行地址 → center（不影響單行）", () => {
  // 短地址，一行內排得下。
  assert.equal(estimateVerticalLineCount("台北市".length, BOX_H, FONT), 1);
  assert.equal(addressVerticalAlign("台北市中正區".length, BOX_H, FONT), "center");
});

test("兩行地址 → end（第二行向下對齊）", () => {
  const perCol = charsPerColumn(BOX_H, FONT);
  const twoLineText = "字".repeat(perCol + 3); // 略超過一行
  assert.equal(estimateVerticalLineCount(twoLineText.length, BOX_H, FONT), 2);
  assert.equal(addressVerticalAlign(twoLineText.length, BOX_H, FONT), "end");
});

test("超長兩行地址 → 仍 end，且行數估算為 2（限制在既有 Bounding Box 最大可排範圍內）", () => {
  const perCol = charsPerColumn(BOX_H, FONT);
  // 剛好塞滿兩行的字數（不超過 2*perCol），仍是 2 行、end 對齊。
  const longTwoLine = "字".repeat(perCol * 2);
  assert.equal(estimateVerticalLineCount(longTwoLine.length, BOX_H, FONT), 2);
  assert.equal(addressVerticalAlign(longTwoLine.length, BOX_H, FONT), "end");
});

test("空地址 → 0 行、center（不 render 也安全）", () => {
  assert.equal(estimateVerticalLineCount(0, BOX_H, FONT), 0);
  assert.equal(addressVerticalAlign(0, BOX_H, FONT), "center");
});

test("charsPerColumn 至少為 1（極小盒不除以 0、不回 0）", () => {
  assert.ok(charsPerColumn(1, FONT) >= 1);
  assert.ok(charsPerColumn(BOX_H, 999) >= 1);
});

test("邊界：剛好一行滿不進位、超過一字才進第二行", () => {
  const perCol = charsPerColumn(BOX_H, FONT);
  assert.equal(estimateVerticalLineCount(perCol, BOX_H, FONT), 1, "剛好滿一行仍是 1 行 → center");
  assert.equal(addressVerticalAlign(perCol, BOX_H, FONT), "center");
  assert.equal(estimateVerticalLineCount(perCol + 1, BOX_H, FONT), 2, "多一字 → 2 行 → end");
  assert.equal(addressVerticalAlign(perCol + 1, BOX_H, FONT), "end");
});
