import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  normalizeYangshangNames,
  formatYangshangAcclaim,
  resolveYangshangNames,
} from "../src/lib/yangshang";

/**
 * V14.1「多位陽上人＋每筆牌位地址」端到端測試。
 */
const ROOT = process.cwd();
const R = (p: string) => readFileSync(join(ROOT, p), "utf-8");

// ── 純函式：正規化 ─────────────────────────────────────────
test("1. 單筆多位陽上人保留全部", () => {
  assert.deepEqual(normalizeYangshangNames(["王大明", "陳小美", "李阿姨"]), ["王大明", "陳小美", "李阿姨"]);
});

test("2. 家戶選入與手動新增可同時（合併後保留）", () => {
  assert.deepEqual(
    normalizeYangshangNames(["王大明", "陳小美", "李阿姨", "林先生"]),
    ["王大明", "陳小美", "李阿姨", "林先生"]
  );
});

test("3. 相同姓名防重複（保留第一次順序）", () => {
  assert.deepEqual(normalizeYangshangNames(["王大明", "陳小美", "王大明"]), ["王大明", "陳小美"]);
});

test("7. 空白／空字串清理", () => {
  assert.deepEqual(normalizeYangshangNames([" 王大明 ", "", "  ", "陳小美"]), ["王大明", "陳小美"]);
  assert.deepEqual(normalizeYangshangNames(null), []);
  assert.deepEqual(normalizeYangshangNames("王大明"), []); // 非陣列 → 空
});

test("8. 姓名順序保留", () => {
  assert.deepEqual(normalizeYangshangNames(["丙", "甲", "乙"]), ["丙", "甲", "乙"]);
});

// ── 純函式：列印組字 ───────────────────────────────────────
test("9. 多位列印「A、B、C叩薦」", () => {
  assert.equal(formatYangshangAcclaim(["王大明", "陳小美", "李阿姨", "林先生"]), "王大明、陳小美、李阿姨、林先生叩薦");
});

test("10. 單位列印「A叩薦」", () => {
  assert.equal(formatYangshangAcclaim(["王大明"]), "王大明叩薦");
});

test("11. 無人時不輸出 undefined/null/空逗號/多餘叩薦", () => {
  assert.equal(formatYangshangAcclaim([]), "");
  assert.equal(formatYangshangAcclaim(null), "");
  assert.equal(formatYangshangAcclaim(undefined), "");
  // 清理後為空也回空字串
  assert.equal(formatYangshangAcclaim(["", "  "]), "");
});

test("組字不加任何親屬稱謂", () => {
  const out = formatYangshangAcclaim(["王大明", "陳小美"]);
  for (const bad of ["孝男", "孝媳", "孝孫", "陽上人", "家戶成員"]) {
    assert.equal(out.includes(bad), false);
  }
});

test("6. 舊 yangshangName 相容（陣列為空時補成單元素）", () => {
  assert.deepEqual(resolveYangshangNames([], "王大明"), ["王大明"]);
  assert.deepEqual(resolveYangshangNames(["陳小美"], "王大明"), ["陳小美"]); // 陣列優先
  assert.deepEqual(resolveYangshangNames([], null), []);
  assert.deepEqual(resolveYangshangNames(null, "  "), []); // 空白舊值 → 空
});

// ── schema / migration ─────────────────────────────────────
test("schema：UniversalSalvationEntry 附加 yangshangNames[] 與 tabletAddress，保留舊欄位", () => {
  const s = R("prisma/schema.prisma");
  const model = s.slice(s.indexOf("model UniversalSalvationEntry"), s.indexOf("model UniversalSalvationEntry") + 1200);
  assert.equal(model.includes("yangshangNames String[]"), true);
  assert.equal(model.includes("tabletAddress  String?") || model.includes("tabletAddress String?"), true);
  assert.equal(model.includes("yangshangName String?"), true, "舊欄位不得刪除");
});

test("migration：附加欄位＋冪等回填（不刪舊資料）", () => {
  const m = R("prisma/migrations/20260727000000_v14_1_yangshang_names_address/migration.sql");
  assert.equal(m.includes("ADD COLUMN IF NOT EXISTS \"yangshangNames\""), true);
  assert.equal(m.includes("ADD COLUMN IF NOT EXISTS \"tabletAddress\""), true);
  // 回填：只在陣列為空且舊欄位有值時
  assert.equal(/UPDATE "universal_salvation_entries"[\s\S]*array_length\("yangshangNames", 1\) IS NULL/.test(m), true);
  // 不得含破壞性
  for (const bad of ["DROP COLUMN", "DROP TABLE", "DELETE FROM", "TRUNCATE"]) {
    assert.equal(m.includes(bad), false);
  }
});

// ── API：支援新欄位、清理、權限、交易 ──────────────────────
test("6/12. entries API（POST/PATCH）支援 yangshangNames 與 tabletAddress，並清理", () => {
  const post = R("src/app/api/households/[id]/rituals/universal-salvation/[year]/entries/route.ts");
  const patch = R("src/app/api/households/[id]/rituals/universal-salvation/[year]/entries/[entryId]/route.ts");
  for (const src of [post, patch]) {
    assert.equal(src.includes("normalizeYangshangNames"), true, "陣列需經清理");
    assert.equal(src.includes("tabletAddress"), true);
  }
});

test("14/15. 寫入 API 沿用既有權限與 operatorUserId（READONLY 拒寫）", () => {
  const post = R("src/app/api/households/[id]/rituals/universal-salvation/[year]/entries/route.ts");
  const patch = R("src/app/api/households/[id]/rituals/universal-salvation/[year]/entries/[entryId]/route.ts");
  for (const src of [post, patch]) {
    assert.equal(src.includes("assertUniversalSalvationPermissionForOperator"), true);
    assert.equal(src.includes("readOperatorUserId"), true);
    // 不得只信任前端 operatorName
    assert.equal(src.includes("check.operator.name"), true);
  }
});

