import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/** V15R8 普渡列印管理——來源掃描（DB 行為見 v15r8PrintDb）。 */
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("列印語意：printCount++、首次才設 printedAt、每次更新 lastPrintedAt＋操作人", () => {
  const src = read("src/lib/printDocuments.ts");
  const fn = src.slice(src.indexOf("export async function printRegistrationItems"));
  assert.ok(/printCount: \{ increment: 1 \}/.test(fn), "printCount++");
  assert.ok(/lastPrintedAt: now/.test(fn), "每次更新 lastPrintedAt");
  assert.ok(/printedByUserId: operator\.id/.test(fn) && /printedByName: operator\.name/.test(fn), "記錄操作人");
  assert.ok(/\.\.\.\(t\.printedAt \? \{\} : \{ printedAt: now \}\)/.test(fn), "首次才設 printedAt、之後不覆蓋");
});

test("列印不改金額／收款／報名狀態（財務隔離）", () => {
  const src = read("src/lib/printDocuments.ts");
  const fn = src.slice(src.indexOf("export async function printRegistrationItems"), src.indexOf("export async function buildItemRoster"));
  // 只檢查 update 的寫入 payload（不含 where 的 CONFIRMED 過濾）。
  const dataBlock = fn.slice(fn.indexOf("data: ({"), fn.indexOf("as unknown as Prisma.RitualRegistrationItemUncheckedUpdateInput"));
  assert.ok(!/amount/.test(dataBlock), "列印寫入不觸碰金額");
  assert.ok(!/status:/.test(dataBlock), "列印寫入不改報名狀態");
});

test("唯一入口只列正式資料（CONFIRMED）；讀牌位姓名/陽上/地址/來源", () => {
  const src = read("src/lib/printDocuments.ts");
  const fn = src.slice(src.indexOf("export async function listPrintCenterItems"), src.indexOf("export async function resolvePrintableItemIds"));
  assert.ok(/status: "CONFIRMED"/.test(fn), "item 只列 CONFIRMED");
  assert.ok(/ritualRecord: \{[\s\S]*status: "CONFIRMED"/.test(fn), "主報名須 CONFIRMED");
  assert.ok(fn.includes("universalSalvationEntry") && fn.includes("displayName") && fn.includes("yangshangNames") && fn.includes("tabletAddress"), "讀牌位姓名/陽上/地址");
  assert.ok(fn.includes("registrationSource"), "帶資料來源");
});

test("Excel 匯入標記來源 EXCEL_IMPORT（不改計價/交易/防重/同步/財務）", () => {
  const imp = read("src/lib/purificationImport.ts");
  assert.ok((imp.match(/createBlankUniversalSalvationRecord\([^)]*"EXCEL_IMPORT"/g) ?? []).length >= 1, "匯入建 record 帶 EXCEL_IMPORT");
  const ritual = read("src/lib/ritual.ts");
  assert.ok(/registrationSource: string = "HOUSEHOLD_PAGE"/.test(ritual), "createBlank 以參數帶來源、預設家戶頁");
  assert.ok(/registrationSource,/.test(ritual), "record 寫入傳入的來源");
});

test("五種來源標籤齊備", () => {
  const src = read("src/lib/printDocuments.ts");
  for (const s of ["DEVOTEE_PAGE", "HOUSEHOLD_PAGE", "ACTIVITY_PAGE", "EXCEL_IMPORT", "CARRY_OVER"]) {
    assert.ok(src.includes(s), `來源標籤含 ${s}`);
  }
});

test("API：列印名單查詢 + 單筆/批次/全部列印端點", () => {
  const list = read("src/app/api/print-center/items/route.ts");
  assert.ok(list.includes("listPrintCenterItems"), "查詢端點");
  const print = read("src/app/api/print-center/items/print/route.ts");
  assert.ok(print.includes("printRegistrationItems"), "列印端點");
  assert.ok(print.includes("resolvePrintableItemIds"), "全部列印只套目前篩選");
  assert.ok(/all === true/.test(print) && /Array\.isArray\(body\.ids\)/.test(print), "支援 all＋filter 與 ids");
});

test("schema/migration：RitualRegistrationItem 純新增列印欄位", () => {
  const schema = read("prisma/schema.prisma");
  const block = schema.slice(schema.indexOf("model RitualRegistrationItem"), schema.indexOf("model RitualRegistrationItem") + 2500);
  for (const f of ["lastPrintedAt", "printedByUserId", "printedByName"]) assert.ok(block.includes(f), `schema 缺 ${f}`);
  const mig = read("prisma/migrations/20260815000000_v15r8_print_center/migration.sql");
  assert.ok(/ADD COLUMN "lastPrintedAt"/.test(mig) && /ADD COLUMN "printedByName"/.test(mig), "migration 純新增");
});

test("UI：搜尋/篩選/狀態/單筆+批次+全部/名單檢視/實體物件連結", () => {
  const ui = read("src/components/ritual/PrintManagementCenter.tsx");
  assert.ok(ui.includes("家戶／信眾／牌位姓名／陽上人／地址"), "搜尋欄位");
  assert.ok(ui.includes("資料來源") && ui.includes("列印狀態") && ui.includes("報名項目"), "篩選");
  assert.ok(ui.includes("列印選取（批次）") && ui.includes("全部列印") && ui.includes("補印"), "單筆/批次/全部");
  assert.ok(ui.includes("依項目") && ui.includes("依家戶") && ui.includes("依信眾"), "名單檢視");
  assert.ok(ui.includes("實體列印物件"), "連結到牌位/寶袋實體物件中心");
  assert.ok(ui.includes("未列印") && ui.includes("已列印") && ui.includes("補印"), "狀態顯示");
  const page = read("src/app/print-center/page.tsx");
  assert.ok(page.includes("<PrintManagementCenter"), "列印管理頁掛入");
});

test("AdditionalPrintItem 既有補印流程不退步（未改動其規則）", () => {
  const rules = read("src/lib/additionalPrintItemRules.ts");
  assert.ok(/printCount/.test(rules) && /firstPrintedAt/.test(rules) && /lastPrintedAt/.test(rules), "物件補印規則保留");
});
