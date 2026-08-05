import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeRitualNameForStore,
  resolveRitualDisplayName,
  classifyRitualName,
} from "../src/lib/ritualDisplayName";

/** V36.3 §四：名稱規則（normalizeRitualNameForStore／resolveRitualDisplayName／classifyRitualName）。 */

test("歷代祖先：王姓 → 王姓歷代祖先（顯示）；核心存「王姓」", () => {
  assert.equal(resolveRitualDisplayName("ANCESTOR_LINE", "王姓"), "王姓歷代祖先");
  assert.equal(normalizeRitualNameForStore("ANCESTOR_LINE", "王姓歷代祖先"), "王姓");
});

test("乙位正魂：陳永成 → 陳永成乙位正魂（顯示）；核心存「陳永成」", () => {
  assert.equal(resolveRitualDisplayName("INDIVIDUAL_SOUL", "陳永成"), "陳永成乙位正魂");
  assert.equal(normalizeRitualNameForStore("INDIVIDUAL_SOUL", "陳永成乙位正魂"), "陳永成");
});

test("不得重複後綴（顯示層防重）", () => {
  assert.equal(resolveRitualDisplayName("ANCESTOR_LINE", "王姓歷代祖先"), "王姓歷代祖先");
  assert.equal(resolveRitualDisplayName("ANCESTOR_LINE", "王姓歷代祖先歷代祖先"), "王姓歷代祖先");
  assert.equal(resolveRitualDisplayName("INDIVIDUAL_SOUL", "陳永成乙位正魂"), "陳永成乙位正魂");
});

test("不得把祖先與乙位正魂互換（type 決定後綴，不猜名稱）", () => {
  // 同一核心「陳永成」，依 category 產生不同後綴。
  assert.equal(resolveRitualDisplayName("ANCESTOR_LINE", "陳永成"), "陳永成歷代祖先");
  assert.equal(resolveRitualDisplayName("INDIVIDUAL_SOUL", "陳永成"), "陳永成乙位正魂");
});

test("舊「府」→ 顯示用「姓」（王府歷代祖先 → 王姓歷代祖先）", () => {
  assert.equal(resolveRitualDisplayName("ANCESTOR_LINE", "王府歷代祖先"), "王姓歷代祖先");
});

test("盤點分類：核心正確 A_CORE_OK、已含後綴 B、重複後綴 C（可安全正規化）", () => {
  assert.equal(classifyRitualName("ANCESTOR_LINE", "王姓").classification, "A_CORE_OK");
  assert.equal(classifyRitualName("ANCESTOR_LINE", "王姓歷代祖先").classification, "B_HAS_SUFFIX");
  assert.equal(classifyRitualName("ANCESTOR_LINE", "王姓歷代祖先歷代祖先").classification, "C_DUP_SUFFIX");
});

test("畸形資料 → NEEDS_REVIEW（D_TYPE_TEXT_MISMATCH，不自動改）", () => {
  // 核心中間仍夾帶後綴（無法安全還原）。
  const d = classifyRitualName("ANCESTOR_LINE", "王姓歷代祖先姓歷代祖先");
  assert.equal(d.classification, "D_TYPE_TEXT_MISMATCH");
  assert.equal(d.autoFixable, false);
  // 乙位正魂卻以「姓」結尾（疑似錯類）→ D，不自動改。
  assert.equal(classifyRitualName("INDIVIDUAL_SOUL", "王姓").classification, "D_TYPE_TEXT_MISMATCH");
});

test("空值 → E_UNRESOLVABLE（交由必填規則處理）", () => {
  assert.equal(classifyRitualName("ANCESTOR_LINE", "").classification, "E_UNRESOLVABLE");
});
