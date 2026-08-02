import { test } from "node:test";
import assert from "node:assert/strict";
import { formatWorkNumber } from "../src/components/ritual/tablets/shared";

/** V30.3 作業號碼格式：No.001 起、至少三位、≥1000 不截斷；null 不顯示（不印 No.000）。 */
test("三位補零 No.001 / No.099", () => {
  assert.equal(formatWorkNumber(1), "No.001");
  assert.equal(formatWorkNumber(99), "No.099");
});

test("No.100 / No.999", () => {
  assert.equal(formatWorkNumber(100), "No.100");
  assert.equal(formatWorkNumber(999), "No.999");
});

test("≥1000 完整顯示、不截斷、不補零", () => {
  assert.equal(formatWorkNumber(1000), "No.1000");
  assert.equal(formatWorkNumber(1044), "No.1044");
});

test("null／undefined → 不顯示（不印 No.000）", () => {
  assert.equal(formatWorkNumber(null), null);
  assert.equal(formatWorkNumber(undefined), null);
});
