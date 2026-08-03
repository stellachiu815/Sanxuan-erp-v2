import { test } from "node:test";
import assert from "node:assert/strict";
import { mergePrintMainText } from "../src/lib/entryPrintMainTextPure";
import { resolvePrintMainText } from "../src/lib/tabletPrintFields";

/**
 * V32 §一 printMainText 重載回填：
 *  - 儲存「本宅地基主」後重載仍為「本宅地基主」
 *  - 清空後（null）重載為空 → 正式列印回到系統預設主文
 *  - 未在 map 內的 entry 維持自身既有值（不被清掉）
 */

test("重載：已保存 printMainText 正確併回 entry", () => {
  const entries = [{ id: "a", displayName: "無緣子女" }];
  const merged = mergePrintMainText(entries, new Map([["a", "本宅地基主"]]));
  assert.equal(merged[0].printMainText, "本宅地基主");
});

test("清空：printMainText=null 重載為空，正式列印回到系統預設", () => {
  const entries = [{ id: "a", displayName: "無緣子女" }];
  const merged = mergePrintMainText(entries, new Map([["a", null]]));
  assert.equal(merged[0].printMainText, null);
  // 正式列印主文：null → 用系統預設（formattedDefault）
  assert.equal(resolvePrintMainText("無緣子女", merged[0].printMainText), "無緣子女");
});

test("覆寫生效：正式列印採用單筆 printMainText", () => {
  const entries = [{ id: "a", displayName: "無緣子女" }];
  const merged = mergePrintMainText(entries, new Map([["a", "本宅地基主"]]));
  assert.equal(resolvePrintMainText("無緣子女", merged[0].printMainText), "本宅地基主");
});

test("map 未含的 entry 維持既有值，不被清空", () => {
  const entries = [{ id: "a", displayName: "x", printMainText: "既有" }];
  const merged = mergePrintMainText(entries, new Map());
  assert.equal(merged[0].printMainText, "既有");
});
