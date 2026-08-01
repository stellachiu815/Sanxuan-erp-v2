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
 * V30 正式信眾匯入：唯一配對預設「以 Excel 覆蓋」。
 * 面板預設勾選＝「可寫入」欄位（FILL_BLANK 兩模式皆可；DIFF 只在 CORRECT_WITH_EXCEL）。
 * Excel 空白（DB_ONLY）永不覆蓋。這裡以純函式驗證此語意（面板 writableFields 的邏輯核心）。
 */

// 面板 V30 預設勾選：writable = FILL_BLANK + DIFF(僅 CORRECT_WITH_EXCEL)。
function writable(diffs: FieldDiff[], mode: "FILL_BLANK_ONLY" | "CORRECT_WITH_EXCEL"): Set<CorrectableField> {
  const s = new Set<CorrectableField>();
  for (const d of diffs) {
    if (d.status === "FILL_BLANK") s.add(d.field);
    else if (d.status === "DIFF" && mode === "CORRECT_WITH_EXCEL") s.add(d.field);
  }
  return s;
}
function excel(v: Partial<ExcelSideValues>): ExcelSideValues {
  return { gender: null, solarBirthDate: null, lunarBirthYear: null, lunarBirthMonth: null, lunarBirthDay: null, lunarIsLeapMonth: false, nationalId: null, address: null, role: null, mobile: null, email: null, ...v };
}
function db(v: Partial<DbSideValues>): DbSideValues {
  return { gender: null, solarBirthDate: null, lunarBirthYear: null, lunarBirthMonth: null, lunarBirthDay: null, lunarIsLeapMonth: false, nationalId: null, address: null, role: null, mobile: null, email: null, ...v };
}

test("DB 有值但與 Excel 不同 → 覆蓋模式預設勾選（會以 Excel 覆蓋）", () => {
  // 重現上週個案：DB 已有舊地址，Excel 有新地址 → DIFF → 覆蓋模式應寫入。
  const diffs = computeFieldDiffs(excel({ address: "新北市板橋區文聖街十一巷二十一號二樓" }), db({ address: "舊地址" }));
  const w = writable(diffs, "CORRECT_WITH_EXCEL");
  assert.ok(w.has("address"), "覆蓋模式應勾選差異地址");
  const written = buildSelectedCorrections(diffs, w, "CORRECT_WITH_EXCEL");
  assert.ok(written.includes("address"), "commit 應寫入（以 Excel 覆蓋）");
});

test("只補空白模式：差異地址不勾、不覆蓋（對照組）", () => {
  const diffs = computeFieldDiffs(excel({ address: "新址" }), db({ address: "舊址" }));
  assert.ok(!writable(diffs, "FILL_BLANK_ONLY").has("address"));
});

test("Excel 空白（DB 有值）→ 永不覆蓋（DB_ONLY，兩模式都不勾）", () => {
  const diffs = computeFieldDiffs(excel({}), db({ address: "既有地址", gender: "男" }));
  assert.equal(writable(diffs, "CORRECT_WITH_EXCEL").size, 0);
});

test("覆蓋模式：多個 Member 欄位（性別/身份/電話/生日/地址）皆隨 Excel 覆蓋", () => {
  const diffs = computeFieldDiffs(
    excel({ gender: "女", role: "委員", mobile: "0911", solarBirthDate: "1960-10-24", address: "新址" }),
    db({ gender: "男", role: "信眾", mobile: "0900", solarBirthDate: "1970-01-01", address: "舊址" })
  );
  const w = writable(diffs, "CORRECT_WITH_EXCEL");
  for (const f of ["gender", "role", "mobile", "solarBirthDate", "address"] as CorrectableField[]) {
    assert.ok(w.has(f), `${f} 應覆蓋`);
  }
});
