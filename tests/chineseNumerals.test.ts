import { test } from "node:test";
import assert from "node:assert/strict";
import {
  toChineseNumeral,
  digitsToChineseDigits,
  convertAddressToChineseNumerals,
  formatChineseAge,
  formatFormalLunarDate,
  normalizeGender,
  formatJishi,
} from "../src/lib/chineseNumerals";

test("toChineseNumeral：個位數", () => {
  assert.equal(toChineseNumeral(0), "〇");
  assert.equal(toChineseNumeral(3), "三");
  assert.equal(toChineseNumeral(7), "七");
  assert.equal(toChineseNumeral(9), "九");
});

test("toChineseNumeral：十位數（含 10-19 省略開頭的一）", () => {
  assert.equal(toChineseNumeral(10), "十");
  assert.equal(toChineseNumeral(12), "十二");
  assert.equal(toChineseNumeral(19), "十九");
  assert.equal(toChineseNumeral(20), "二十");
  assert.equal(toChineseNumeral(25), "二十五");
  assert.equal(toChineseNumeral(54), "五十四");
  assert.equal(toChineseNumeral(90), "九十");
  assert.equal(toChineseNumeral(99), "九十九");
});

test("toChineseNumeral：百位數（含零的插入與百位後的十不可省略一）", () => {
  assert.equal(toChineseNumeral(100), "一百");
  assert.equal(toChineseNumeral(101), "一百零一");
  assert.equal(toChineseNumeral(105), "一百零五");
  assert.equal(toChineseNumeral(110), "一百一十"); // 不可以變成「一百十」
  assert.equal(toChineseNumeral(115), "一百一十五");
  assert.equal(toChineseNumeral(120), "一百二十");
  assert.equal(toChineseNumeral(200), "二百");
});

test("toChineseNumeral：拒絕負數與非整數", () => {
  assert.throws(() => toChineseNumeral(-1));
  assert.throws(() => toChineseNumeral(1.5));
});

test("digitsToChineseDigits：逐字轉換，非數字字元不動", () => {
  assert.equal(digitsToChineseDigits("181"), "一八一");
  assert.equal(digitsToChineseDigits("台北市"), "台北市");
  assert.equal(digitsToChineseDigits("4"), "四");
});

test("地址國字轉換：181 號不可變成一百八十一（逐字讀法，非數值讀法）", () => {
  const result = convertAddressToChineseNumerals("承德路4段181號7樓之1");
  assert.equal(result, "承德路四段一八一號七樓之一");
  assert.ok(!result.includes("一百八十一"), "181 不可以被讀成數值「一百八十一」");
});

test("地址國字轉換：最長地址仍逐字正確轉換", () => {
  const result = convertAddressToChineseNumerals("台北市士林區承德路4段181巷23弄5號7樓之1");
  assert.equal(result, "台北市士林區承德路四段一八一巷二三弄五號七樓之一");
});

test("地址國字轉換：地址未填（空字串）不應該拋出例外", () => {
  assert.equal(convertAddressToChineseNumerals(""), "");
});

test("formatChineseAge：歲數使用中文國字", () => {
  assert.equal(formatChineseAge(54), "五十四歲");
  assert.equal(formatChineseAge(48), "四十八歲");
  assert.equal(formatChineseAge(3), "三歲");
});

test("農曆七月七日必須顯示「七月七日」，不可以變成「七月初七」", () => {
  const result = formatFormalLunarDate(7, 7);
  assert.equal(result.monthText, "七月");
  assert.equal(result.dayText, "七日");
  assert.equal(result.combined, "七月七日");
  assert.ok(!result.combined.includes("初"), "不可以出現民間簡稱「初七」");
});

test("農曆二月二十五日必須顯示完整國字，不可以變成「二月廿五」", () => {
  const result = formatFormalLunarDate(2, 25);
  assert.equal(result.combined, "二月二十五日");
  assert.ok(!result.combined.includes("廿"), "不可以出現民間簡稱「廿五」");
});

test("農曆十二月三日必須顯示「十二月三日」，不可以變成「十二月初三」", () => {
  const result = formatFormalLunarDate(12, 3);
  assert.equal(result.combined, "十二月三日");
  assert.ok(!result.combined.includes("初"), "不可以出現民間簡稱「初三」");
});

test("formatFormalLunarDate：閏月加註「閏」字首", () => {
  const result = formatFormalLunarDate(4, 10, true);
  assert.equal(result.monthText, "閏四月");
});

test("formatFormalLunarDate：不合法的月份／日期要丟出例外", () => {
  assert.throws(() => formatFormalLunarDate(13, 1));
  assert.throws(() => formatFormalLunarDate(1, 31));
});

test("性別正規化與吉時對應：男性顯示吉時建生", () => {
  assert.equal(normalizeGender("男"), "MALE");
  assert.equal(formatJishi("MALE"), "吉時建生");
});

test("性別正規化與吉時對應：女性顯示吉時瑞生", () => {
  assert.equal(normalizeGender("女"), "FEMALE");
  assert.equal(formatJishi("FEMALE"), "吉時瑞生");
});

test("性別未填寫時，不得自行猜測建生或瑞生", () => {
  assert.equal(normalizeGender(null), "UNKNOWN");
  assert.equal(normalizeGender(undefined), "UNKNOWN");
  assert.equal(normalizeGender("其他"), "UNKNOWN");
  assert.equal(formatJishi("UNKNOWN"), null);
});
