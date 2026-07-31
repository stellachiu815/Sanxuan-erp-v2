import { test } from "node:test";
import assert from "node:assert/strict";
import { ensureAncestorLineName } from "../src/components/household/WorshipRecordWizard";

/**
 * V28.3：新增歷代祖先輸入便利——非「歷代祖先」結尾自動補上、已是則不重複、空字串不動。
 * 此為純字串函式（不 render 元件，不觸及 React）。
 */
test("非「歷代祖先」結尾 → 自動補上", () => {
  assert.equal(ensureAncestorLineName("林姓"), "林姓歷代祖先");
  assert.equal(ensureAncestorLineName("林"), "林歷代祖先");
  assert.equal(ensureAncestorLineName("歐陽姓"), "歐陽姓歷代祖先");
});

test("已是「○歷代祖先」→ 不重複補字", () => {
  assert.equal(ensureAncestorLineName("林姓歷代祖先"), "林姓歷代祖先");
  assert.equal(ensureAncestorLineName("歷代祖先"), "歷代祖先");
});

test("前後空白去除；空字串不動", () => {
  assert.equal(ensureAncestorLineName("  林姓  "), "林姓歷代祖先");
  assert.equal(ensureAncestorLineName("   "), "");
  assert.equal(ensureAncestorLineName(""), "");
});
