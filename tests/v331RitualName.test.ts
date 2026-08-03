import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeAncestorCoreName, normalizeIndividualSoulCoreName,
  formatAncestorDisplayName, formatIndividualSoulDisplayName,
  resolveRitualDisplayName, ritualCoreName, normalizeRitualNameForStore,
  categoryFromItemKey, categoryFromWorshipType,
} from "../src/lib/ritualDisplayName";

/** V33.1 歷代祖先／乙位正魂 名稱唯一規則。 */

test("1. 歷代祖先：王姓 → 王姓歷代祖先", () => {
  assert.equal(formatAncestorDisplayName("王姓"), "王姓歷代祖先");
});
test("2. 已有後綴：王姓歷代祖先 → 王姓歷代祖先（不重複）", () => {
  assert.equal(formatAncestorDisplayName("王姓歷代祖先"), "王姓歷代祖先");
  assert.equal(normalizeAncestorCoreName("王姓歷代祖先"), "王姓");
});
test("3. 重複後綴：王姓歷代祖先歷代祖先 → 僅一次後綴", () => {
  assert.equal(formatAncestorDisplayName("王姓歷代祖先歷代祖先"), "王姓歷代祖先");
  assert.equal(normalizeAncestorCoreName("王姓歷代祖先歷代祖先"), "王姓");
});
test("4. 乙位正魂：陳永育 → 陳永育乙位正魂", () => {
  assert.equal(formatIndividualSoulDisplayName("陳永育"), "陳永育乙位正魂");
});
test("5. 乙位正魂已有後綴（含空格舊資料）→ 不重複、無空格", () => {
  assert.equal(formatIndividualSoulDisplayName("陳永育乙位正魂"), "陳永育乙位正魂");
  assert.equal(formatIndividualSoulDisplayName("陳永育 乙位正魂"), "陳永育乙位正魂");
  assert.equal(normalizeIndividualSoulCoreName("陳永育乙位正魂乙位正魂"), "陳永育");
});
test("6. type=歷代祖先＋謝姓 → 謝姓歷代祖先（不得變乙位正魂）", () => {
  assert.equal(resolveRitualDisplayName("ANCESTOR_LINE", "謝姓"), "謝姓歷代祖先");
  assert.notEqual(resolveRitualDisplayName("ANCESTOR_LINE", "謝姓"), "謝姓乙位正魂");
});
test("7. type=乙位正魂＋完整姓名 → 不得顯示歷代祖先", () => {
  assert.equal(resolveRitualDisplayName("INDIVIDUAL_SOUL", "周陳尺"), "周陳尺乙位正魂");
  assert.ok(!resolveRitualDisplayName("INDIVIDUAL_SOUL", "周陳尺").includes("歷代祖先"));
});
test("8. Excel 完整名稱匯入後：核心正確、顯示不重複", () => {
  // 匯入「歷代祖先」欄，值為完整或核心，一律得核心「王姓」、顯示「王姓歷代祖先」
  for (const v of ["王姓", "王姓歷代祖先"]) {
    assert.equal(normalizeRitualNameForStore("ANCESTOR_LINE", v), "王姓");
    assert.equal(resolveRitualDisplayName("ANCESTOR_LINE", normalizeRitualNameForStore("ANCESTOR_LINE", v)), "王姓歷代祖先");
  }
});
test("10. 編輯框只回填核心名稱（依 type，不猜名稱）", () => {
  assert.equal(ritualCoreName("ANCESTOR_LINE", "王姓歷代祖先"), "王姓");
  assert.equal(ritualCoreName("INDIVIDUAL_SOUL", "陳永育乙位正魂"), "陳永育");
});
test("類型只依欄位：itemKey / worshipType 對應", () => {
  assert.equal(categoryFromItemKey("US_ANCESTOR"), "ANCESTOR_LINE");
  assert.equal(categoryFromItemKey("US_ZHENGHUN"), "INDIVIDUAL_SOUL");
  assert.equal(categoryFromWorshipType("INDIVIDUAL"), "INDIVIDUAL_SOUL");
  assert.equal(categoryFromWorshipType("ANCESTOR_LINE"), "ANCESTOR_LINE");
});
test("只移除末尾後綴，不誤改中間文字", () => {
  // 中間含「歷代祖先」字樣（極罕見）不受影響——僅末尾比對
  assert.equal(normalizeAncestorCoreName("歷代祖先堂王姓"), "歷代祖先堂王姓");
});
test("盤點分類：A 核心/B 已含後綴/C 重複後綴/D 府或疑錯類/E 空值", () => {
  const { classifyRitualName } = require("../src/lib/ritualDisplayName");
  assert.equal(classifyRitualName("ANCESTOR_LINE", "王姓").classification, "A_CORE_OK");
  assert.equal(classifyRitualName("ANCESTOR_LINE", "王姓歷代祖先").classification, "B_HAS_SUFFIX");
  assert.equal(classifyRitualName("ANCESTOR_LINE", "王姓歷代祖先歷代祖先").classification, "C_DUP_SUFFIX");
  assert.equal(classifyRitualName("ANCESTOR_LINE", "王府歷代祖先").classification, "D_TYPE_TEXT_MISMATCH");
  assert.equal(classifyRitualName("INDIVIDUAL_SOUL", "謝姓").classification, "D_TYPE_TEXT_MISMATCH"); // 疑錯類，NEEDS_REVIEW
  assert.equal(classifyRitualName("INDIVIDUAL_SOUL", "").classification, "E_UNRESOLVABLE");
  // C 的預期顯示仍為單一後綴
  assert.equal(classifyRitualName("ANCESTOR_LINE", "王姓歷代祖先歷代祖先").expectedDisplay, "王姓歷代祖先");
});

