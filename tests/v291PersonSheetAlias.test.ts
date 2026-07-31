import { test } from "node:test";
import assert from "node:assert/strict";
import { remapPersonSheetAliases, parsePersonSheet } from "../src/lib/devoteeImportPersonSheet";

/**
 * V29：校正模式欄名別名正規化 → parsePersonSheet 可解析（純函式，沙盒可跑）。
 * 驗證正式信眾 Excel 常見別名（信眾姓名／戶號／行動電話／生日／電子郵件／通訊地址）能解析出正確筆數，
 * 不再全為 0。完整匯入模式（parsePersonSheet 對正式欄名的行為）不受影響。
 */
test("別名欄名 → 正規化 → parsePersonSheet 解析成功（不為 0）", () => {
  const rawRows = [
    { "戶號": "F00666", "信眾姓名": "王小明", "性別": "男", "行動電話": "0912345678", "生日": "1957-04-17", "電子郵件": "a@b.com", "通訊地址": "台北市中正區", "身份": "信眾" },
    { "戶號": "F00666", "信眾姓名": "王大明", "生日": "1960/1/1" },
    { "戶號": "", "信眾姓名": "" }, // 空列：應被略過，不影響其他
  ];
  const remapped = remapPersonSheetAliases(rawRows);
  const persons = parsePersonSheet(remapped);
  assert.equal(persons.length, 2, "應解析出 2 位（空列略過）");
  const wang = persons[0];
  assert.equal(wang.name, "王小明");
  assert.equal(wang.householdCode, "F00666");
  assert.equal(wang.gender, "男");
  assert.equal(wang.mobile, "0912345678");
  assert.equal(wang.solarBirthDate, "1957-04-17");
  assert.equal(wang.email, "a@b.com");
  assert.equal(wang.address, "台北市中正區");
  // withHouseholdCode 統計
  assert.equal(persons.filter((p) => !!p.householdCode).length, 2);
});

test("標題含空白/大小寫差異的別名仍可對上", () => {
  const rawRows = [{ " 信眾姓名 ": "李小華", "家戶號": "F00888", "E-MAIL": "x@y.com" }];
  const persons = parsePersonSheet(remapPersonSheetAliases(rawRows));
  assert.equal(persons.length, 1);
  assert.equal(persons[0].name, "李小華");
  assert.equal(persons[0].householdCode, "F00888");
  assert.equal(persons[0].email, "x@y.com");
});

test("正式欄名（姓名/家戶編號）維持可解析——不因別名邏輯而破壞既有", () => {
  const rawRows = [{ "姓名": "陳一", "家戶編號": "F00001", "手機": "0900000000" }];
  const persons = parsePersonSheet(remapPersonSheetAliases(rawRows));
  assert.equal(persons[0].name, "陳一");
  assert.equal(persons[0].householdCode, "F00001");
  assert.equal(persons[0].mobile, "0900000000");
});
