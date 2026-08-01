import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeFieldDiffs,
  buildSelectedCorrections,
  type ExcelSideValues,
  type DbSideValues,
  type CorrectableField,
  type FieldDiff,
} from "../src/lib/devoteeImportFieldDiff";

/**
 * V29 安全欄位自動預設勾選規則（面板 DevoteeCorrectionPanel 的預設邏輯核心）。
 * 面板進入預覽時：預設勾選＝所有 FILL_BLANK（DB 空、Excel 有值）欄位；DIFF/SAME/DB_ONLY 不勾。
 * 這裡以純函式驗證規則本身，並確認 commit（buildSelectedCorrections）只寫「最後仍勾選」的欄位。
 */

// 面板預設勾選：只取 FILL_BLANK。
function defaultChecked(diffs: FieldDiff[]): Set<CorrectableField> {
  const s = new Set<CorrectableField>();
  for (const d of diffs) if (d.status === "FILL_BLANK") s.add(d.field);
  return s;
}

function excel(v: Partial<ExcelSideValues>): ExcelSideValues {
  return { gender: null, solarBirthDate: null, lunarBirthYear: null, lunarBirthMonth: null, lunarBirthDay: null, lunarIsLeapMonth: false, nationalId: null, address: null, role: null, mobile: null, email: null, ...v };
}
function db(v: Partial<DbSideValues>): DbSideValues {
  return { gender: null, solarBirthDate: null, lunarBirthYear: null, lunarBirthMonth: null, lunarBirthDay: null, lunarIsLeapMonth: false, nationalId: null, address: null, role: null, mobile: null, email: null, ...v };
}

test("DB 空白＋Excel 有值 → 預設勾選（性別/身份/聯絡電話/通訊地址/國曆/農曆）", () => {
  const diffs = computeFieldDiffs(
    excel({ gender: "男", role: "信眾", mobile: "0912", address: "台北", solarBirthDate: "1960-10-24", lunarBirthYear: 1960, lunarBirthMonth: 9, lunarBirthDay: 5 }),
    db({})
  );
  const checked = defaultChecked(diffs);
  for (const f of ["gender", "role", "mobile", "address", "solarBirthDate", "lunarBirth"] as CorrectableField[]) {
    assert.ok(checked.has(f), `${f} 應預設勾選`);
  }
});

test("DB 有值＋Excel 不同 → 不預設勾選（DIFF）", () => {
  const diffs = computeFieldDiffs(excel({ gender: "男", address: "新址" }), db({ gender: "女", address: "舊址" }));
  const checked = defaultChecked(diffs);
  assert.ok(!checked.has("gender"));
  assert.ok(!checked.has("address"));
});

test("Excel 空白 → 不勾選（DB_ONLY，永不覆蓋）", () => {
  const diffs = computeFieldDiffs(excel({}), db({ gender: "男", mobile: "0900" }));
  const checked = defaultChecked(diffs);
  assert.equal(checked.size, 0);
});

test("相同值 → 不勾選（SAME）", () => {
  const diffs = computeFieldDiffs(excel({ gender: "男", role: "信眾" }), db({ gender: "男", role: "信眾" }));
  assert.equal(defaultChecked(diffs).size, 0);
});

test("commit 只寫最後仍勾選的欄位（取消 address 後不寫 address）", () => {
  const diffs = computeFieldDiffs(excel({ gender: "男", address: "台北" }), db({}));
  const checked = defaultChecked(diffs); // {gender, address}
  checked.delete("address"); // 使用者手動取消
  const writable = buildSelectedCorrections(diffs, checked, "FILL_BLANK_ONLY");
  assert.deepEqual(writable.sort(), ["gender"]);
});

test("全部安全更新規則：DIFF 不得被納入（只 FILL_BLANK）", () => {
  const diffs = computeFieldDiffs(excel({ gender: "男", address: "新址" }), db({ address: "舊址" }));
  // 面板「全部安全更新」＝只勾 FILL_BLANK：gender（DB空）可勾，address（DIFF）不可。
  const batch = defaultChecked(diffs);
  assert.ok(batch.has("gender"));
  assert.ok(!batch.has("address"));
});
