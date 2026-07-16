import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveReceiptDisplayYear,
  resolveReceiptCounterKey,
  formatReceiptNumber,
  previewReceiptNumberFormat,
  validateNumberingConfigInput,
  computeReceiptableRemaining,
  validateReceiptLineAmounts,
  determinePrintKind,
  integerToCapital,
  amountToChineseCapital,
} from "../src/lib/receiptRules";

// ============================================================
// 一、收據號碼格式
// ============================================================

test("resolveReceiptDisplayYear：西元年制直接回傳西元年", () => {
  assert.equal(resolveReceiptDisplayYear("WESTERN", new Date("2026-07-16")), 2026);
});

test("resolveReceiptDisplayYear：民國年制要減 1911", () => {
  assert.equal(resolveReceiptDisplayYear("ROC", new Date("2026-07-16")), 115);
});

test("resolveReceiptCounterKey：YEARLY 用年度字串", () => {
  assert.equal(resolveReceiptCounterKey("YEARLY", 2026), "2026");
  assert.equal(resolveReceiptCounterKey("YEARLY", 115), "115");
});

test("resolveReceiptCounterKey：CONTINUOUS 固定用 ALL，不分年度", () => {
  assert.equal(resolveReceiptCounterKey("CONTINUOUS", 2026), "ALL");
  assert.equal(resolveReceiptCounterKey("CONTINUOUS", 2027), "ALL");
});

test("formatReceiptNumber：預設格式 R-西元年-六位數", () => {
  const config = { prefix: "R", yearMode: "WESTERN" as const, digits: 6, resetPolicy: "YEARLY" as const, startNumber: 1 };
  assert.equal(formatReceiptNumber(config, 2026, 1), "R-2026-000001");
  assert.equal(formatReceiptNumber(config, 2026, 123456), "R-2026-123456");
});

test("formatReceiptNumber：不同前綴/位數設定", () => {
  const config = { prefix: "SXG", yearMode: "ROC" as const, digits: 4, resetPolicy: "YEARLY" as const, startNumber: 1 };
  assert.equal(formatReceiptNumber(config, 115, 7), "SXG-115-0007");
});

test("formatReceiptNumber：位數超出範圍要拋錯", () => {
  const config = { prefix: "R", yearMode: "WESTERN" as const, digits: 0, resetPolicy: "YEARLY" as const, startNumber: 1 };
  assert.throws(() => formatReceiptNumber(config, 2026, 1));
});

test("previewReceiptNumberFormat：用起始號碼預覽", () => {
  const config = { prefix: "R", yearMode: "WESTERN" as const, digits: 6, resetPolicy: "YEARLY" as const, startNumber: 1 };
  assert.equal(previewReceiptNumberFormat(config, new Date("2026-01-01")), "R-2026-000001");
});

test("validateNumberingConfigInput：合理設定通過", () => {
  const result = validateNumberingConfigInput({ prefix: "R", digits: 6, startNumber: 1 });
  assert.equal(result.ok, true);
});

test("validateNumberingConfigInput：空白前綴拒絕", () => {
  const result = validateNumberingConfigInput({ prefix: "  ", digits: 6, startNumber: 1 });
  assert.equal(result.ok, false);
});

test("validateNumberingConfigInput：位數超出範圍拒絕", () => {
  const result = validateNumberingConfigInput({ prefix: "R", digits: 11, startNumber: 1 });
  assert.equal(result.ok, false);
});

test("validateNumberingConfigInput：起始號碼小於1拒絕", () => {
  const result = validateNumberingConfigInput({ prefix: "R", digits: 6, startNumber: 0 });
  assert.equal(result.ok, false);
});

// ============================================================
// 二、收據可開立金額
// ============================================================

test("computeReceiptableRemaining：沒有退款也沒有已開立時，等於原始金額", () => {
  assert.equal(computeReceiptableRemaining(2000, 0, 0), 2000);
});

test("computeReceiptableRemaining：扣除退款與已開立金額", () => {
  assert.equal(computeReceiptableRemaining(2000, 500, 300), 1200);
});

test("computeReceiptableRemaining：不會出現負數", () => {
  assert.equal(computeReceiptableRemaining(2000, 1500, 800), 0);
});

test("validateReceiptLineAmounts：金額在範圍內通過", () => {
  const result = validateReceiptLineAmounts([{ allocationId: "A1", amount: 1000, remaining: 1000 }]);
  assert.equal(result.ok, true);
});

test("validateReceiptLineAmounts：超過尚可開立金額拒絕", () => {
  const result = validateReceiptLineAmounts([{ allocationId: "A1", amount: 1500, remaining: 1000 }]);
  assert.equal(result.ok, false);
  assert.match(result.error!, /超過尚可開立收據金額/);
});

test("validateReceiptLineAmounts：金額為0或負數拒絕", () => {
  const result = validateReceiptLineAmounts([{ allocationId: "A1", amount: 0, remaining: 1000 }]);
  assert.equal(result.ok, false);
});

