import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldExcludeLeakedPrintSource } from "../src/lib/TabletBatchService";

/**
 * V34.3B：列印清單排除「封存牌位／取消報名」的孤立列印物件（純函式）。
 * listPrintItemsForPrintCenter 的 sourceEntries 已加 deletedAt:null，故封存牌位
 * 不在 Map 中 → sourceExists=false；此函式再加上報名項目 CANCELLED／已刪除的排除。
 */

test("Entry 已封存（查詢已濾掉、不在 Map）→ 排除", () => {
  // 封存牌位不在 sourceEntryById → sourceExists=false。
  assert.equal(shouldExcludeLeakedPrintSource({ sourceExists: false }), true);
});

test("Entry 存在但 deletedAt 有值（防禦）→ 排除", () => {
  assert.equal(
    shouldExcludeLeakedPrintSource({ sourceExists: true, sourceDeletedAt: new Date() }),
    true
  );
});

test("關聯報名項目 CANCELLED → 排除", () => {
  assert.equal(
    shouldExcludeLeakedPrintSource({ sourceExists: true, registrationItemStatus: "CANCELLED" }),
    true
  );
});

test("關聯報名項目已刪除 → 排除", () => {
  assert.equal(
    shouldExcludeLeakedPrintSource({ sourceExists: true, registrationItemDeleted: true }),
    true
  );
});

test("有效 Entry ＋ 有效 RegistrationItem（CONFIRMED）→ 不排除（正常出現）", () => {
  assert.equal(
    shouldExcludeLeakedPrintSource({ sourceExists: true, sourceDeletedAt: null, registrationItemStatus: "CONFIRMED", registrationItemDeleted: false }),
    false
  );
});

test("有效 Entry ＋ DRAFT RegistrationItem → 不排除", () => {
  assert.equal(
    shouldExcludeLeakedPrintSource({ sourceExists: true, registrationItemStatus: "DRAFT" }),
    false
  );
});

test("有效 Entry 且無關聯報名項目 → 不排除（不誤殺無 RRI 的有效牌位）", () => {
  assert.equal(shouldExcludeLeakedPrintSource({ sourceExists: true }), false);
});

test("同名一有效一取消：只保留有效那筆（TABLET 與 POCKET 同規則）", () => {
  // 有效那筆：sourceExists 且 RRI 非取消 → 保留。
  assert.equal(shouldExcludeLeakedPrintSource({ sourceExists: true, registrationItemStatus: "CONFIRMED" }), false);
  // 取消那筆：RRI CANCELLED → 排除（無論 TABLET 或 POCKET，皆以其 sourceEntry/RRI 判斷）。
  assert.equal(shouldExcludeLeakedPrintSource({ sourceExists: true, registrationItemStatus: "CANCELLED" }), true);
  // 封存那筆：sourceExists=false → 排除。
  assert.equal(shouldExcludeLeakedPrintSource({ sourceExists: false }), true);
});
