import { test } from "node:test";
import assert from "node:assert/strict";
import { checkPurificationPrintReadiness } from "../src/lib/purificationConsistency";

const BASE_OK_INPUT = {
  gender: "MALE" as const,
  hasBirthYearData: true,
  ageResolutionOk: true,
  address: "台北市士林區承德路四段一八一號七樓之一",
  number: 125,
  isBannedNumber: false,
  isDuplicateNumber: false,
  layoutNeedsManualReview: false,
  layoutReviewReasons: [],
};

test("完全沒有問題的資料可以列印", () => {
  const result = checkPurificationPrintReadiness(BASE_OK_INPUT);
  assert.equal(result.canPrint, true);
  assert.deepEqual(result.issues, []);
});

test("性別未填不得列印", () => {
  const result = checkPurificationPrintReadiness({ ...BASE_OK_INPUT, gender: "UNKNOWN" });
  assert.equal(result.canPrint, false);
  assert.ok(result.issues.some((i) => i.includes("性別")));
});

test("農曆生日未填（無出生年份資料）不得列印", () => {
  const result = checkPurificationPrintReadiness({
    ...BASE_OK_INPUT,
    hasBirthYearData: false,
    ageResolutionOk: false,
  });
  assert.equal(result.canPrint, false);
  assert.ok(result.issues.some((i) => i.includes("農曆生日")));
});

test("出生年份不足以計算歲數不得列印", () => {
  const result = checkPurificationPrintReadiness({
    ...BASE_OK_INPUT,
    hasBirthYearData: true,
    ageResolutionOk: false,
  });
  assert.equal(result.canPrint, false);
  assert.ok(result.issues.some((i) => i.includes("出生年份不足")));
});

test("地址未填不得列印", () => {
  const result = checkPurificationPrintReadiness({ ...BASE_OK_INPUT, address: "" });
  assert.equal(result.canPrint, false);
  assert.ok(result.issues.some((i) => i.includes("地址未填")));

  const result2 = checkPurificationPrintReadiness({ ...BASE_OK_INPUT, address: null });
  assert.equal(result2.canPrint, false);
});

test("尚未編號不得列印", () => {
  const result = checkPurificationPrintReadiness({ ...BASE_OK_INPUT, number: null });
  assert.equal(result.canPrint, false);
  assert.ok(result.issues.some((i) => i.includes("尚未編號")));
});

test("誤用禁用編號不得列印", () => {
  const result = checkPurificationPrintReadiness({ ...BASE_OK_INPUT, isBannedNumber: true });
  assert.equal(result.canPrint, false);
  assert.ok(result.issues.some((i) => i.includes("禁用編號")));
});

test("編號重複不得列印", () => {
  const result = checkPurificationPrintReadiness({ ...BASE_OK_INPUT, isDuplicateNumber: true });
  assert.equal(result.canPrint, false);
  assert.ok(result.issues.some((i) => i.includes("編號重複")));
});

test("文字超出（版面最佳化仍無法容納）不得列印", () => {
  const result = checkPurificationPrintReadiness({
    ...BASE_OK_INPUT,
    layoutNeedsManualReview: true,
    layoutReviewReasons: ["姓名「測試」縮到最小字體仍放不下"],
  });
  assert.equal(result.canPrint, false);
  assert.ok(result.issues.some((i) => i.includes("姓名")));
});

test("多個問題同時存在時，全部列出，不會只顯示第一個就停止", () => {
  const result = checkPurificationPrintReadiness({
    ...BASE_OK_INPUT,
    gender: "UNKNOWN",
    address: "",
    isDuplicateNumber: true,
  });
  assert.equal(result.canPrint, false);
  assert.equal(result.issues.length, 3);
});
