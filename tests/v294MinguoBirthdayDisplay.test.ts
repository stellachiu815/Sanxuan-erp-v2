import { test } from "node:test";
import assert from "node:assert/strict";
import { formatIsoDateToMinguoLong, formatLunarDateToMinguoArabic } from "../src/lib/minguoDate";

/**
 * V29 校正預覽：生日一律民國顯示（沿用既有 minguoDate 工具，不另建曆法邏輯）。
 * 驗收範例（規格 item 6）：
 *   solarBirthDate 1960-10-24 → 民國49年10月24日
 *   lunar 1960/9/5（平月）      → 民國49年農曆9月5日
 *   lunar 1960/9/5（閏月）      → 民國49年農曆閏9月5日
 */

test("國曆 ISO → 民國長格式（不顯示西元裸格式）", () => {
  assert.equal(formatIsoDateToMinguoLong("1960-10-24"), "民國49年10月24日");
});

test("農曆 → 民國＋農曆前綴（阿拉伯月日）", () => {
  assert.equal(
    formatLunarDateToMinguoArabic({ year: 1960, month: 9, day: 5, isLeapMonth: false }),
    "民國49年農曆9月5日"
  );
});

test("農曆閏月標註「閏」", () => {
  assert.equal(
    formatLunarDateToMinguoArabic({ year: 1960, month: 9, day: 5, isLeapMonth: true }),
    "民國49年農曆閏9月5日"
  );
});

test("資料不足 → 空字串（畫面留白，不顯示西元/Invalid）", () => {
  assert.equal(formatLunarDateToMinguoArabic({ year: 1960, month: null, day: 5, isLeapMonth: false }), "");
  assert.equal(formatIsoDateToMinguoLong(null), "");
  assert.equal(formatIsoDateToMinguoLong("not-a-date"), "");
});
