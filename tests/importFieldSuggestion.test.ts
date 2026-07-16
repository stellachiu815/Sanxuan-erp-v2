import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getTargetFields,
  suggestColumnMappingPure,
  normalizeColumnName,
} from "../src/lib/importFieldSuggestion";

test("getTargetFields：祭改的必填欄位是家戶編號與姓名", () => {
  const fields = getTargetFields("PURIFICATION");
  const required = fields.filter((f) => f.required).map((f) => f.key);
  assert.deepEqual(required, ["householdId", "displayName"]);
});

test("getTargetFields：通用活動只有家戶編號必填", () => {
  const fields = getTargetFields("GENERIC_ACTIVITY");
  const required = fields.filter((f) => f.required).map((f) => f.key);
  assert.deepEqual(required, ["householdId"]);
});

test("suggestColumnMappingPure：已儲存的記憶優先於別名表猜測", () => {
  const remembered = { "報名人": "displayName" }; // "報名人" 不在別名表裡，只有記憶裡有
  const result = suggestColumnMappingPure("PURIFICATION", ["報名人"], remembered);
  assert.equal(result["報名人"], "displayName");
});

test("suggestColumnMappingPure：沒有記憶時用別名表智慧辨識", () => {
  const result = suggestColumnMappingPure("PURIFICATION", ["手機", "住址", "戶號"], {});
  assert.equal(result["手機"], "phone");
  assert.equal(result["住址"], "address");
  assert.equal(result["戶號"], "householdId");
});

test("suggestColumnMappingPure：對不到任何欄位時回傳 null，不會亂猜", () => {
  const result = suggestColumnMappingPure("PURIFICATION", ["神秘欄位XYZ"], {});
  assert.equal(result["神秘欄位XYZ"], null);
});

test("suggestColumnMappingPure：查記憶/別名表時會去除頭尾空白，但回傳的 key 維持原始欄位名稱（跟 Excel 解析出來的欄位名稱一致，才能跟前端/commit 那一步對得上）", () => {
  const remembered = { "電話": "phone" }; // 記憶是用去除空白後的名稱存的
  const result = suggestColumnMappingPure("PURIFICATION", ["  電話  "], remembered);
  assert.equal(result["  電話  "], "phone"); // 用原始（含空白）的 key 才能查到值
  assert.equal(result["電話"], undefined);
});

test("normalizeColumnName：去除前後空白", () => {
  assert.equal(normalizeColumnName("  姓名  "), "姓名");
});

test("suggestColumnMappingPure：通用活動類型的『金額』別名對應到 amount 而不是 paymentAmount", () => {
  const result = suggestColumnMappingPure("GENERIC_ACTIVITY", ["金額"], {});
  assert.equal(result["金額"], "amount");
});

test("getTargetFields：附加列印項目匯入的必填欄位是家戶編號/原祭祀類型/原祭祀名稱/附加項目類型/列印名稱", () => {
  const fields = getTargetFields("ADDITIONAL_PRINT_ITEM");
  const required = fields.filter((f) => f.required).map((f) => f.key);
  assert.deepEqual(required, ["householdId", "sourceCategory", "sourceName", "itemType", "printName"]);
});

test("suggestColumnMappingPure：附加列印項目匯入欄位的別名智慧辨識", () => {
  const result = suggestColumnMappingPure(
    "ADDITIONAL_PRINT_ITEM",
    ["原祭祀類型", "原祭祀名稱", "附加項目類型", "列印名稱", "數量"],
    {}
  );
  assert.equal(result["原祭祀類型"], "sourceCategory");
  assert.equal(result["原祭祀名稱"], "sourceName");
  assert.equal(result["附加項目類型"], "itemType");
  assert.equal(result["列印名稱"], "printName");
  assert.equal(result["數量"], "quantity");
});
