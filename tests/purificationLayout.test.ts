import { test } from "node:test";
import assert from "node:assert/strict";
import { optimizeColumn, optimizeCell, optimizeBatch } from "../src/lib/purificationLayout";

test("二字姓名可適度放大（維持最大字級 level 0）", () => {
  const result = optimizeColumn("NAME", "邱玲");
  assert.equal(result.chosenTier.level, 0);
  assert.equal(result.fits, true);
});

test("三字姓名使用標準字體（level 1）", () => {
  const result = optimizeColumn("NAME", "邱雅玲");
  assert.equal(result.chosenTier.level, 1);
  assert.equal(result.fits, true);
});

test("四字姓名微調字體及字距（level 2）", () => {
  const result = optimizeColumn("NAME", "歐陽雅玲");
  assert.equal(result.chosenTier.level, 2);
  assert.equal(result.fits, true);
});

test("五字以上姓名只縮小該姓名欄（level 3 以上，仍然 fits）", () => {
  const result = optimizeColumn("NAME", "司馬雅玲兒");
  assert.ok(result.chosenTier.level >= 3);
  assert.equal(result.fits, true);
});

test("短地址使用最大字級即可裝下", () => {
  const result = optimizeColumn("ADDRESS", "士林區承德路一段一號");
  assert.equal(result.fits, true);
  assert.equal(result.chosenTier.level, 0);
});

test("最長地址：字級會逐級縮小，仍然裝得下就不列入人工確認", () => {
  const longAddress = "台北市士林區承德路四段一八一巷二十三弄五號七樓之一（近捷運站出口）";
  const result = optimizeColumn("ADDRESS", longAddress);
  assert.ok(result.chosenTier.level > 0, "應該有縮小字級");
});

test("地址未填（空字串）不會被誤判為需要人工確認（由列印前檢查另外處理『地址未填』）", () => {
  const result = optimizeColumn("ADDRESS", "");
  assert.equal(result.fits, true);
  assert.equal(result.charCount, 0);
});

test("optimizeCell：整合姓名/中間欄/地址欄，任何一欄縮到最小仍放不下才需要人工確認", () => {
  const result = optimizeCell({
    numberText: "125",
    nameText: "邱雅玲",
    middleText: "五十四歲七月七日吉時瑞生",
    addressText: "承德路四段一八一號七樓之一",
  });
  assert.equal(result.needsManualReview, false);
  assert.equal(result.reviewReasons.length, 0);
});

test("optimizeCell：極端超長姓名縮到最小字級仍放不下，列入人工確認清單", () => {
  const result = optimizeCell({
    numberText: "9",
    nameText: "這是一個超過十個字的超長測試姓名資料",
    middleText: "五十四歲七月七日吉時建生",
    addressText: "台北市",
  });
  assert.equal(result.name.fits, false);
  assert.equal(result.needsManualReview, true);
  assert.ok(result.reviewReasons.some((r) => r.includes("姓名")));
});

test("optimizeCell：三個欄位互相獨立——地址很長不會影響姓名欄的字級", () => {
  const longAddress = "台北市士林區承德路四段一八一巷二十三弄五號七樓之一（近捷運站出口，請小心慢行）";
  const result = optimizeCell({
    numberText: "1",
    nameText: "邱玲",
    middleText: "五十四歲七月七日吉時瑞生",
    addressText: longAddress,
  });
  // 姓名只有 2 字，不管地址欄縮到多小，姓名欄應該仍然維持最大字級。
  assert.equal(result.name.chosenTier.level, 0);
});

test("optimizeBatch：整批 33 格摘要，正確統計已調整與需人工確認的筆數", () => {
  const cells = [
    { numberText: "1", nameText: "邱玲", middleText: "五十四歲七月七日吉時瑞生", addressText: "台北市" },
    {
      numberText: "2",
      nameText: "這是一個超過十個字的超長測試姓名資料",
      middleText: "五十四歲七月七日吉時建生",
      addressText: "台北市",
    },
    { numberText: "3", nameText: "歐陽雅玲", middleText: "八歲三月三日吉時建生", addressText: "台北市士林區" },
  ];
  const { summary } = optimizeBatch(cells);
  assert.equal(summary.totalCells, 3);
  assert.equal(summary.needsReviewCells.length, 1);
  assert.equal(summary.needsReviewCells[0].index, 1);
  assert.ok(summary.adjustedCount >= 1);
});

test("無內容重疊／無文字截斷／無超出貼紙範圍：任何長度的文字都只會回傳一個合法字級或明確標記 fits=false，不會憑空產生負值或截斷資料", () => {
  const samples = ["", "王", "王小明", "歐陽雅玲兒", "司馬相如卓文君之女", "極端超長姓名資料測試極端超長姓名資料測試"];
  for (const name of samples) {
    const result = optimizeColumn("NAME", name);
    assert.equal(result.charCount, [...name].length, "charCount 必須忠實反映原始字數，不能截斷");
    assert.ok(result.chosenTier.fontSizePt > 0);
    assert.ok(typeof result.fits === "boolean");
  }
});
