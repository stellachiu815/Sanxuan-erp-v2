import { test } from "node:test";
import assert from "node:assert/strict";
import { isAmountAnomaly, isSmokeBlocking, SMOKE_BLOCKING_CATEGORIES } from "../src/lib/preLaunchRules";

/** V30.8 已取消（CANCELLED）項目不做正式資料檢查、不阻擋上線。 */

// ── 金額異常：CANCELLED 一律非異常；有效項目才檢查一致性 ──
test("CANCELLED：amountDue=2500, amountPaid=0, amountUnpaid=0 → 不列金額異常", () => {
  assert.equal(isAmountAnomaly("CANCELLED", 2500, 0, 0), false);
});

test("CONFIRMED：amountDue=2500, amountPaid=0, amountUnpaid=0 → 列金額異常", () => {
  assert.equal(isAmountAnomaly("CONFIRMED", 2500, 0, 0), true);
});

test("CONFIRMED 金額一致（2500/500/2000）→ 非異常", () => {
  assert.equal(isAmountAnomaly("CONFIRMED", 2500, 500, 2000), false);
});

test("DRAFT 金額為負 → 異常；CANCELLED 為負 → 仍非異常（取消不檢查）", () => {
  assert.equal(isAmountAnomaly("DRAFT", -1, 0, 0), true);
  assert.equal(isAmountAnomaly("CANCELLED", -1, 0, 0), false);
});

// ── smoke blocker 只含有效未取消的正式問題 ──
test("smoke blocker：金額異常/孤兒/牌位缺entry/order重複 → 阻擋", () => {
  assert.equal(isSmokeBlocking("金額異常"), true);
  assert.equal(isSmokeBlocking("孤兒 entry（無 item）"), true);
  assert.equal(isSmokeBlocking("牌位 item 缺 entry"), true);
  assert.equal(isSmokeBlocking("registrationOrder 重複"), true);
});

test("smoke blocker：CANCELLED 衍生與整備期項目 → 不阻擋", () => {
  assert.equal(isSmokeBlocking("已取消歷史資料"), false);
  assert.equal(isSmokeBlocking("已刪除仍有應收"), false);
  assert.equal(isSmokeBlocking("DRAFT item"), false);
  assert.equal(isSmokeBlocking("DRAFT record"), false);
  assert.equal(isSmokeBlocking("空 RitualRecord"), false);
});

test("SMOKE_BLOCKING_CATEGORIES 不含任何 CANCELLED 衍生分類", () => {
  assert.ok(!SMOKE_BLOCKING_CATEGORIES.has("已取消歷史資料"));
  assert.ok(!SMOKE_BLOCKING_CATEGORIES.has("已刪除仍有應收"));
});
