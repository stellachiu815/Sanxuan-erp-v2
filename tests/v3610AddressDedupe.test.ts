import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { shouldExcludeLeakedPrintSource } from "../src/lib/TabletBatchService";

/**
 * V36.10：封存 Entry 絕不入名冊（buildItemRoster／listPrintItemsForPrintCenter）。
 * 本輪**不**修改正式匯入比對規則（見報告的未來設計提案），故不含匯入決策測試。
 */

test("shouldExcludeLeakedPrintSource：來源牌位已封存/查無 → 一律排除（即使列印物件仍在）", () => {
  // 封存牌位不在 live 來源 Map → sourceExists=false → 排除。
  assert.equal(shouldExcludeLeakedPrintSource({ sourceExists: false }), true);
  // 顯式帶封存時間亦排除。
  assert.equal(shouldExcludeLeakedPrintSource({ sourceExists: true, sourceDeletedAt: new Date() }), true);
  // 正常存活 → 不排除。
  assert.equal(shouldExcludeLeakedPrintSource({ sourceExists: true, sourceDeletedAt: null, registrationItemStatus: "PENDING", registrationItemDeleted: false }), false);
});

const printItemsSrc = readFileSync(new URL("../src/lib/additionalPrintItems.ts", import.meta.url), "utf8");

test("listPrintItemsForPrintCenter 明確排除已封存來源牌位（即使列印物件未封存）", () => {
  assert.ok(printItemsSrc.includes("archivedSourceEntryIds"), "有封存牌位集合");
  assert.ok(/deletedAt:\s*\{\s*not:\s*null\s*\}/.test(printItemsSrc), "查出 deletedAt 非 null 的來源牌位");
  assert.ok(/archivedSourceEntryIds\.has\(item\.sourceEntryId\)\)\s*continue/.test(printItemsSrc), "封存牌位列印物件直接跳過");
});

const importSrc = readFileSync(new URL("../src/lib/purificationImport.ts", import.meta.url), "utf8");

test("V36.13 聰明匯入：同核心名視為同一牌位（更新不新增）＋沿用家戶既有牌位地址", () => {
  // 同家戶＋同類別＋同核心名 → UPDATE（不再地址一有出入就新增重複）。
  assert.ok(/hitBySameName/.test(importSrc), "confirm 加入同核心名匹配");
  assert.ok(/sameName\.length === 1/.test(importSrc), "同核心名唯一命中才自動更新（多支不自動合併）");
  assert.ok(/hitBySameName\s*\?\s*"UPDATE"/.test(importSrc), "同核心名命中 → UPDATE");
  // Excel 沒填地址 → 沿用家戶永久牌位（WorshipRecord）同核心名那張的地址，不再亂帶戶籍地。
  assert.ok(/worshipRecord\.findMany/.test(importSrc), "查家戶永久牌位");
  assert.ok(/inheritedAddress/.test(importSrc), "沿用既有牌位地址");
});
