import { test } from "node:test";
import assert from "node:assert/strict";
import { isTabletName, buildCorrectionNormalizedRows } from "../src/lib/devoteeImportBatch";
import type { PersonSheetRow } from "../src/lib/devoteeImportPersonSheet";

/**
 * V29：牌位名稱（歷代祖先／乙位正魂）排除於信眾個人校正。
 * 只比對這兩個關鍵字，避免誤判其他姓名。純函式驗證。
 */

function person(name: string): PersonSheetRow {
  return {
    rowNumber: 2, name, householdCode: null, gender: null, mobile: null, phone: null, email: null,
    solarBirthDate: null, lunarBirthYear: null, lunarBirthMonth: null, lunarBirthDay: null, lunarIsLeapMonth: false,
    address: null, role: null, tabletAddress: null, nationalId: null, notes: null, formatErrors: [],
  } as PersonSheetRow;
}

test("牌位關鍵字命中（歷代祖先／乙位正魂，含前綴）", () => {
  assert.equal(isTabletName("陳姓歷代祖先"), true);
  assert.equal(isTabletName("王林氏歷代祖先"), true);
  assert.equal(isTabletName("李○○乙位正魂"), true);
  assert.equal(isTabletName("  歷代祖先  "), true);
});

test("一般信眾姓名不誤判", () => {
  assert.equal(isTabletName("王小明"), false);
  assert.equal(isTabletName("陳祖德"), false); // 含「祖」但非「歷代祖先」
  assert.equal(isTabletName("林正魂"), false); // 含「正魂」但非「乙位正魂」
  assert.equal(isTabletName(""), false);
  assert.equal(isTabletName(null), false);
});

test("buildCorrectionNormalizedRows 排除牌位名稱，只留一般信眾", () => {
  const rows = buildCorrectionNormalizedRows([
    person("王小明"),
    person("陳姓歷代祖先"),
    person("林大華"),
    person("張○○乙位正魂"),
  ]);
  assert.equal(rows.length, 2, "4 筆中 2 筆牌位被排除，只留 2 位信眾");
  assert.deepEqual(rows.map((r) => r.memberNames[0]), ["王小明", "林大華"]);
});
