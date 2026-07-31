import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeFieldDiffs,
  classifyRow,
  isFieldWritable,
  buildSelectedCorrections,
  type ExcelSideValues,
  type DbSideValues,
  type CorrectableField,
} from "../src/lib/devoteeImportFieldDiff";

/**
 * V29 第二階段：信眾逐欄差異＋安全校正 純函式測試（沙盒可跑）。
 * 對應驗收清單中屬「邏輯層」可驗的項目（1/2/3/4/5/9/10 等）。
 */
function excel(p: Partial<ExcelSideValues>): ExcelSideValues {
  return {
    gender: null, solarBirthDate: null, lunarBirthYear: null, lunarBirthMonth: null, lunarBirthDay: null,
    lunarIsLeapMonth: false, nationalId: null, address: null, role: null, mobile: null, email: null, ...p,
  };
}
function db(p: Partial<DbSideValues>): DbSideValues {
  return {
    gender: null, solarBirthDate: null, lunarBirthYear: null, lunarBirthMonth: null, lunarBirthDay: null,
    lunarIsLeapMonth: false, nationalId: null, address: null, role: null, mobile: null, email: null, ...p,
  };
}
const diffOf = (rows: ReturnType<typeof computeFieldDiffs>, f: CorrectableField) => rows.find((r) => r.field === f)!;

test("1. DB 錯生日、Excel 正確 → 該欄 status=DIFF（可預覽）", () => {
  const rows = computeFieldDiffs(excel({ solarBirthDate: "1957-04-17" }), db({ solarBirthDate: "1960-01-01" }));
  assert.equal(diffOf(rows, "solarBirthDate").status, "DIFF");
  assert.equal(diffOf(rows, "solarBirthDate").excel, "1957-04-17");
  assert.equal(diffOf(rows, "solarBirthDate").db, "1960-01-01");
});

test("1b. DIFF 未勾選 → 不可寫；只補空白模式也不可寫 DIFF", () => {
  assert.equal(isFieldWritable("DIFF", false, "CORRECT_WITH_EXCEL"), false); // 未勾選
  assert.equal(isFieldWritable("DIFF", true, "FILL_BLANK_ONLY"), false); // 只補空白模式不覆蓋錯值
  assert.equal(isFieldWritable("DIFF", true, "CORRECT_WITH_EXCEL"), true); // 勾選＋校正模式才可
});

test("2. 勾選後只更新生日（其他未勾選欄位不進 patch）", () => {
  const rows = computeFieldDiffs(
    excel({ solarBirthDate: "1957-04-17", gender: "女", address: "台北市A" }),
    db({ solarBirthDate: "1960-01-01", gender: "男", address: "台北市B" })
  );
  const selected = new Set<CorrectableField>(["solarBirthDate"]);
  const writable = buildSelectedCorrections(rows, selected, "CORRECT_WITH_EXCEL");
  assert.deepEqual(writable, ["solarBirthDate"]);
});

test("3. Excel 空白 → 永不覆蓋 DB（DB_ONLY，不可寫）", () => {
  const rows = computeFieldDiffs(excel({ address: null }), db({ address: "台北市原值" }));
  assert.equal(diffOf(rows, "address").status, "DB_ONLY");
  assert.equal(isFieldWritable("DB_ONLY", true, "CORRECT_WITH_EXCEL"), false);
  assert.deepEqual(buildSelectedCorrections(rows, new Set(["address"]), "CORRECT_WITH_EXCEL"), []);
});

test("4/5. 配對不安全（同名多人／跨戶）→ 整列 NEEDS_REVIEW", () => {
  const rows = computeFieldDiffs(excel({ gender: "女" }), db({ gender: null }));
  assert.equal(classifyRow(false, rows), "NEEDS_REVIEW"); // matchSafe=false
});

test("完全一致：無 FILL_BLANK/DIFF → IDENTICAL；有差異且安全 → SAFE_UPDATE", () => {
  const same = computeFieldDiffs(excel({ gender: "女", nationalId: "A123456789" }), db({ gender: "女", nationalId: "A123456789" }));
  assert.equal(classifyRow(true, same), "IDENTICAL");
  const fill = computeFieldDiffs(excel({ gender: "女" }), db({ gender: null }));
  assert.equal(classifyRow(true, fill), "SAFE_UPDATE");
});

test("補空白（DB 空、Excel 有）→ 兩種模式都可寫", () => {
  const rows = computeFieldDiffs(excel({ nationalId: "A123456789" }), db({ nationalId: null }));
  assert.equal(diffOf(rows, "nationalId").status, "FILL_BLANK");
  assert.equal(isFieldWritable("FILL_BLANK", true, "FILL_BLANK_ONLY"), true);
  assert.equal(isFieldWritable("FILL_BLANK", true, "CORRECT_WITH_EXCEL"), true);
});

test("相同值不寫入（SAME）", () => {
  const rows = computeFieldDiffs(excel({ gender: "男" }), db({ gender: "男" }));
  assert.equal(diffOf(rows, "gender").status, "SAME");
  assert.deepEqual(buildSelectedCorrections(rows, new Set(["gender"]), "CORRECT_WITH_EXCEL"), []);
});

test("9. 國曆／農曆不錯置：分屬 solarBirthDate 與 lunarBirth 兩欄，互不影響", () => {
  const rows = computeFieldDiffs(
    excel({ solarBirthDate: "1957-04-17", lunarBirthYear: 1957, lunarBirthMonth: 4, lunarBirthDay: 17 }),
    db({ solarBirthDate: null, lunarBirthYear: null, lunarBirthMonth: null, lunarBirthDay: null })
  );
  assert.equal(diffOf(rows, "solarBirthDate").status, "FILL_BLANK");
  assert.equal(diffOf(rows, "lunarBirth").status, "FILL_BLANK");
  assert.equal(diffOf(rows, "lunarBirth").excel, "1957-4-17");
});

test("10. 未勾選欄位完全不寫入", () => {
  const rows = computeFieldDiffs(
    excel({ gender: "女", address: "台北市A" }),
    db({ gender: "男", address: "台北市B" })
  );
  // 都有差異，但只勾 gender
  assert.deepEqual(buildSelectedCorrections(rows, new Set(["gender"]), "CORRECT_WITH_EXCEL"), ["gender"]);
  // 一個都不勾 → 空
  assert.deepEqual(buildSelectedCorrections(rows, new Set(), "CORRECT_WITH_EXCEL"), []);
});

test("手機/Email 屬 DevoteeProfile，仍可逐欄差異與勾選", () => {
  const rows = computeFieldDiffs(excel({ mobile: "0912345678", email: "a@b.com" }), db({ mobile: null, email: "old@b.com" }));
  assert.equal(diffOf(rows, "mobile").status, "FILL_BLANK");
  assert.equal(diffOf(rows, "email").status, "DIFF");
  assert.deepEqual(
    buildSelectedCorrections(rows, new Set(["mobile", "email"]), "CORRECT_WITH_EXCEL").sort(),
    ["email", "mobile"]
  );
});