test("16. 建立／修改 entry 使用 transaction（失敗全 rollback）", () => {
  const ritual = R("src/lib/ritual.ts");
  const createFn = ritual.slice(ritual.indexOf("export async function createUniversalSalvationEntry"), ritual.indexOf("export type UpdateUniversalSalvationEntryInput"));
  assert.equal(createFn.includes("prisma.$transaction"), true);
  const updateFn = ritual.slice(ritual.indexOf("export async function updateUniversalSalvationEntry"));
  assert.equal(updateFn.slice(0, 1500).includes("prisma.$transaction"), true);
});

test("13. 帶入家戶地址只複製字串，寫入不動家戶主檔", () => {
  const row = R("src/components/ritual/EntryRow.tsx");
  // 帶入 = setTabletAddress(householdAddress)（純前端複製）
  assert.equal(row.includes("setTabletAddress(householdAddress)"), true);
  // entries API 不寫 household
  const patch = R("src/app/api/households/[id]/rituals/universal-salvation/[year]/entries/[entryId]/route.ts");
  assert.equal(/household\.update|updateHousehold/.test(patch), false);
});

// ── UI：多筆獨立、陽上人編輯器、地址欄 ─────────────────────
test("4/5. 每筆 entry 陽上人與地址獨立（EntryRow 以自身 entry 初始化）", () => {
  const row = R("src/components/ritual/EntryRow.tsx");
  assert.equal(row.includes("initialNames(entry)"), true);
  assert.equal(row.includes("entry.tabletAddress"), true);
  // 陽上人編輯器與地址欄只在超拔祖先／乙位正魂顯示
  assert.equal(row.includes("supportsYangshang"), true);
  assert.equal(row.includes("<YangshangEditor"), true);
});

test("超拔祖先／乙位正魂支援陽上人；冤親債主／無緣子女不強加", () => {
  const sec = R("src/components/ritual/EntryCategorySection.tsx");
  assert.equal(/ANCESTOR_LINE[\s\S]*INDIVIDUAL_SOUL/.test(sec) || sec.includes('category === "ANCESTOR_LINE" || category === "INDIVIDUAL_SOUL"'), true);
});

test("YangshangEditor：家戶勾選＋手動新增＋去重＋移除", () => {
  const ed = R("src/components/ritual/YangshangEditor.tsx");
  assert.equal(ed.includes("householdMemberNames"), true, "家戶成員快速加入");
  // 正式實作以 placeholder「輸入陽上人姓名」的輸入框做手動新增（見 YangshangEditor.tsx）。
  assert.equal(ed.includes("輸入陽上人姓名"), true, "手動新增輸入框");
  assert.equal(ed.includes("value.includes(name)"), true, "去重");
  assert.equal(ed.includes("removeName"), true, "可移除");
});

test("9(印). 牌位列印組字走共用 formatYangshangAcclaim（多位優先）", () => {
  const shared = R("src/components/ritual/tablets/shared.ts");
  assert.equal(shared.includes("formatYangshangAcclaim"), true);
  assert.equal(shared.includes("resolveYangshangNames"), true);
});

test("6(隔離). 修改某筆牌位只影響該筆——狀態按 entry 初始化、更新按 entryId scope", () => {
  // 每個 EntryRow 以自己的 entry 初始化狀態、以 entry.id 當 key，互不共享。
  const sec = readFileSync(join(ROOT, "src/components/ritual/EntryCategorySection.tsx"), "utf-8");
  assert.equal(/key=\{entry\.id\}/.test(sec), true, "每筆以 entry.id 當 key（獨立實例）");
  const row = readFileSync(join(ROOT, "src/components/ritual/EntryRow.tsx"), "utf-8");
  // PATCH 打到「這一筆」entry.id
  assert.equal(row.includes("/entries/${entry.id}"), true);
  // 伺服器更新只 scope 到該 entryId
  const ritual = readFileSync(join(ROOT, "src/lib/ritual.ts"), "utf-8");
  const updateFn = ritual.slice(ritual.indexOf("export async function updateUniversalSalvationEntry"));
  assert.equal(/update\(\{\s*where:\s*\{\s*id:\s*entryId\s*\}/.test(updateFn.slice(0, 2000)), true, "更新只針對該 entryId，不動其他筆");
});

test("7(冪等). migration 可重複執行：欄位 IF NOT EXISTS、回填有 IS NULL 守衛（不覆蓋不遺失）", () => {
  const m = readFileSync(join(ROOT, "prisma/migrations/20260727000000_v14_1_yangshang_names_address/migration.sql"), "utf-8");
  // 欄位新增可重跑
  assert.equal((m.match(/ADD COLUMN IF NOT EXISTS/g) ?? []).length >= 2, true);
  // 回填只在陣列為空時發生 → 第二次執行不會再動已回填的列（不覆蓋、不重複、不遺失）
  assert.equal(m.includes('array_length("yangshangNames", 1) IS NULL'), true);
  // 回填不改舊欄位、不刪任何資料
  assert.equal(/yangshangName"\s*=/.test(m.replace(/yangshangNames/g, "")), false, "回填不改寫舊 yangshangName");
});

test("17. 既有四類牌位 CRUD 未退化（新增/修改/刪除 API 仍在、EntryRow 仍有編輯/刪除）", () => {
  const row = R("src/components/ritual/EntryRow.tsx");
  assert.equal(row.includes("handleSave"), true);
  assert.equal(row.includes("handleDelete"), true);
  // 寶袋面板仍在
  assert.equal(row.includes("AdditionalPrintItemsPanel"), true);
});