test("V33.2 存核心→顯示完整 round-trip：不再出現重複/錯類後綴", () => {
  // 建立時存核心（normalizeRitualNameForStore），顯示時 resolveRitualDisplayName 補後綴。
  const store = normalizeRitualNameForStore;
  const show = resolveRitualDisplayName;
  // 歷代祖先：輸入完整或核心，存核心「王姓」，顯示「王姓歷代祖先」（非重複）
  for (const input of ["王姓", "王姓歷代祖先", "王姓歷代祖先歷代祖先"]) {
    const stored = store("ANCESTOR_LINE", input);
    assert.equal(stored, "王姓");
    assert.equal(show("ANCESTOR_LINE", stored), "王姓歷代祖先");
  }
  // 謝姓（歷代祖先）：存「謝姓」，顯示「謝姓歷代祖先」，絕不變乙位正魂
  const s = store("ANCESTOR_LINE", "謝姓歷代祖先");
  assert.equal(s, "謝姓");
  assert.equal(show("ANCESTOR_LINE", s), "謝姓歷代祖先");
  assert.ok(!show("ANCESTOR_LINE", s).includes("乙位正魂"));
  // 乙位正魂：輸入完整或核心，存核心「陳永育」，顯示「陳永育乙位正魂」
  for (const input of ["陳永育", "陳永育乙位正魂"]) {
    const stored = store("INDIVIDUAL_SOUL", input);
    assert.equal(stored, "陳永育");
    assert.equal(show("INDIVIDUAL_SOUL", stored), "陳永育乙位正魂");
  }
  // 存核心後，同一核心不會因儲存值帶後綴而重複（王姓歷代祖先歷代祖先 已不可能發生）
  assert.equal(show("ANCESTOR_LINE", store("ANCESTOR_LINE", "王姓歷代祖先")), "王姓歷代祖先");
});

test("空值維持空值（由既有必填規則處理）", () => {
  assert.equal(formatAncestorDisplayName(""), "");
  assert.equal(formatIndividualSoulDisplayName(null), "");
  assert.equal(normalizeAncestorCoreName("   "), "");
});
