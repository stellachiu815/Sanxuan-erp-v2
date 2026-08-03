import { test } from "node:test";
import assert from "node:assert/strict";
import { needsReprint, resolvePrintAddress, resolvePrintMainText } from "../src/lib/tabletPrintFields";
import { printNumberOf } from "../src/lib/workOrder";

/** V32 §5 需補印 + §2/§13 地址層級 + §一 主文 + workOrder 統一號碼。 */

test("needsReprint：未列印→false；列印後未改→false；列印後又改→true", () => {
  assert.equal(needsReprint(0, null, "2026-08-01T00:00:00Z"), false);
  assert.equal(needsReprint(1, "2026-08-02T00:00:00Z", "2026-08-01T00:00:00Z"), false, "改在列印前不需補印");
  assert.equal(needsReprint(1, "2026-08-01T00:00:00Z", "2026-08-02T00:00:00Z"), true, "列印後又改→需補印");
});

test("地址：entry 優先 → Member fallback → 絕不 Household（函式不吃家戶地址）", () => {
  assert.equal(resolvePrintAddress("台北市A", "新北市B"), "台北市A");
  assert.equal(resolvePrintAddress(null, "新北市B"), "新北市B");
  assert.equal(resolvePrintAddress("", ""), "");
  // Household 地址即使存在也無從進入此函式（介面只有 entry+member）→ 結構上保證不使用。
});

test("主文：printMainText 空白用預設；有值只覆寫（地基主等）", () => {
  assert.equal(resolvePrintMainText("周府歷代祖先", null), "周府歷代祖先");
  assert.equal(resolvePrintMainText("無緣子女", "本宅地基主"), "本宅地基主");
});

test("統一號碼：workOrder 優先、NULL 回退 registrationOrder（Excel/牌位/寶袋/補印同一來源）", () => {
  assert.equal(printNumberOf(3, 10), 3);
  assert.equal(printNumberOf(null, 10), 10);
});