test("validateReceiptLineAmounts：沒有任何明細拒絕", () => {
  const result = validateReceiptLineAmounts([]);
  assert.equal(result.ok, false);
});

test("validateReceiptLineAmounts：三方合併（供品+贊普+祭改）金額各自都在範圍內", () => {
  const result = validateReceiptLineAmounts([
    { allocationId: "A1", amount: 2000, remaining: 2000 },
    { allocationId: "A2", amount: 1500, remaining: 1500 },
    { allocationId: "A3", amount: 500, remaining: 500 },
  ]);
  assert.equal(result.ok, true);
});

// ============================================================
// 三、列印次數與種類
// ============================================================

test("determinePrintKind：第一次列印是 ORIGINAL_PRINT", () => {
  assert.equal(determinePrintKind(0), "ORIGINAL_PRINT");
});

test("determinePrintKind：第二次以後都是 REPRINT", () => {
  assert.equal(determinePrintKind(1), "REPRINT");
  assert.equal(determinePrintKind(5), "REPRINT");
});

// ============================================================
// 四、金額國字大寫
// ============================================================

test("integerToCapital：0", () => {
  assert.equal(integerToCapital(0), "零");
});

test("integerToCapital：個位數", () => {
  assert.equal(integerToCapital(7), "柒");
});

test("integerToCapital：兩位數（12）", () => {
  assert.equal(integerToCapital(12), "壹拾貳");
});

test("integerToCapital：三位數含中間零（105）", () => {
  assert.equal(integerToCapital(105), "壹佰零伍");
});

test("integerToCapital：整百（100）", () => {
  assert.equal(integerToCapital(100), "壹佰");
});

test("integerToCapital：整十（10）", () => {
  assert.equal(integerToCapital(10), "壹拾");
});

test("integerToCapital：四位數含中間零（1005）", () => {
  assert.equal(integerToCapital(1005), "壹仟零伍");
});

test("integerToCapital：四位數末兩位零（1500）", () => {
  assert.equal(integerToCapital(1500), "壹仟伍佰");
});

test("integerToCapital：整千（3000/7000）", () => {
  assert.equal(integerToCapital(3000), "參仟");
  assert.equal(integerToCapital(7000), "柒仟");
});

test("integerToCapital：萬位橋接零（10001）", () => {
  assert.equal(integerToCapital(10001), "壹萬零壹");
});

test("integerToCapital：萬位不需橋接零（15000）", () => {
  assert.equal(integerToCapital(15000), "壹萬伍仟");
});

test("integerToCapital：萬+千百十個都有值（1234567 超出萬以下但驗證大數字組合）", () => {
  assert.equal(integerToCapital(1234567), "壹佰貳拾參萬肆仟伍佰陸拾柒");
});

test("integerToCapital：整十萬（100000/1050000）", () => {
  assert.equal(integerToCapital(100000), "壹拾萬");
  assert.equal(integerToCapital(1050000), "壹佰零伍萬");
});

test("integerToCapital：超過一億要拋錯", () => {
  assert.throws(() => integerToCapital(100_000_000));
});

test("integerToCapital：負數或非整數要拋錯", () => {
  assert.throws(() => integerToCapital(-1));
  assert.throws(() => integerToCapital(1.5));
});

test("amountToChineseCapital：需求範例 7000 → 新台幣柒仟元整", () => {
  assert.equal(amountToChineseCapital(7000), "新台幣柒仟元整");
});

test("amountToChineseCapital：三項合計 7000（福壽龜3000+花果1500+普渡2500）", () => {
  assert.equal(amountToChineseCapital(3000 + 1500 + 2500), "新台幣柒仟元整");
});

test("amountToChineseCapital：0元", () => {
  assert.equal(amountToChineseCapital(0), "新台幣零元整");
});

test("amountToChineseCapital：含角分（1234.56）", () => {
  assert.equal(amountToChineseCapital(1234.56), "新台幣壹仟貳佰參拾肆元伍角陸分");
});

test("amountToChineseCapital：只有角沒有分（100.5）", () => {
  assert.equal(amountToChineseCapital(100.5), "新台幣壹佰元伍角整");
});

test("amountToChineseCapital：角為零但分不為零，需要橋接零（100.05）", () => {
  assert.equal(amountToChineseCapital(100.05), "新台幣壹佰元零伍分");
});

test("amountToChineseCapital：金額為0元但有分（0.05）", () => {
  assert.equal(amountToChineseCapital(0.05), "新台幣零元零伍分");
});

test("amountToChineseCapital：浮點數誤差不應影響結果（0.1+0.2 情境換算金額）", () => {
  // 29.9999999998 這種浮點誤差金額，四捨五入到分之後應該正確顯示 30 元整
  assert.equal(amountToChineseCapital(29.999999998), "新台幣參拾元整");
});

test("amountToChineseCapital：負數要拋錯", () => {
  assert.throws(() => amountToChineseCapital(-100));
});
